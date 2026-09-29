import { useCallback, useState } from "react";

import type { VisibilityFilter } from "@rita/contracts";

import { ViewerProvider, useViewer } from "./features/household/ViewerContext";
import { ViewerSelector } from "./features/household/ViewerSelector";
import { BalanceTrendChart } from "./features/movements/BalanceTrendChart";
import { CategoryCards } from "./features/movements/CategoryCards";
import { CategoryPieChart } from "./features/movements/CategoryPieChart";
import { KpiCards } from "./features/movements/KpiCards";
import { MovementList } from "./features/movements/MovementList";
import { PlannedSection } from "./features/movements/PlannedSection";
import { SummarySection } from "./features/movements/SummarySection";
import { useMovementSummary } from "./features/movements/useMovementSummary";

type DashboardSection = "kpis" | "charts" | "movements";

const SECTIONS: ReadonlyArray<{ id: DashboardSection; label: string }> = [
  { id: "kpis", label: "KPIs" },
  { id: "charts", label: "Gráficos" },
  { id: "movements", label: "Movimientos" },
];

const NAV_BUTTON_CLASS =
  "rounded-full border border-transparent px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
const NAV_ACTIVE_CLASS = "border-accent/30 bg-accent/10 text-accent";
const NAV_IDLE_CLASS = "text-ink-soft hover:bg-white/5 hover:text-ink";

function Dashboard() {
  const { viewerId } = useViewer();
  // Single App-level refresh token (D11): bumping it re-fetches both the
  // movement list and the summary in place after any successful mutation.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  // Hoisted visibility filter (AD8): one state drives BOTH the summary and the
  // list requests so the charts and the table always agree.
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");

  const [activeSection, setActiveSection] =
    useState<DashboardSection>("kpis");
  const summaryState = useMovementSummary(viewerId, visibility, refreshKey);

  const changeSection = useCallback((next: DashboardSection) => {
    setActiveSection(next);
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <main className="min-h-screen bg-canvas text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-border bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong shadow-card"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-5 w-5 text-on-accent"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-ink sm:text-xl">
                  Rita Dashboard
                </h1>
                <p className="text-xs text-ink-soft sm:text-sm">
                  Resumen de ingresos y gastos
                </p>
              </div>
            </div>
            <ViewerSelector />
            <nav
              aria-label="Secciones del dashboard"
              className="flex flex-wrap items-center gap-1.5"
            >
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-current={
                    activeSection === section.id ? "page" : undefined
                  }
                  onClick={() => changeSection(section.id)}
                  className={`${NAV_BUTTON_CLASS} ${
                    activeSection === section.id
                      ? NAV_ACTIVE_CLASS
                      : NAV_IDLE_CLASS
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {activeSection === "kpis" && (
          <div className="space-y-6">
            <SummarySection state={summaryState}>
              {(data) => (
                <>
                  <KpiCards kpis={data.kpis} />
                  {/* D9: the planned expenses section sits immediately after
                      the KPI cards. Its form and total share one refresh token.
                      The SummarySection emptiness predicate accounts for
                      planned.total, so a PENDING-only owner (empty mom/daily
                      but planned.total > 0) never collapses to the empty state
                      and the planned total + form stay visible. */}
                  <PlannedSection
                    planned={data.planned}
                    refreshToken={refreshKey}
                    onMutated={bumpRefresh}
                  />
                  <CategoryCards
                    categories={data.categories}
                    refreshToken={refreshKey}
                  />
                </>
              )}
            </SummarySection>
          </div>
        )}
        {activeSection === "charts" && (
          <SummarySection state={summaryState}>
            {(data) => (
              <div className="space-y-6">
                <CategoryPieChart kpis={data.kpis} categories={data.categories} />
                <BalanceTrendChart daily={data.daily} />
              </div>
            )}
          </SummarySection>
        )}
        {activeSection === "movements" && (
          <MovementList
            refreshToken={refreshKey}
            onMutated={bumpRefresh}
            visibility={visibility}
            onVisibilityChange={setVisibility}
          />
        )}
      </div>
    </main>
  );
}

export default function App() {
  return (
    <ViewerProvider>
      <Dashboard />
    </ViewerProvider>
  );
}