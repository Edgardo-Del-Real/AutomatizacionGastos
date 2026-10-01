import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Movement, MovementStatus, MovementType, MovementVisibility } from "@rita/contracts";
import type {
  CategoryBucket,
  DayBucket,
  KpiTotals,
  MonthBucket,
  MovementListFilters,
  SummaryPeriod,
  ViewerScope,
} from "./movements.types";

const BA_TIMEZONE = "America/Argentina/Buenos_Aires";

type MovementRow = {
  id: string;
  ownerId: string;
  /** Derived alias of `ownerId` (AD5): the creating owner, carried on the wire. */
  registrantId: string;
  amount: Prisma.Decimal;
  currency: string;
  category: string | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
  type: MovementType;
  visibility: MovementVisibility;
  status: MovementStatus;
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
    registrantId: row.registrantId,
    amount: toNumber(row.amount),
    currency: row.currency,
    category: row.category,
    note: row.note,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    type: row.type,
    visibility: row.visibility,
    status: row.status,
  };
}

function periodConditions(period: SummaryPeriod): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (period.from) {
    // The day boundary is Buenos Aires wall-clock (−03:00): a movement created
    // at 21:00–24:00 ART is on the NEXT UTC day but still the SAME BA month.
    conditions.push(Prisma.sql`"occurredAt" >= ${baDayStart(period.from)}`);
  }
  if (period.to) {
    conditions.push(Prisma.sql`"occurredAt" <= ${baDayEnd(period.to)}`);
  }
  return conditions;
}

/** Start of a BA wall-clock day as a UTC instant: `YYYY-MM-DDT00:00:00-03:00`. */
function baDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000-03:00`);
}

/** End of a BA wall-clock day as a UTC instant: `YYYY-MM-DDT23:59:59.999-03:00`. */
function baDayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999-03:00`);
}

/**
 * D1 — the ONE SAVINGS-exclusion surface: every aggregate that must never
 * count savings (summaryKpis, summaryDaily, summaryCategories) composes this
 * fragment. CASE sums would exclude SAVINGS implicitly, but COUNT, MAX,
 * monthsWithData and the categories GROUP BY would leak the rows.
 */
const SAVINGS_EXCLUDED = Prisma.sql`"type" <> 'SAVINGS'::"MovementType"`;

/**
 * D2 — the ONE PENDING-exclusion surface: every KPI aggregate that must never
 * count planned expenses (summaryKpis, summaryDaily, summaryCategories,
 * topByType, summaryMonths) composes this fragment. It is NEVER applied to
 * listByOwner (the movement list keeps PENDING rows) or summarySavings
 * (SAVINGS rows are always PAID by the create refine).
 */
const PENDING_EXCLUDED = Prisma.sql`"status" <> 'PENDING'::"MovementStatus"`;

export interface MovementRepository {
  listByOwner(scope: ViewerScope, filters: MovementListFilters): Promise<Movement[]>;
  summaryKpis(scope: ViewerScope, period: SummaryPeriod): Promise<KpiTotals>;
  summaryMonths(scope: ViewerScope): Promise<MonthBucket[]>;
  summaryDaily(scope: ViewerScope): Promise<DayBucket[]>;
  summaryCategories(scope: ViewerScope, period: SummaryPeriod): Promise<CategoryBucket[]>;
  topByType(scope: ViewerScope, type: MovementType, limit: number, period: SummaryPeriod): Promise<Movement[]>;
  /** D3: current-calendar-month SAVINGS sum (ARS, viewer-scoped). */
  summarySavings(scope: ViewerScope, period: SummaryPeriod): Promise<number>;
  /**
   * D4: the owner's PENDING EXPENSE total whose derived month (occurredAt + 1
   * month, Buenos Aires) equals `month`. Ignores any from/to filters by design.
   */
  summaryPlanned(scope: ViewerScope, month: string): Promise<{ month: string; total: number }>;
  /** D5: guarded single-write mark-paid transition (EXPENSE ∧ PENDING). */
  markPaidById(id: string, ownerId: string): Promise<Movement | null>;
  findById(id: string, ownerId: string): Promise<Movement | null>;
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

