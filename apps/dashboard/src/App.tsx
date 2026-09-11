import { useCallback, useState } from "react";

import { OWNER_ID } from "./infra/env";
import { CategoryBreakdown } from "./features/movements/CategoryBreakdown";
import { CategoryCards } from "./features/movements/CategoryCards";
import { DailyChart } from "./features/movements/DailyChart";
import { KpiCards } from "./features/movements/KpiCards";
import { MomChart } from "./features/movements/MomChart";
import { MovementList } from "./features/movements/MovementList";
import { SummarySection } from "./features/movements/SummarySection";
import { TopMovements } from "./features/movements/TopMovements";
import { useMovementSummary } from "./features/movements/useMovementSummary";

type DashboardSection = "kpis" | "charts" | "categories" | "movements";

const SECTIONS: ReadonlyArray<{ id: DashboardSection; label: string }> = [
  { id: "kpis", label: "KPIs" },
  { id: "charts", label: "Gráficos" },
  { id: "categories", label: "Categorías" },
  { id: "movements", label: "Movimientos" },
];

const NAV_BUTTON_CLASS =
  "rounded-full border border-transparent px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
const NAV_ACTIVE_CLASS = "border-accent/30 bg-accent/10 text-accent";
const NAV_IDLE_CLASS = "text-ink-soft hover:bg-white/5 hover:text-ink";

export default function App() {
  // Single App-level refresh token (D11): bumping it re-fetches both the
  // movement list and the summary in place after any successful mutation.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const [activeSection, setActiveSection] =
    useState<DashboardSection>("kpis");
  const summaryState = useMovementSummary(OWNER_ID, refreshKey);

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
          <SummarySection state={summaryState}>
            {(data) => (
              <div className="space-y-6">
                <KpiCards kpis={data.kpis} />
                <CategoryCards
                  categories={data.categories}
                  refreshToken={refreshKey}
                />
              </div>
            )}
          </SummarySection>
        )}
        {activeSection === "charts" && (
          <SummarySection state={summaryState}>
            {(data) => (
              <div className="space-y-6">
                <MomChart months={data.mom.months} />
                <DailyChart daily={data.daily} />
              </div>
            )}
          </SummarySection>
        )}
        {activeSection === "categories" && (
          <SummarySection state={summaryState}>
            {(data) => (
              <div className="space-y-6">
                <CategoryBreakdown categories={data.categories} />
                <TopMovements top={data.top} />
              </div>
            )}
          </SummarySection>
        )}
        {activeSection === "movements" && (
          <MovementList refreshToken={refreshKey} onMutated={bumpRefresh} />
        )}
      </div>
    </main>
  );
}