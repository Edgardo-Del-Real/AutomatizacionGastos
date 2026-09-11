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
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Rita Dashboard
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Resumen de ingresos y gastos
          </p>
        </header>
        <div className="space-y-8">
          <DashboardOverview refreshToken={refreshKey} />
          <MovementList refreshToken={refreshKey} onMutated={bumpRefresh} />
        </div>
      </div>
    </main>
  );
}