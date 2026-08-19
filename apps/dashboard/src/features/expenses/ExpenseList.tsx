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
      <section
        aria-label="Expense list error"
        className="rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <p role="alert" className="text-sm font-medium text-danger">
          Couldn't load expenses: {state.error.message}
        </p>
        <button
          type="button"
          onClick={state.retry}
          className="mt-4 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Retry
        </button>
      </section>
    );
  }

  if (state.status === "success") {
    if (state.data.length === 0) {
      return (
        <section
          aria-label="Expense list"
          className="rounded-card border border-dashed border-border bg-surface p-10 text-center shadow-card"
        >
          <p className="text-sm text-ink-soft">No expenses found.</p>
        </section>
      );
    }

    const visible = filterExpenses(state.data, filters).sort((a, b) =>
      sortByOccurredAtDesc(a.occurredAt, b.occurredAt),
    );

    return (
      <section
        aria-label="Expense list"
        className="overflow-hidden rounded-card border border-border bg-surface shadow-card"
      >
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-ink">Expenses</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {state.data.length} expense{state.data.length === 1 ? "" : "s"} recorded
          </p>
        </div>
        <ExpenseFilters
          expenses={state.data}
          value={filters}
          onChange={setFilters}
        />
        {visible.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink-soft">
            No expenses match the selected filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs tracking-wide text-ink-faint uppercase">
                  <th className="px-4 py-3 font-medium sm:px-6">Date</th>
                  <th className="px-4 py-3 text-right font-medium sm:px-6">
                    Amount
                  </th>
                  <th className="px-4 py-3 font-medium sm:px-6">Currency</th>
                  <th className="px-4 py-3 font-medium sm:px-6">Category</th>
                  <th className="px-4 py-3 font-medium sm:px-6">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((expense) => (
                  <tr
                    key={expense.id}
                    className="transition-colors hover:bg-canvas"
                  >
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums sm:px-6">
                      {expense.occurredAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums sm:px-6">
                      {expense.amount}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-soft sm:px-6">
                      {expense.currency}
                    </td>
                    <td className="px-4 py-3 sm:px-6">
                      <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
                        {expense.category ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft sm:px-6">
                      {expense.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  // idle or loading: the request is pending
  return (
    <section
      aria-label="Expense list"
      className="rounded-card border border-border bg-surface p-10 text-center shadow-card"
    >
      <p role="status" className="text-sm text-ink-soft">
        Loading expenses…
      </p>
    </section>
  );
}