import { DashboardOverview } from "./features/movements/DashboardOverview";
import { MovementList } from "./features/movements/MovementList";

export default function App() {
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
          <DashboardOverview />
          <MovementList />
        </div>
      </div>
    </main>
  );
}
