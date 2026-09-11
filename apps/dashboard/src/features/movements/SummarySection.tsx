import type { ReactNode } from "react";

import type { MovementSummary } from "@rita/contracts";

import type { MovementSummaryState } from "./useMovementSummary";

const STATE_CARD_CLASS =
  "rounded-card border border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card";

type SummarySectionProps = {
  state: MovementSummaryState;
  children: (data: MovementSummary) => ReactNode;
};

/**
 * Shared gate for the summary-backed sections (KPIs, charts, categories).
 * It owns the loading / error+retry / empty states once, so each section
 * only describes what to render with a successful summary.
 */
export function SummarySection({ state, children }: SummarySectionProps) {
  if (state.status === "error") {
    return (
      <section
        aria-label="Error del resumen"
        className="rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <p role="alert" className="text-sm font-medium text-danger">
          No se pudieron cargar los indicadores: {state.error.message}
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
    const isEmpty =
      state.data.mom.months.length === 0 && state.data.daily.length === 0;

    if (isEmpty) {
      return (
        <p
          className="rounded-card border border-dashed border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card"
        >
          No hay movimientos aún.
        </p>
      );
    }

    return children(state.data);
  }

  // idle or loading: the request is pending
  return (
    <p role="status" className={STATE_CARD_CLASS}>
      Cargando indicadores…
    </p>
  );
}