  /**
   * AD3 — the ONE leak-guard surface: every raw movement SELECT composes this
   * fragment as `conditions[0]`. own rows are always visible; the partner's
   * SHARED rows are visible only when a partner exists (partner-null reduces
   * to owner-only in single-user mode). Prisma flattens nested `Prisma.Sql`
   * fragments so positional parameter order stays safe.
   */
  private viewerPredicate(scope: ViewerScope): Prisma.Sql {
    const own = Prisma.sql`"ownerId" = ${scope.viewerId}`;
    const partnerShared =
      scope.partnerId === null
        ? Prisma.sql`FALSE`
        : Prisma.sql`("visibility" = 'SHARED'::"MovementVisibility" AND "ownerId" = ${scope.partnerId})`;
    switch (scope.visibility) {
      case "mine":
        return own;
      case "shared":
        return Prisma.sql`"visibility" = 'SHARED'::"MovementVisibility" AND (${own} OR ${partnerShared})`;
      case "all":
        return Prisma.sql`(${own} OR ${partnerShared})`;
    }
  }

  async listByOwner(scope: ViewerScope, filters: MovementListFilters): Promise<Movement[]> {
    const conditions: Prisma.Sql[] = [this.viewerPredicate(scope)];
    if (filters.type) {
      conditions.push(Prisma.sql`"type" = ${filters.type}::"MovementType"`);
    }
    if (filters.from) {
      conditions.push(Prisma.sql`"occurredAt" >= ${baDayStart(filters.from)}`);
    }
    if (filters.to) {
      conditions.push(Prisma.sql`"occurredAt" <= ${baDayEnd(filters.to)}`);
    }
    if (filters.category) {
      conditions.push(Prisma.sql`"category" = ${filters.category}`);
    }
    if (filters.q) {
      conditions.push(Prisma.sql`"note" ILIKE ${`%${filters.q}%`}`);
    }
    const where = Prisma.join(conditions, " AND ");
    const rows = await this.prisma.$queryRaw<MovementRow[]>`
      SELECT "id", "ownerId", "ownerId" AS "registrantId", "amount", "currency", "category", "note", "occurredAt", "createdAt", "type", "visibility", "status"
      FROM "Expense"
      WHERE ${where}
      ORDER BY "occurredAt" DESC
    `;
    return rows.map(mapMovementRow);
  }

