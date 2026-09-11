import type { MovementSummary } from "@rita/contracts";

type Categories = MovementSummary["categories"];

export function CategoryBreakdown({ categories }: { categories: Categories }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-base font-semibold text-ink">
        Desglose por categoría
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Distribución de gastos e ingresos por categoría
      </p>
      {categories.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">Sin categorías.</p>
      ) : (
        <ul aria-label="Categorías" className="mt-4 space-y-3">
          {categories.map((category) => {
            const expensePct = Math.round(category.expensePercent);
            const incomePct = Math.round(category.incomePercent);
            const barPct = Math.max(expensePct, incomePct);
            const barClass = expensePct > 0 ? "bg-accent" : "bg-income";
            return (
              <li key={category.name} className="text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-ink">{category.name}</span>
                  <span className="text-ink-soft tabular-nums">
                    <span>Gastos {expensePct}%</span>
                    <span className="ml-2">
                      Ingresos {incomePct}%
                    </span>
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5"
                >
                  <div
                    className={`h-full rounded-full ${barClass} transition-[width] duration-300`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}