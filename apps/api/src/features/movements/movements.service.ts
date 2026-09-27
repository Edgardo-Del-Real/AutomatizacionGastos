import { updateMovementSchema, type Movement, type MovementSummary } from "@rita/contracts";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { MovementRepository } from "./movements.repository";
import type { MovementListFilters, SummaryPeriod, ViewerScope } from "./movements.types";

const BA_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS_WINDOW = 6;
const DAYS_WINDOW = 30;
const TOP_LIMIT = 5;

export class MovementService {
  constructor(
    private readonly repository: MovementRepository,
    private readonly categoryService: CategoryService,
  ) {}

  async listMovements(scope: ViewerScope, filters: MovementListFilters): Promise<Movement[]> {
    return this.repository.listByOwner(scope, filters);
  }

  /**
   * PATCH semantics (D12): only the present fields are written; null clears;
   * absent leaves unchanged; a string category must belong to the owner (422);
   * `type`/`occurredAt` are excluded by the shared contract. The movement's own
   * type feeds the guard (D9): the SAVINGS category is rejected on EXPENSE and
   * INCOME movements.
   */
  async updateMovement(ownerId: string, id: string, patch: unknown): Promise<Movement> {
    const parsed = updateMovementSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid movement patch", parsed.error.issues);
    }
    if (parsed.data.category !== undefined && parsed.data.category !== null) {
      const movement = await this.repository.findById(id, ownerId);
      if (movement === null) {
        throw new NotFoundError(`Movement ${id} not found`);
      }
      await this.categoryService.assertOwnerCategory(ownerId, parsed.data.category, movement.type);
    }
    const updated = await this.repository.updateById(id, ownerId, parsed.data);
    if (updated === null) {
      throw new NotFoundError(`Movement ${id} not found`);
    }
    return updated;
  }

  async deleteMovement(ownerId: string, id: string): Promise<void> {
    const deleted = await this.repository.deleteById(id, ownerId);
    if (!deleted) {
      throw new NotFoundError(`Movement ${id} not found`);
    }
  }

  async getSummary(scope: ViewerScope, from?: string, to?: string): Promise<MovementSummary> {
    const period: SummaryPeriod = { from, to };
    const thisMonthPeriod = currentMonthPeriod();
    const [kpis, thisMonthKpis, savings, months, daily, categories, topExpenses, topIncome] =
      await Promise.all([
        this.repository.summaryKpis(scope, period),
        this.repository.summaryKpis(scope, thisMonthPeriod),
        // D3: kpis.savings is the current-calendar-month SAVINGS sum (the
        // period-scoped KPIs exclude SAVINGS entirely).
        this.repository.summarySavings(scope, thisMonthPeriod),
        this.repository.summaryMonths(scope),
        this.repository.summaryDaily(scope),
        this.repository.summaryCategories(scope, period),
        this.repository.topByType(scope, "EXPENSE", TOP_LIMIT, period),
        this.repository.topByType(scope, "INCOME", TOP_LIMIT, period),
      ]);

    const balance = kpis.income - kpis.expenses;
    const avgPerMonth = kpis.count === 0 ? 0 : balance / kpis.monthsWithData;
    const avgPerMovement = kpis.count === 0 ? 0 : (kpis.income + kpis.expenses) / kpis.count;

    const monthsMap = new Map(months.map((m) => [m.month, m]));
    const momMonths = lastMonths(MONTHS_WINDOW).map((month) => {
      const bucket = monthsMap.get(month);
      const income = bucket?.income ?? 0;
      const expenses = bucket?.expenses ?? 0;
      return { month, income, expenses, balance: income - expenses, savings: bucket?.savings ?? 0 };
    });

    const dailyMap = new Map(daily.map((d) => [d.day, d]));
    const dailySeries = lastDays(DAYS_WINDOW).map((day) => {
      const bucket = dailyMap.get(day);
      const income = bucket?.income ?? 0;
      const expenses = bucket?.expenses ?? 0;
      return { day, income, expenses, balance: income - expenses };
    });

    const categoryBreakdown = categories.map((category) => ({
      name: category.name,
      expenseAmount: category.expenseAmount,
      incomeAmount: category.incomeAmount,
      expensePercent: kpis.expenses === 0 ? 0 : (category.expenseAmount / kpis.expenses) * 100,
      incomePercent: kpis.income === 0 ? 0 : (category.incomeAmount / kpis.income) * 100,
    }));

    return {
      kpis: {
        income: kpis.income,
        expenses: kpis.expenses,
        balance,
        savings,
        avgPerMonth,
        avgPerMovement,
        maxAmount: kpis.maxAmount,
        count: kpis.count,
        countThisMonth: thisMonthKpis.count,
      },
      mom: { months: momMonths },
      daily: dailySeries,
      categories: categoryBreakdown,
      top: { expenses: topExpenses, income: topIncome },
    };
  }
}

function currentBaDate(): Date {
  return new Date(Date.now() - BA_OFFSET_MS);
}

function currentMonthPeriod(): SummaryPeriod {
  const now = currentBaDate();
  const monthKey = formatMonthKey(now);
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
  };
}

function lastMonths(count: number): string[] {
  const now = currentBaDate();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(formatMonthKey(d));
  }
  return keys;
}

function lastDays(count: number): string[] {
  const now = currentBaDate();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    keys.push(formatDayKey(d));
  }
  return keys;
}

function formatMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatDayKey(d: Date): string {
  return `${formatMonthKey(d)}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
