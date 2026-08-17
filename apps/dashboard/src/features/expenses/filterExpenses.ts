import type { Expense } from "@rita/contracts";

/** Client-side expense filters. `month` uses the `YYYY-MM` format derived from `occurredAt`. */
export type Filters = { month?: string; category?: string };

function monthOf(occurredAt: Date): string {
  return occurredAt.toISOString().slice(0, 7);
}

/**
 * Pure filter over the already-loaded list. Both filters apply together (AND)
 * when both are set; an empty object (or empty-string values) returns the full list.
 */
export function filterExpenses(list: Expense[], filters: Filters): Expense[] {
  const { month, category } = filters;
  return list.filter((expense) => {
    if (month && monthOf(expense.occurredAt) !== month) return false;
    if (category && expense.category !== category) return false;
    return true;
  });
}