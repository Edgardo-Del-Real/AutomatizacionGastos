import type { Expense } from "@rita/contracts";

import type { Filters } from "./filterExpenses";

export type ExpenseFiltersProps = {
  expenses: Expense[];
  value: Filters;
  onChange: (filters: Filters) => void;
};

function monthOf(occurredAt: Date): string {
  return occurredAt.toISOString().slice(0, 7);
}

function distinctMonths(expenses: Expense[]): string[] {
  const months = new Set(expenses.map((e) => monthOf(e.occurredAt)));
  return Array.from(months).sort().reverse();
}

function distinctCategories(expenses: Expense[]): string[] {
  const categories = new Set(
    expenses.map((e) => e.category).filter((c): c is string => c !== null),
  );
  return Array.from(categories).sort();
}

export function ExpenseFilters({
  expenses,
  value,
  onChange,
}: ExpenseFiltersProps) {
  const months = distinctMonths(expenses);
  const categories = distinctCategories(expenses);

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="month-filter"
          className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
        >
          Month
        </label>
        <select
          id="month-filter"
          aria-label="Filter by month"
          value={value.month ?? ""}
          onChange={(event) =>
            onChange({
              ...value,
              month: event.target.value || undefined,
            })
          }
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        >
          <option value="">All months</option>
          {months.map((month) => (
            <option key={month} value={month}>
              {month}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="category-filter"
          className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
        >
          Category
        </label>
        <select
          id="category-filter"
          aria-label="Filter by category"
          value={value.category ?? ""}
          onChange={(event) =>
            onChange({
              ...value,
              category: event.target.value || undefined,
            })
          }
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}