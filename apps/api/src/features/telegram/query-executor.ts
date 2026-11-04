import type { CategoryService } from "../categories/categories.service";
import { currentBaMonth } from "../movements/ba-month";
import type { MovementService } from "../movements/movements.service";
import type { ViewerScope } from "../movements/movements.types";
import type { QueryExecutionResult, QueryType } from "./query.types";

export { deriveQueryType } from "./query.types";

const RECENT_LIMIT = 5;

/**
 * Deterministic query executors: fetch the viewer's REAL data for each
 * query_type and shape it for the LLM reply. The result is passed to
 * `brain.reply(result)` so the conversational answer is always grounded in the
 * executed data; the fixed `reply-text.ts` templates render the same shape.
 * Movement reads go through the same viewer-scoped predicate as the dashboard.
 */
export class QueryExecutor {
  constructor(
    private readonly movementService: MovementService,
    private readonly categoryService: CategoryService,
  ) {}

  async execute(scope: ViewerScope, queryType: QueryType): Promise<QueryExecutionResult> {
    switch (queryType) {
      case "categories":
        return this.categories(scope);
      case "recent":
        return this.recent(scope);
      case "balance":
        return this.balance(scope);
      case "month":
        return this.month(scope);
      case "savings":
        return this.savings(scope);
      case "planned":
        return this.planned(scope);
    }
  }

  private async categories(scope: ViewerScope): Promise<QueryExecutionResult> {
    const categories = await this.categoryService.listCategories(scope.viewerId);
    return {
      query_type: "categories",
      categories: categories.map((category) => ({
        name: category.name,
        keywords: category.keywords,
      })),
    };
  }

  private async recent(scope: ViewerScope): Promise<QueryExecutionResult> {
    // RULE: current month only, like every other query — and it stops the bot
    // from loading the whole history in memory just to show five rows.
    const month = currentBaMonth();
    const movements = await this.movementService.listMovements(scope, { month });
    // Planned expenses are visible ONLY through the planned query (spec
    // telegram-bot "Recent Movements Exclude Planned"): the PENDING rows are
    // filtered here, at the telegram layer, never at the repository (the
    // dashboard reads PENDING from the movement list).
    return {
      query_type: "recent",
      month,
      movements: movements
        .filter((movement) => movement.status !== "PENDING")
        .slice(0, RECENT_LIMIT)
        .map((movement) => ({
          amount: movement.amount,
          category: movement.category,
          note: movement.note,
          date: movement.occurredAt.toISOString().slice(0, 10),
          type: movement.type,
        })),
    };
  }

  private async balance(scope: ViewerScope): Promise<QueryExecutionResult> {
    // RULE: the bot ALWAYS answers about the current Buenos Aires month. Past
    // periods belong to the dashboard. The lifetime scope this used to have
    // disagreed with the dashboard and answered "octubre + noviembre" when the
    // owner asked for "saldo".
    const month = currentBaMonth();
    const summary = await this.movementService.getSummary(scope, month);
    return {
      query_type: "balance",
      month,
      balance: summary.kpis.balance,
      income: summary.kpis.income,
      expenses: summary.kpis.expenses,
    };
  }

  private async month(scope: ViewerScope): Promise<QueryExecutionResult> {
    // monthly-dashboard: the bot asks for the CURRENT Buenos Aires month
    // explicitly instead of inferring it from the last trend bucket.
    const month = currentBaMonth();
    const summary = await this.movementService.getSummary(scope, month);
    return {
      query_type: "month",
      month,
      monthIncome: summary.kpis.income,
      monthExpenses: summary.kpis.expenses,
      monthCount: summary.kpis.count,
    };
  }

  /** D12: "cuánto ahorré este mes" — kpis.savings scoped to the current month. */
  private async savings(scope: ViewerScope): Promise<QueryExecutionResult> {
    const month = currentBaMonth();
    const summary = await this.movementService.getSummary(scope, month);
    return {
      query_type: "savings",
      month,
      savings: summary.kpis.savings,
    };
  }

  /** D6/D7: "cuánto tengo previsto" — the outstanding PENDING EXPENSE total. */
  private async planned(scope: ViewerScope): Promise<QueryExecutionResult> {
    // Only the outstanding rows are needed: asking getSummary() for its
    // `planned` block ran the whole 8-query dashboard aggregate for one number.
    const pending = await this.movementService.listMovements(scope, {
      type: "EXPENSE",
      status: "PENDING",
    });
    const total = pending
      .filter((movement) => movement.currency === "ARS")
      .reduce((sum, movement) => sum + movement.amount, 0);
    return {
      query_type: "planned",
      total,
    };
  }
}