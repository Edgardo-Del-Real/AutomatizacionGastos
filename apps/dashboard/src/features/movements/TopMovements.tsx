import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";

type Top = MovementSummary["top"];

function MovementLines({ movements }: { movements: Top["expenses"] }) {
  if (movements.length === 0) {
    return <p className="text-sm text-ink-soft">Sin movimientos.</p>;
  }
  return (
    <ul className="space-y-1">
      {movements.map((movement) => (
        <li
          key={movement.id}
          className="flex items-center justify-between gap-4 text-sm"
        >
          <span className="truncate text-ink-soft">
            {movement.note ?? movement.category ?? "—"}
          </span>
          <span className="font-semibold text-ink tabular-nums">
            {formatARS(movement.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TopMovements({ top }: { top: Top }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-base font-semibold text-ink">
        Principales movimientos
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Mayores gastos e ingresos del período
      </p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <section aria-label="Top gastos">
          <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            Top gastos
          </h3>
          <div className="mt-2">
            <MovementLines movements={top.expenses} />
          </div>
        </section>
        <section aria-label="Top ingresos">
          <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            Top ingresos
          </h3>
          <div className="mt-2">
            <MovementLines movements={top.income} />
          </div>
        </section>
      </div>
    </div>
  );
}
