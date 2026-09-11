import { useCallback, useState } from "react";

import { DashboardOverview } from "./features/movements/DashboardOverview";
import { MovementList } from "./features/movements/MovementList";

export default function App() {
  // Single App-level refresh token (D11): bumping it re-fetches both the
  // movement list and the summary in place after any successful mutation.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return (
    <main className="min-h-screen bg-canvas text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-border bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 lg:px-8">
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
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-8">
          <DashboardOverview refreshToken={refreshKey} />
          <MovementList refreshToken={refreshKey} onMutated={bumpRefresh} />
        </div>
      </div>
    </main>
  );
}