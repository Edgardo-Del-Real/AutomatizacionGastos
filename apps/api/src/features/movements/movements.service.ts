import { updateMovementSchema, type Movement, type MovementSummary } from "@rita/contracts";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { MovementRepository } from "./movements.repository";
import type { MovementListFilters, SummaryPeriod } from "./movements.types";

const BA_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS_WINDOW = 6;
const DAYS_WINDOW = 30;
const TOP_LIMIT = 5;

export class MovementService {
  constructor(
    private readonly repository: MovementRepository,
    private readonly categoryService: CategoryService,
  ) {}

  async listMovements(ownerId: string, filters: MovementListFilters): Promise<Movement[]> {
    return this.repository.listByOwner(ownerId, filters);
  }

  /**
   * PATCH semantics (D12): only the present fields are written; null clears;
   * absent leaves unchanged; a string category must belong to the owner (422);
   * `type`/`occurredAt` are excluded by the shared contract.
   */
  async updateMovement(ownerId: string, id: string, patch: unknown): Promise<Movement> {
    const parsed = updateMovementSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid movement patch", parsed.error.issues);
    }
    if (parsed.data.category !== undefined && parsed.data.category !== null) {
      await this.categoryService.assertOwnerCategory(ownerId, parsed.data.category);
    }
    const updated = await this.repository.updateById(id, ownerId, parsed.data);
    if (updated === null) {
      throw new NotFoundError(`Movement ${id} not found`);
    }
    return updated;
  }

  async getSummary(ownerId: string, from?: string, to?: string): Promise<MovementSummary> {
    const period: SummaryPeriod = { from, to };
    const [kpis, months, daily, categories, topExpenses, topIncome] = await Promise.all([
      this.repository.summaryKpis(ownerId, period),
      this.repository.summaryMonths(ownerId),
      this.repository.summaryDaily(ownerId),
      this.repository.summaryCategories(ownerId, period),
      this.repository.topByType(ownerId, "EXPENSE", TOP_LIMIT, period),
      this.repository.topByType(ownerId, "INCOME", TOP_LIMIT, period),
    ]);

    const balance = kpis.income - kpis.expenses;
    const avgPerMonth = kpis.count === 0 ? 0 : balance / kpis.monthsWithData;
    const avgPerMovement = kpis.count === 0 ? 0 : (kpis.income + kpis.expenses) / kpis.count;

    const monthsMap = new Map(months.map((m) => [m.month, m]));
    const momMonths = lastMonths(MONTHS_WINDOW).map((month) => {
      const bucket = monthsMap.get(month);
      const income = bucket?.income ?? 0;
      const expenses = bucket?.expenses ?? 0;
      return { month, income, expenses, balance: income - expenses };
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
        avgPerMonth,
        avgPerMovement,
        maxAmount: kpis.maxAmount,
        count: kpis.count,
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
