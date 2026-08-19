import { ExpenseList } from "./features/expenses/ExpenseList";
import { MetricsOverview } from "./features/metrics/MetricsOverview";

export default function App() {
  return (
    <main className="min-h-screen bg-canvas text-ink antialiased">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Rita Dashboard
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Monthly expense overview
          </p>
        </header>
        <div className="space-y-8">
          <MetricsOverview />
          <ExpenseList />
        </div>
      </div>
    </main>
  );
}