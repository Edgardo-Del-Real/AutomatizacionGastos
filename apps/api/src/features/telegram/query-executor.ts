import type { CategoryService } from "../categories/categories.service";
import type { MovementService } from "../movements/movements.service";
import type { QueryExecutionResult, QueryType } from "./query.types";

export { deriveQueryType } from "./query.types";

const RECENT_LIMIT = 5;

/**
 * Deterministic query executors: fetch the owner's REAL data for each
 * query_type and shape it for the LLM reply. The result is passed to
 * `brain.reply(result)` so the conversational answer is always grounded in the
 * executed data; the fixed `reply-text.ts` templates render the same shape.
 */
export class QueryExecutor {
  constructor(
    private readonly movementService: MovementService,
    private readonly categoryService: CategoryService,
  ) {}

  async execute(ownerId: string, queryType: QueryType): Promise<QueryExecutionResult> {
    switch (queryType) {
      case "categories":
        return this.categories(ownerId);
      case "recent":
        return this.recent(ownerId);
      case "balance":
        return this.balance(ownerId);
      case "month":
        return this.month(ownerId);
    }
  }

  private async categories(ownerId: string): Promise<QueryExecutionResult> {
    const categories = await this.categoryService.listCategories(ownerId);
    return {
      query_type: "categories",
      categories: categories.map((category) => ({
        name: category.name,
        keywords: category.keywords,
      })),
    };
  }

  private async recent(ownerId: string): Promise<QueryExecutionResult> {
    const movements = await this.movementService.listMovements(ownerId, {});
    return {
      query_type: "recent",
      movements: movements.slice(0, RECENT_LIMIT).map((movement) => ({
        amount: movement.amount,
        category: movement.category,
        note: movement.note,
        date: movement.occurredAt.toISOString().slice(0, 10),
        type: movement.type,
      })),
    };
  }

  private async balance(ownerId: string): Promise<QueryExecutionResult> {
    const summary = await this.movementService.getSummary(ownerId);
    return {
      query_type: "balance",
      balance: summary.kpis.balance,
      income: summary.kpis.income,
      expenses: summary.kpis.expenses,
    };
  }

  private async month(ownerId: string): Promise<QueryExecutionResult> {
    const summary = await this.movementService.getSummary(ownerId);
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
}