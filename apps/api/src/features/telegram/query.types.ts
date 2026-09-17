export const QUERY_TYPES = ["categories", "recent", "balance", "month"] as const;

export type QueryType = (typeof QUERY_TYPES)[number];

export type CategoriesQueryResult = {
  query_type: "categories";
  categories: { name: string; keywords: string[] }[];
};

export type RecentMovementResult = {
  amount: number;
  category: string | null;
  note: string | null;
  date: string;
  type: "EXPENSE" | "INCOME";
};

export type RecentQueryResult = {
  query_type: "recent";
  movements: RecentMovementResult[];
};

export type BalanceQueryResult = {
  query_type: "balance";
  balance: number;
  income: number;
  expenses: number;
};

export type MonthQueryResult = {
  query_type: "month";
  month: string;
  monthIncome: number;
  monthExpenses: number;
  monthCount: number;
};

export type QueryExecutionResult =
  | CategoriesQueryResult
  | RecentQueryResult
  | BalanceQueryResult
  | MonthQueryResult;

/**
 * Resolves the concrete query type from the interpreted intent. The `query`
 * intent carries its type in `query_type`; the legacy `query_*` intents map
 * directly. Anything else is not a query and resolves to null.
 */
export function deriveQueryType(intent: string, queryType: QueryType | null): QueryType | null {
  switch (intent) {
    case "query":
      return queryType;
    case "query_recent":
      return "recent";
    case "query_balance":
      return "balance";
    case "query_month":
      return "month";
    default:
      return null;
  }
}