import { useState } from "react";

import { OWNER_ID } from "../../infra/env";
import { ExpenseFilters } from "./ExpenseFilters";
import { filterExpenses } from "./filterExpenses";
import type { Filters } from "./filterExpenses";
import { useExpenses } from "./useExpenses";

function sortByOccurredAtDesc(a: Date, b: Date): number {
  return b.getTime() - a.getTime();
}

export function ExpenseList() {
  const state = useExpenses(OWNER_ID);
  const [filters, setFilters] = useState<Filters>({});

  if (state.status === "error") {
    return (
      <section aria-label="Expense list error">
        <p role="alert">Couldn't load expenses: {state.error.message}</p>
        <button type="button" onClick={state.retry}>
          Retry
        </button>
      </section>
    );
  }

  if (state.status === "success") {
    if (state.data.length === 0) {
      return <p>No expenses found.</p>;
    }

    const visible = filterExpenses(state.data, filters).sort((a, b) =>
      sortByOccurredAtDesc(a.occurredAt, b.occurredAt),
    );

    return (
      <section aria-label="Expense list">
        <ExpenseFilters
          expenses={state.data}
          value={filters}
          onChange={setFilters}
        />
        {visible.length === 0 ? (
          <p>No expenses match the selected filters.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Category</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((expense) => (
                <tr key={expense.id}>
                  <td>{expense.occurredAt.toISOString().slice(0, 10)}</td>
                  <td>{expense.amount}</td>
                  <td>{expense.currency}</td>
                  <td>{expense.category ?? "—"}</td>
                  <td>{expense.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  // idle or loading: the request is pending
  return <p role="status">Loading expenses…</p>;
}