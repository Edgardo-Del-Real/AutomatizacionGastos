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
        <ul aria-label="Categorías" className="mt-4 space-y-2">
          {categories.map((category) => (
            <li
              key={category.name}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="font-medium text-ink">{category.name}</span>
              <span className="text-ink-soft tabular-nums">
                <span>Gastos {Math.round(category.expensePercent)}%</span>
                <span className="ml-2">
                  Ingresos {Math.round(category.incomePercent)}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
