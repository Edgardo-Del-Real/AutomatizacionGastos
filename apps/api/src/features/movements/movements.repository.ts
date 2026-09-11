import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Movement, MovementType } from "@rita/contracts";
import type {
  CategoryBucket,
  DayBucket,
  KpiTotals,
  MonthBucket,
  MovementListFilters,
  SummaryPeriod,
} from "./movements.types";

const BA_TIMEZONE = "America/Argentina/Buenos_Aires";

type MovementRow = {
  id: string;
  ownerId: string;
  amount: Prisma.Decimal;
  currency: string;
  category: string | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
  type: MovementType;
};

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return value.toNumber();
}

function mapMovementRow(row: MovementRow): Movement {
  return {
    id: row.id,
    ownerId: row.ownerId,
    amount: toNumber(row.amount),
    currency: row.currency,
    category: row.category,
    note: row.note,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    type: row.type,
  };
}

function periodConditions(period: SummaryPeriod): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (period.from) {
    conditions.push(Prisma.sql`"occurredAt" >= ${new Date(`${period.from}T00:00:00.000Z`)}`);
  }
  if (period.to) {
    conditions.push(Prisma.sql`"occurredAt" <= ${new Date(`${period.to}T23:59:59.999Z`)}`);
  }
  return conditions;
}

export interface MovementRepository {
  listByOwner(ownerId: string, filters: MovementListFilters): Promise<Movement[]>;
  summaryKpis(ownerId: string, period: SummaryPeriod): Promise<KpiTotals>;
  summaryMonths(ownerId: string): Promise<MonthBucket[]>;
  summaryDaily(ownerId: string): Promise<DayBucket[]>;
  summaryCategories(ownerId: string, period: SummaryPeriod): Promise<CategoryBucket[]>;
  topByType(ownerId: string, type: MovementType, limit: number, period: SummaryPeriod): Promise<Movement[]>;
  updateById(
    id: string,
    ownerId: string,
    patch: { amount?: number; note?: string | null; category?: string | null },
  ): Promise<Movement | null>;
  deleteById(id: string, ownerId: string): Promise<boolean>;
}

export type UpdateMovementPatch = {
  amount?: number;
  note?: string | null;
  category?: string | null;
};

