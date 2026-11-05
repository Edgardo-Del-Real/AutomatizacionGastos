import { updateMovementSchema, type Movement, type MovementSummary } from "@rita/contracts";
import { ConflictError, NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import { normalizeCategoryName } from "../categories/matcher";
import { monthToPeriod } from "./ba-month";
import type { MovementRepository } from "./movements.repository";
import type { MovementListFilters, SummaryPeriod, ViewerScope } from "./movements.types";

const TOP_LIMIT = 5;

export class MovementService {
  constructor(
    private readonly repository: MovementRepository,
    private readonly categoryService: CategoryService,
  ) {}

  async listMovements(scope: ViewerScope, filters: MovementListFilters): Promise<Movement[]> {
    // monthly-dashboard: resolve the month key to a day range here, so the
    // repository keeps working with plain dates and routes stay declarative.
    const { month, ...rest } = filters;
    const resolved = month === undefined ? rest : { ...rest, ...monthToPeriod(month) };
    return this.repository.listByOwner(scope, resolved);
  }

  /**
   * PATCH semantics (D12): only the present fields are written; null clears;
   * absent leaves unchanged; a string category must belong to the owner (422);
   * `type`/`occurredAt` are excluded by the shared contract. The movement's own
   * type feeds the guard (D9): the SAVINGS category is rejected on EXPENSE and
   * INCOME movements.
   *
   * manual-savings PATCH pin (D1/D9): a MANUAL-savings row is pinned to the
   * "ahorro" category — drifting it to another category OR clearing it with
   * null is rejected (422). AUTO_SPLIT and legacy NULL-origin rows keep the
   * existing category freedom (only MANUAL rows are deducted, so only they
   * pin). `type` stays immutable via the shared contract, so a row can never
   * be unpinned by reclassifying it.
   */
  async updateMovement(ownerId: string, id: string, patch: unknown): Promise<Movement> {
    const parsed = updateMovementSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid movement patch", parsed.error.issues);
    }
    if (parsed.data.category !== undefined) {
      const movement = await this.repository.findById(id, ownerId);
      if (movement === null) {
        throw new NotFoundError(`Movement ${id} not found`);
      }
      if (
        movement.type === "SAVINGS" &&
        movement.savingsOrigin === "MANUAL" &&
        (parsed.data.category === null ||
          normalizeCategoryName(parsed.data.category) !== "AHORRO")
      ) {
        throw new ValidationFailedError("Manual savings are pinned to the ahorro category");
      }
      if (parsed.data.category !== null) {
        await this.categoryService.assertOwnerCategory(ownerId, parsed.data.category, movement.type);
      }
    }
    // Canonical storage shape: the patch is normalized before it is written.
    const patchData =
      typeof parsed.data.category === "string"
        ? { ...parsed.data, category: normalizeCategoryName(parsed.data.category) }
        : parsed.data;
    const updated = await this.repository.updateById(id, ownerId, patchData);
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

  /**
   * D5 — mark-paid transition. The guarded single-write happens in the
   * repository; a 0-row result is disambiguated by existence: missing (or
   * another owner's) movement → 404, existing-but-not-PENDING-EXPENSE (already
   * PAID, non-EXPENSE, or a concurrent transition) → 409.
   */
  async markMovementPaid(ownerId: string, id: string): Promise<Movement> {
    const paid = await this.repository.markPaidById(id, ownerId);
    if (paid !== null) {
      return paid;
    }
    const existing = await this.repository.findById(id, ownerId);
    if (existing === null) {
      throw new NotFoundError(`Movement ${id} not found`);
    }
    throw new ConflictError(`Movement ${id} is not a PENDING EXPENSE`);
  }

  /**
   * monthly-dashboard: the summary is period-driven. `month` (`YYYY-MM`) scopes
   * every block to that Buenos Aires calendar month; omitting it returns
   * lifetime totals with an empty daily series (the bot's "cuánto tengo" is a
   * lifetime question). Previstos carry no date, so `planned` never sees the
   * month.
   */
  async getSummary(scope: ViewerScope, month?: string): Promise<MovementSummary> {
    const period: SummaryPeriod = month === undefined ? {} : monthToPeriod(month);
    const [kpis, savings, manualSavings, daily, categories, topExpenses, topIncome, pending] =
      await Promise.all([
        this.repository.summaryKpis(scope, period),
        // kpis.savings and kpis.manualSavings share ONE scope: the requested
        // period. They used to disagree (savings pinned to the current month),
        // which made a past month report today's savings.
        this.repository.summarySavings(scope, period),
        // manualSavings is deducted from balance; savings is informational.
        this.repository.summaryManualSavings(scope, period),
        this.repository.summaryDaily(scope, period),
        this.repository.summaryCategories(scope, period),
        this.repository.topByType(scope, "EXPENSE", TOP_LIMIT, period),
        this.repository.topByType(scope, "INCOME", TOP_LIMIT, period),
        // Previstos carry no date, so they are NOT period-scoped: the block is
        // the outstanding rows themselves (the monthly table cannot show them,
        // and the mark-paid action needs a surface).
        this.repository.listByOwner(scope, { type: "EXPENSE", status: "PENDING" }),
      ]);

    // manual-savings (D2): kpis excludes SAVINGS entirely, so manual savings
    // never appear in income/expenses; they deduct from the balance on top of
    // the non-savings income and expenses.
    const balance = kpis.income - kpis.expenses - manualSavings;
    const avgPerMonth = kpis.count === 0 ? 0 : balance / kpis.monthsWithData;
    const avgPerMovement = kpis.count === 0 ? 0 : (kpis.income + kpis.expenses) / kpis.count;

    const dailyMap = new Map(daily.map((d) => [d.day, d]));
    const dailySeries = daysOfPeriod(period).map((day) => {
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
        manualSavings,
        avgPerMonth,
        avgPerMovement,
        maxAmount: kpis.maxAmount,
        count: kpis.count,
      },
      daily: dailySeries,
      categories: categoryBreakdown,
      top: { expenses: topExpenses, income: topIncome },
      // ARS-only total, mirroring the currency rule for every other block; the
      // rows ride along so the dashboard can list and mark them paid.
      planned: {
        total: pending
          .filter((movement) => movement.currency === "ARS")
          .reduce((sum, movement) => sum + movement.amount, 0),
        movements: pending,
      },
    };
  }
}

/**
 * Every day of the requested period, ascending; the service zero-fills the
 * series from these keys. A period-less request (lifetime totals) has no daily
 * series, so it returns nothing instead of inventing a window.
 */
function daysOfPeriod(period: SummaryPeriod): string[] {
  if (period.from === undefined || period.to === undefined) {
    return [];
  }
  const start = Date.parse(`${period.from}T00:00:00Z`);
  const end = Date.parse(`${period.to}T00:00:00Z`);
  const days: string[] = [];
  for (let at = start; at <= end; at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}
