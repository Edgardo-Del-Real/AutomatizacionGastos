import type { CategoryService } from "../categories/categories.service";
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
    const movements = await this.movementService.listMovements(scope, {});
    // Planned expenses are visible ONLY through the planned query (spec
    // telegram-bot "Recent Movements Exclude Planned"): the PENDING rows are
    // filtered here, at the telegram layer, never at the repository (the
    // dashboard reads PENDING from the movement list).
    return {
      query_type: "recent",
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
    const summary = await this.movementService.getSummary(scope);
    return {
      query_type: "balance",
      balance: summary.kpis.balance,
      income: summary.kpis.income,
      expenses: summary.kpis.expenses,
    };
  }

  private async month(scope: ViewerScope): Promise<QueryExecutionResult> {
    const summary = await this.movementService.getSummary(scope);
    // The mom series always ends with the current Buenos Aires month bucket.
    const current = summary.mom.months.at(-1);
    return {
      query_type: "month",
      month: current?.month ?? "",
      monthIncome: current?.income ?? 0,
      monthExpenses: current?.expenses ?? 0,
      monthCount: summary.kpis.countThisMonth,
    };
  }

  /** D12: "cuánto ahorré este mes" — kpis.savings + the last mom month key. */
  private async savings(scope: ViewerScope): Promise<QueryExecutionResult> {
    const summary = await this.movementService.getSummary(scope);
    return {
      query_type: "savings",
      month: summary.mom.months.at(-1)?.month ?? "",
      savings: summary.kpis.savings,
    };
  }

  /** D6/D7: "cuánto tengo previsto" — the next-month PENDING EXPENSE total. */
  private async planned(scope: ViewerScope): Promise<QueryExecutionResult> {
    const summary = await this.movementService.getSummary(scope);
    return {
      query_type: "planned",
      month: summary.planned.month,
      total: summary.planned.total,
    };
  }
}