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
            },
          }),
        );
      }
      return { net, savings };
    });
  }
}
