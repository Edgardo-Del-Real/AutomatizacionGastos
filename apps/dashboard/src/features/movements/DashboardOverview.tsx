import { OWNER_ID } from "../../infra/env";
import { CategoryBreakdown } from "./CategoryBreakdown";
import { DailyChart } from "./DailyChart";
import { KpiCards } from "./KpiCards";
import { MomChart } from "./MomChart";
import { TopMovements } from "./TopMovements";
import { useMovementSummary } from "./useMovementSummary";

export function DashboardOverview() {
  const state = useMovementSummary(OWNER_ID);

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
          className="mt-4 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (state.status === "success") {
    const { kpis, mom, daily, categories, top } = state.data;
    const isEmpty = mom.months.length === 0 && daily.length === 0;

    if (isEmpty) {
      return (
        <p className="rounded-card border border-dashed border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card">
          No hay movimientos aún.
        </p>
      );
    }

    return (
      <section aria-label="Resumen del dashboard" className="space-y-6">
        <KpiCards kpis={kpis} />
        <MomChart months={mom.months} />
        <DailyChart daily={daily} />
        <CategoryBreakdown categories={categories} />
        <TopMovements top={top} />
      </section>
    );
  }

  // idle or loading: the request is pending
  return (
    <p
      role="status"
      className="rounded-card border border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card"
    >
      Cargando indicadores…
    </p>
  );
}
