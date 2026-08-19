import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";

type Kpis = MovementSummary["kpis"];

export function KpiCards({ kpis }: { kpis: Kpis }) {
  const cards: Array<{ label: string; value: string }> = [
    { label: "Ingresos", value: formatARS(kpis.income) },
    { label: "Gastos", value: formatARS(kpis.expenses) },
    { label: "Balance", value: formatARS(kpis.balance) },
    { label: "Promedio mes", value: formatARS(kpis.avgPerMonth) },
    { label: "Promedio por movimiento", value: formatARS(kpis.avgPerMovement) },
    { label: "Máximo", value: formatARS(kpis.maxAmount) },
    { label: "Cantidad", value: String(kpis.count) },
  ];

  return (
    <ul
      aria-label="Indicadores"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
    >
      {cards.map((card) => (
        <li
          key={card.label}
          className="rounded-card border border-border bg-surface p-4 shadow-card"
        >
          <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            {card.label}
          </h3>
          <p className="mt-2 text-2xl font-bold text-ink tabular-nums">
            {card.value}
          </p>
        </li>
      ))}
    </ul>
  );
}
