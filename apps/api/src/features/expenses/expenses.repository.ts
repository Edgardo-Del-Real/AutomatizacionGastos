import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Expense, ExpenseMonthlySummary, NewExpense } from "./expenses.types";

type ExpenseRow = {
  id: string;
  ownerId: string;
  amount: Prisma.Decimal;
  currency: string;
  category: string | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
};

function mapExpenseRow(row: ExpenseRow): Expense {
  return {
    id: row.id,
    ownerId: row.ownerId,
    amount: row.amount.toNumber(),
    currency: row.currency,
    category: row.category,
    note: row.note,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

export interface ExpenseRepository {
  create(data: NewExpense): Promise<Expense>;
  findById(id: string, ownerId: string): Promise<Expense | null>;
  listByOwner(ownerId: string): Promise<Expense[]>;
  deleteById(id: string, ownerId: string): Promise<boolean>;
  summarizeByMonth(ownerId: string, from: Date): Promise<ExpenseMonthlySummary[]>;
  /**
   * D7/D8: splits a gross INCOME into a NET INCOME plus a SAVINGS movement,
   * both inside ONE transaction (a failing SAVINGS create rolls the net back
   * too). The net INCOME keeps `netCategory` (the preview-picked category);
   * ONLY the SAVINGS movement lands in `savingsCategory` ("ahorro"). Edge
   * cases: pct=100 (net 0) → only the SAVINGS movement; savings rounds to 0 →
   * only the whole INCOME.
   */
  createIncomeWithSavings(data: {
    ownerId: string;
    gross: number;
    percent: number;
    note: string | null;
    occurredAt: Date;
    netCategory: string;
    savingsCategory: string;
    visibility: "INDIVIDUAL" | "SHARED";
  }): Promise<{ net: Expense | null; savings: Expense | null }>;
  /**
   * shared-expense-split (D2/D8, spec "Two-Row Shared Registration"): splits a
   * partner-present COMPARTIDO into TWO SHARED EXPENSE rows inside ONE
   * transaction (a failing partner create rolls the sender row back too).
   * Sender part = round2(total*pct/100), partner part = total − sender part →
   * the invariant sender + partner === total holds exactly. Both rows are
   * SHARED·EXPENSE·PAID·ARS with the same category/note/occurredAt and
   * `sharedTotal = total`; the sender row lands under `ownerId` and the
   * partner row under `partnerId`. Returns the two amounts (null when nothing
   * registers).
   */
  createSharedSplit(data: {
    ownerId: string;
    partnerId: string;
    total: number;
    percent: number;
    note: string | null;
    occurredAt: Date;
    category: string;
  }): Promise<{ sender: number; partner: number } | null>;
}

export class PrismaExpenseRepository implements ExpenseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: NewExpense): Promise<Expense> {
    const row = await this.prisma.expense.create({
      data: {
        ownerId: data.ownerId,
        amount: new Prisma.Decimal(data.amount),
        currency: data.currency,
        category: data.category ?? null,
        note: data.note ?? null,
        occurredAt: data.occurredAt,
        type: data.type ?? "EXPENSE",
        visibility: data.visibility ?? "INDIVIDUAL",
        // Planned-expense pass-through: the create contract carries the status
        // (PENDING for planned expenses); absent status defaults to PAID.
        status: data.status ?? "PAID",
        // shared-expense-split: absent sharedTotal persists the NULL legacy
        // shape (the split rows carry it via createSharedSplit).
        ...(data.sharedTotal === undefined ? {} : { sharedTotal: new Prisma.Decimal(data.sharedTotal) }),
        // manual-savings: absent savingsOrigin persists the NULL legacy shape
        // (AUTO_SPLIT rows are stamped by createIncomeWithSavings; MANUAL
        // rows by the SAVINGS create branch in the service, slice PR2).
        ...(data.savingsOrigin === undefined ? {} : { savingsOrigin: data.savingsOrigin }),
      },
    });
    return mapExpenseRow(row);
  }

  async findById(id: string, ownerId: string): Promise<Expense | null> {
    const row = await this.prisma.expense.findFirst({ where: { id, ownerId, type: "EXPENSE" } });
    return row ? mapExpenseRow(row) : null;
  }

  async listByOwner(ownerId: string): Promise<Expense[]> {
    const rows = await this.prisma.expense.findMany({
      where: { ownerId, type: "EXPENSE" },
      orderBy: { occurredAt: "desc" },
    });
    return rows.map(mapExpenseRow);
  }

  async deleteById(id: string, ownerId: string): Promise<boolean> {
    const { count } = await this.prisma.expense.deleteMany({
      where: { id, ownerId, type: "EXPENSE" },
    });
    return count > 0;
  }

  async summarizeByMonth(ownerId: string, from: Date): Promise<ExpenseMonthlySummary[]> {
    type SummaryRow = {
      month: string;
      count: number;
      totalAmount: Prisma.Decimal | string | number;
    };
    const rows = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT
        to_char(date_trunc('month', "occurredAt"), 'YYYY-MM') AS "month",
        COUNT(*)::int AS "count",
        SUM("amount") AS "totalAmount"
      FROM "Expense"
      WHERE "ownerId" = ${ownerId}
        AND "occurredAt" >= ${from}
        AND "type" = 'EXPENSE'::"MovementType"
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      month: row.month,
      count: row.count,
      totalAmount: Number(row.totalAmount),
    }));
  }

  async createIncomeWithSavings(data: {
    ownerId: string;
    gross: number;
    percent: number;
    note: string | null;
    occurredAt: Date;
    netCategory: string;
    savingsCategory: string;
    visibility: "INDIVIDUAL" | "SHARED";
  }): Promise<{ net: Expense | null; savings: Expense | null }> {
    // Decimal arithmetic keeps the invariant exact: savings = round2(gross*pct/100),
    // net = gross - savings → net + savings === gross.
    const gross = new Prisma.Decimal(data.gross);
    const savingsAmount = gross.times(data.percent).div(100).toDecimalPlaces(2);
    const netAmount = gross.minus(savingsAmount);

    return this.prisma.$transaction(async (tx) => {
      let net: Expense | null = null;
      let savings: Expense | null = null;
      if (netAmount.gt(0)) {
        net = mapExpenseRow(
          await tx.expense.create({
            data: {
              ownerId: data.ownerId,
              amount: netAmount,
              currency: "ARS",
              category: data.netCategory,
              note: data.note,
              occurredAt: data.occurredAt,
              type: "INCOME",
              visibility: data.visibility,
            },
          }),
        );
      }
      if (savingsAmount.gt(0)) {
        savings = mapExpenseRow(
          await tx.expense.create({
            data: {
              ownerId: data.ownerId,
              amount: savingsAmount,
              currency: "ARS",
              category: data.savingsCategory,
              note: data.note,
              occurredAt: data.occurredAt,
              type: "SAVINGS",
              visibility: data.visibility,
              // manual-savings (D1): the split transaction is the ONLY producer
              // of AUTO_SPLIT rows; the net INCOME above stays origin-less and
              // legacy savings rows keep NULL (inert).
              savingsOrigin: "AUTO_SPLIT",
            },
          }),
        );
      }
      return { net, savings };
    });
  }

  async createSharedSplit(data: {
    ownerId: string;
    partnerId: string;
    total: number;
    percent: number;
    note: string | null;
    occurredAt: Date;
    category: string;
  }): Promise<{ sender: number; partner: number } | null> {
    // Decimal arithmetic keeps the invariant exact (mirror of createIncomeWithSavings):
    // senderPart = round2(total*pct/100), partnerPart = total − senderPart.
    const total = new Prisma.Decimal(data.total);
    const senderAmount = total.times(data.percent).div(100).toDecimalPlaces(2);
    const partnerAmount = total.minus(senderAmount);

    return this.prisma.$transaction(async (tx) => {
      await tx.expense.create({
        data: {
          ownerId: data.ownerId,
          amount: senderAmount,
          currency: "ARS",
          category: data.category,
          note: data.note,
          occurredAt: data.occurredAt,
          type: "EXPENSE",
          visibility: "SHARED",
          status: "PAID",
          sharedTotal: total,
        },
      });
      await tx.expense.create({
        data: {
          ownerId: data.partnerId,
          amount: partnerAmount,
          currency: "ARS",
          category: data.category,
          note: data.note,
          occurredAt: data.occurredAt,
          type: "EXPENSE",
          visibility: "SHARED",
          status: "PAID",
          sharedTotal: total,
        },
      });
      return { sender: senderAmount.toNumber(), partner: partnerAmount.toNumber() };
    });
  }
}
