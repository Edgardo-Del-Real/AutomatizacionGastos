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
    <div>
      <label htmlFor="month-filter">Month</label>
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
      >
        <option value="">All months</option>
        {months.map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </select>

      <label htmlFor="category-filter">Category</label>
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
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
    </div>
  );
}