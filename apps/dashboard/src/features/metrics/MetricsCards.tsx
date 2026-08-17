import type { ExpenseMonth } from "@rita/contracts";

export function sortMonthsAscending(months: ExpenseMonth[]): ExpenseMonth[] {
  return [...months].sort((a, b) => a.month.localeCompare(b.month));
}

export function MetricsCards({ months }: { months: ExpenseMonth[] }) {
  const sorted = sortMonthsAscending(months);
  return (
    <ul aria-label="Monthly metrics">
      {sorted.map((month) => (
        <li key={month.month}>
          <h3>{month.month}</h3>
          <p>
            {month.count} {month.count === 1 ? "expense" : "expenses"}
          </p>
          <p>Total: {month.totalAmount}</p>
        </li>
      ))}
    </ul>
  );
}