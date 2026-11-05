import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";
import { useViewer } from "../household/ViewerContext";
import { useCategories } from "./useCategories";

type Categories = MovementSummary["categories"];

type CategoryCardsProps = {
  categories: Categories;
  refreshToken?: number;
};

const STATUS_CARD_CLASS =
  "rounded-card border border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card";

/** Case- and accent-insensitive: "carnicería" and "Carniceria" are one bucket. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function CategoryCards({ categories, refreshToken }: CategoryCardsProps) {
  const { viewerId } = useViewer();
  const state = useCategories(viewerId, refreshToken);
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
    // A shared expense carries the REGISTRANT's category name, so the partner's
    // row can say "carnicería" while this owner's list says "Carniceria". An
    // exact match silently dropped the money from the cards.
    const summaryByName = new Map(
      categories.map((category) => [normalizeName(category.name), category]),
    );

    const ownerCategories = state.data.filter(
      (category) => category.type !== "SAVINGS",
    );
    const cards = ownerCategories.map((category) => {
      const summary = summaryByName.get(normalizeName(category.name));
      const isIncome = category.type === "INCOME";
      return {
        key: category.name,
        name: category.name,
        isIncome,
        amount: isIncome
          ? (summary?.incomeAmount ?? 0)
          : (summary?.expenseAmount ?? 0),
      };
    });

    // Any summary category this owner does not have (a partner's category) must
    // still show its money instead of vanishing from the dashboard.
    const known = new Set(ownerCategories.map((category) => normalizeName(category.name)));
    for (const summary of categories) {
      if (known.has(normalizeName(summary.name))) continue;
      const isIncome = summary.incomeAmount > 0 && summary.expenseAmount === 0;
      cards.push({
        key: summary.name,
        name: summary.name.trim() === "" ? "Sin categoría" : summary.name,
        isIncome,
        amount: isIncome ? summary.incomeAmount : summary.expenseAmount,
      });
    }

    return (
      <section aria-label="Movimientos por categoría" className="space-y-4">
        <h2 className="text-base font-semibold text-ink">
          Movimientos por categoría
        </h2>
        <ul
          aria-label="Categorías"
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {cards.map((card) => (
            <li
              key={card.key}
              className="rounded-card border border-border bg-surface p-4 shadow-card"
            >
              <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                {card.name}
              </h3>
              <p
                className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
                  card.isIncome ? "text-income" : "text-expense"
                }`}
              >
                {formatARS(card.amount)}
              </p>
            </li>
          ))}
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