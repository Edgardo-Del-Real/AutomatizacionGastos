import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";
import { OWNER_ID } from "../../infra/env";
import { useCategories } from "./useCategories";

type Categories = MovementSummary["categories"];

type CategoryCardsProps = {
  categories: Categories;
  refreshToken?: number;
};

const STATUS_CARD_CLASS =
  "rounded-card border border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card";

export function CategoryCards({ categories, refreshToken }: CategoryCardsProps) {
  const state = useCategories(OWNER_ID, refreshToken);

  if (state.status === "error") {
    return (
      <section
        aria-label="Error de categorías"
        className="rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <p role="alert" className="text-sm font-medium text-danger">
          No se pudieron cargar las categorías: {state.error.message}
        </p>
        <button
          type="button"
          onClick={state.retry}
          className="mt-4 inline-flex items-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (state.status === "success") {
    const spentByCategory = new Map(
      categories.map((category) => [category.name, category.expenseAmount]),
    );

    return (
      <section aria-label="Gastos por categoría" className="space-y-4">
        <h2 className="text-base font-semibold text-ink">
          Gastos por categoría
        </h2>
        <ul
          aria-label="Categorías"
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {state.data.map((category) => {
            const spent = spentByCategory.get(category.name) ?? 0;
            return (
              <li
                key={category.name}
                className="rounded-card border border-border bg-surface p-4 shadow-card"
              >
                <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                  {category.name}
                </h3>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-expense">
                  {formatARS(spent)}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  // idle or loading: the request is pending
  return (
    <p role="status" className={STATUS_CARD_CLASS}>
      Cargando categorías…
    </p>
  );
}