export class PrismaMovementRepository implements MovementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByOwner(ownerId: string, filters: MovementListFilters): Promise<Movement[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`"ownerId" = ${ownerId}`];
    if (filters.type) {
      conditions.push(Prisma.sql`"type" = ${filters.type}::"MovementType"`);
    }
    if (filters.from) {
      conditions.push(Prisma.sql`"occurredAt" >= ${new Date(`${filters.from}T00:00:00.000Z`)}`);
    }
    if (filters.to) {
      conditions.push(Prisma.sql`"occurredAt" <= ${new Date(`${filters.to}T23:59:59.999Z`)}`);
    }
    if (filters.category) {
      conditions.push(Prisma.sql`"category" = ${filters.category}`);
    }
    if (filters.q) {
      conditions.push(Prisma.sql`"note" ILIKE ${`%${filters.q}%`}`);
    }
    const where = Prisma.join(conditions, " AND ");
    const rows = await this.prisma.$queryRaw<MovementRow[]>`
      SELECT "id", "ownerId", "amount", "currency", "category", "note", "occurredAt", "createdAt", "type"
      FROM "Expense"
      WHERE ${where}
      ORDER BY "occurredAt" DESC
    `;
    return rows.map(mapMovementRow);
  }

  async summaryKpis(ownerId: string, period: SummaryPeriod): Promise<KpiTotals> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"ownerId" = ${ownerId}`,
      Prisma.sql`"currency" = 'ARS'`,
      ...periodConditions(period),
    ];
    const where = Prisma.join(conditions, " AND ");
    type KpiRow = {
      income: DecimalLike;
      expenses: DecimalLike;
      count: number;
      maxAmount: DecimalLike;
      monthsWithData: number;
    };
    const rows = await this.prisma.$queryRaw<KpiRow[]>`
      SELECT
        COALESCE(SUM(CASE WHEN "type" = 'INCOME'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "income",
        COALESCE(SUM(CASE WHEN "type" = 'EXPENSE'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "expenses",
        COUNT(*)::int AS "count",
        COALESCE(MAX("amount"), 0) AS "maxAmount",
        COUNT(DISTINCT to_char(date_trunc('month',
          "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BA_TIMEZONE}), 'YYYY-MM'))::int AS "monthsWithData"
      FROM "Expense"
      WHERE ${where}
    `;
    const row = rows[0];
    return {
      income: toNumber(row?.income),
      expenses: toNumber(row?.expenses),
      count: row?.count ?? 0,
      maxAmount: toNumber(row?.maxAmount),
      monthsWithData: row?.monthsWithData ?? 0,
    };
  }

  async summaryMonths(ownerId: string): Promise<MonthBucket[]> {
    type MonthRow = {
      month: string;
      income: DecimalLike;
      expenses: DecimalLike;
    };
    const rows = await this.prisma.$queryRaw<MonthRow[]>`
      SELECT
        to_char(date_trunc('month',
          "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BA_TIMEZONE}), 'YYYY-MM') AS "month",
        COALESCE(SUM(CASE WHEN "type" = 'INCOME'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "income",
        COALESCE(SUM(CASE WHEN "type" = 'EXPENSE'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "expenses"
      FROM "Expense"
      WHERE "ownerId" = ${ownerId}
        AND "currency" = 'ARS'
        AND "occurredAt" >= (date_trunc('month', now() AT TIME ZONE ${BA_TIMEZONE}) - interval '5 months')
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      month: row.month,
      income: toNumber(row.income),
      expenses: toNumber(row.expenses),
    }));
  }

  async summaryDaily(ownerId: string): Promise<DayBucket[]> {
    type DayRow = {
      day: string;
      income: DecimalLike;
      expenses: DecimalLike;
    };
    const rows = await this.prisma.$queryRaw<DayRow[]>`
      SELECT
        to_char(
          "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BA_TIMEZONE}, 'YYYY-MM-DD') AS "day",
        COALESCE(SUM(CASE WHEN "type" = 'INCOME'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "income",
        COALESCE(SUM(CASE WHEN "type" = 'EXPENSE'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "expenses"
      FROM "Expense"
      WHERE "ownerId" = ${ownerId}
        AND "currency" = 'ARS'
        AND ("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BA_TIMEZONE})
          >= date_trunc('day', now() AT TIME ZONE ${BA_TIMEZONE}) - interval '29 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      day: row.day,
      income: toNumber(row.income),
      expenses: toNumber(row.expenses),
    }));
  }

  async summaryCategories(ownerId: string, period: SummaryPeriod): Promise<CategoryBucket[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"ownerId" = ${ownerId}`,
      Prisma.sql`"currency" = 'ARS'`,
      ...periodConditions(period),
    ];
    const where = Prisma.join(conditions, " AND ");
    type CategoryRow = {
      name: string;
      expenseAmount: DecimalLike;
      incomeAmount: DecimalLike;
    };
    const rows = await this.prisma.$queryRaw<CategoryRow[]>`
      SELECT
        COALESCE("category", '') AS "name",
        COALESCE(SUM(CASE WHEN "type" = 'EXPENSE'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "expenseAmount",
        COALESCE(SUM(CASE WHEN "type" = 'INCOME'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "incomeAmount"
      FROM "Expense"
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      name: row.name,
      expenseAmount: toNumber(row.expenseAmount),
      incomeAmount: toNumber(row.incomeAmount),
    }));
  }

  async topByType(
    ownerId: string,
    type: MovementType,
    limit: number,
    period: SummaryPeriod,
  ): Promise<Movement[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"ownerId" = ${ownerId}`,
      Prisma.sql`"currency" = 'ARS'`,
      Prisma.sql`"type" = ${type}::"MovementType"`,
      ...periodConditions(period),
    ];
    const where = Prisma.join(conditions, " AND ");
    const rows = await this.prisma.$queryRaw<MovementRow[]>`
      SELECT "id", "ownerId", "amount", "currency", "category", "note", "occurredAt", "createdAt", "type"
      FROM "Expense"
      WHERE ${where}
      ORDER BY "amount" DESC
      LIMIT ${limit}
    `;
    return rows.map(mapMovementRow);
  }

  async updateById(
    id: string,
    ownerId: string,
    patch: UpdateMovementPatch,
  ): Promise<Movement | null> {
    const updated = await this.prisma.expense.updateMany({ where: { id, ownerId }, data: patch });
    if (updated.count === 0) {
      return null;
    }
    const row = await this.prisma.expense.findFirst({ where: { id, ownerId } });
    return row === null ? null : mapMovementRow(row);
  }

  async deleteById(id: string, ownerId: string): Promise<boolean> {
    const deleted = await this.prisma.expense.deleteMany({ where: { id, ownerId } });
    return deleted.count > 0;
  }
}
