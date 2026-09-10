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
}