  async summaryKpis(scope: ViewerScope, period: SummaryPeriod): Promise<KpiTotals> {
    const conditions: Prisma.Sql[] = [
      this.viewerPredicate(scope),
      Prisma.sql`"currency" = 'ARS'`,
      SAVINGS_EXCLUDED,
      PENDING_EXCLUDED,
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

  async summaryMonths(scope: ViewerScope): Promise<MonthBucket[]> {
    const conditions: Prisma.Sql[] = [
      this.viewerPredicate(scope),
      Prisma.sql`"currency" = 'ARS'`,
      // D3 — the trap: PENDING is excluded from the income/expense sums, but the
      // SAVINGS CASE column stays untouched (PENDING rows are always
      // EXPENSE-typed, so the savings column never intersects PENDING).
      PENDING_EXCLUDED,
      Prisma.sql`"occurredAt" >= (date_trunc('month', now() AT TIME ZONE ${BA_TIMEZONE}) - interval '5 months')`,
    ];
    const where = Prisma.join(conditions, " AND ");
    type MonthRow = {
      month: string;
      income: DecimalLike;
      expenses: DecimalLike;
      savings: DecimalLike;
    };
    const rows = await this.prisma.$queryRaw<MonthRow[]>`
      SELECT
        to_char(date_trunc('month',
          "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BA_TIMEZONE}), 'YYYY-MM') AS "month",
        COALESCE(SUM(CASE WHEN "type" = 'INCOME'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "income",
        COALESCE(SUM(CASE WHEN "type" = 'EXPENSE'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "expenses",
        COALESCE(SUM(CASE WHEN "type" = 'SAVINGS'::"MovementType" THEN "amount" ELSE 0 END), 0) AS "savings"
      FROM "Expense"
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      month: row.month,
      income: toNumber(row.income),
      expenses: toNumber(row.expenses),
      savings: toNumber(row.savings),
    }));
  }

  async summaryDaily(scope: ViewerScope): Promise<DayBucket[]> {
    const conditions: Prisma.Sql[] = [
      this.viewerPredicate(scope),
      Prisma.sql`"currency" = 'ARS'`,
      SAVINGS_EXCLUDED,
      PENDING_EXCLUDED,
      Prisma.sql`("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BA_TIMEZONE})
        >= date_trunc('day', now() AT TIME ZONE ${BA_TIMEZONE}) - interval '29 days'`,
    ];
    const where = Prisma.join(conditions, " AND ");
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
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      day: row.day,
      income: toNumber(row.income),
      expenses: toNumber(row.expenses),
    }));
  }

  async summaryCategories(scope: ViewerScope, period: SummaryPeriod): Promise<CategoryBucket[]> {
    const conditions: Prisma.Sql[] = [
      this.viewerPredicate(scope),
      Prisma.sql`"currency" = 'ARS'`,
      SAVINGS_EXCLUDED,
      PENDING_EXCLUDED,
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
    scope: ViewerScope,
    type: MovementType,
    limit: number,
    period: SummaryPeriod,
  ): Promise<Movement[]> {
    const conditions: Prisma.Sql[] = [
      this.viewerPredicate(scope),
      Prisma.sql`"currency" = 'ARS'`,
      Prisma.sql`"type" = ${type}::"MovementType"`,
      PENDING_EXCLUDED,
      ...periodConditions(period),
    ];
    const where = Prisma.join(conditions, " AND ");
    const rows = await this.prisma.$queryRaw<MovementRow[]>`
      SELECT "id", "ownerId", "ownerId" AS "registrantId", "amount", "currency", "category", "note", "occurredAt", "createdAt", "type", "visibility", "status"
      FROM "Expense"
      WHERE ${where}
      ORDER BY "amount" DESC
      LIMIT ${limit}
    `;
    return rows.map(mapMovementRow);
  }

  async summarySavings(scope: ViewerScope, period: SummaryPeriod): Promise<number> {
    const conditions: Prisma.Sql[] = [
      this.viewerPredicate(scope),
      Prisma.sql`"currency" = 'ARS'`,
      Prisma.sql`"type" = 'SAVINGS'::"MovementType"`,
      ...periodConditions(period),
    ];
    const where = Prisma.join(conditions, " AND ");
    const rows = await this.prisma.$queryRaw<{ savings: DecimalLike }[]>`
      SELECT COALESCE(SUM("amount"), 0) AS "savings"
      FROM "Expense"
      WHERE ${where}
    `;
    return toNumber(rows[0]?.savings);
  }

  /**
   * D4 — the planned block: sum of the owner's PENDING EXPENSE movements whose
   * derived month equals `month`. The month is derived per row in SQL using the
   * same BA idiom as the bucketing aggregates (naive-UTC column → BA wall time)
   * plus one month, so the boundary scenario behaves identically to mom/daily.
   * No period conditions are composed here — planned ignores from/to by design.
   */
  async summaryPlanned(
    scope: ViewerScope,
    month: string,
  ): Promise<{ month: string; total: number }> {
    const conditions: Prisma.Sql[] = [
      this.viewerPredicate(scope),
      Prisma.sql`"currency" = 'ARS'`,
      Prisma.sql`"type" = 'EXPENSE'::"MovementType"`,
      Prisma.sql`"status" = 'PENDING'::"MovementStatus"`,
      Prisma.sql`to_char(date_trunc('month',
        ("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BA_TIMEZONE})
        + interval '1 month'), 'YYYY-MM') = ${month}`,
    ];
    const where = Prisma.join(conditions, " AND ");
    const rows = await this.prisma.$queryRaw<{ total: DecimalLike }[]>`
      SELECT COALESCE(SUM("amount"), 0) AS "total"
      FROM "Expense"
      WHERE ${where}
    `;
    return { month, total: toNumber(rows[0]?.total) };
  }

  /**
   * D5 — the guarded single-write transition: the guards live in the WHERE
   * (owner-scoped, EXPENSE, PENDING), and only a successful match rewrites
   * status + occurredAt together. `occurredAt` moves to the payment date so the
   * movement enters aggregates on the day it was actually paid.
   */
  async markPaidById(id: string, ownerId: string): Promise<Movement | null> {
    const updated = await this.prisma.expense.updateMany({
      where: { id, ownerId, type: "EXPENSE", status: "PENDING" },
      data: { status: "PAID", occurredAt: new Date() },
    });
    if (updated.count === 0) {
      return null;
    }
    const row = await this.prisma.expense.findFirst({ where: { id, ownerId } });
    return row === null ? null : mapMovementRow({ ...row, registrantId: row.ownerId });
  }

  /** Resolves the movement for PATCH guards (D9): type decides whether the SAVINGS category is allowed. */
  async findById(id: string, ownerId: string): Promise<Movement | null> {
    const row = await this.prisma.expense.findFirst({ where: { id, ownerId } });
    return row === null ? null : mapMovementRow({ ...row, registrantId: row.ownerId });
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
    return row === null ? null : mapMovementRow({ ...row, registrantId: row.ownerId });
  }

  async deleteById(id: string, ownerId: string): Promise<boolean> {
    const deleted = await this.prisma.expense.deleteMany({ where: { id, ownerId } });
    return deleted.count > 0;
  }
}
