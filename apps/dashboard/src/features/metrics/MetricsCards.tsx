import type { ExpenseMonth } from "@rita/contracts";

export function sortMonthsAscending(months: ExpenseMonth[]): ExpenseMonth[] {
  return [...months].sort((a, b) => a.month.localeCompare(b.month));
}

export function MetricsCards({ months }: { months: ExpenseMonth[] }) {
  const sorted = sortMonthsAscending(months);
  return (
    <ul
      aria-label="Monthly metrics"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
    >
      {sorted.map((month) => (
        <li
          key={month.month}
          className="rounded-card border border-border bg-surface p-4 shadow-card"
        >
          <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            {month.month}
          </h3>
          <p className="mt-2 text-2xl font-bold text-ink tabular-nums">
            Total: {month.totalAmount}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {month.count} {month.count === 1 ? "expense" : "expenses"}
          </p>
        </li>
      ))}
    </ul>
  );
}