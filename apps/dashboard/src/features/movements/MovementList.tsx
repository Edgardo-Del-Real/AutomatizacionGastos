import { useState } from "react";

import type { MovementType } from "@rita/contracts";

import { OWNER_ID } from "../../infra/env";
import { formatARS } from "../../infra/currency";
import type { MovementListFilters } from "../../infra/api";
import { MovementFilters } from "./MovementFilters";
import { useMovements } from "./useMovements";

const TYPE_LABELS: Record<MovementType, string> = {
  INCOME: "Ingreso",
  EXPENSE: "Gasto",
};

function sortByOccurredAtDesc(a: Date, b: Date): number {
  return b.getTime() - a.getTime();
}

export function MovementList() {
  const [filters, setFilters] = useState<MovementListFilters>({});
  const state = useMovements(OWNER_ID, filters);

  if (state.status === "error") {
    return (
      <section
        aria-label="Error de movimientos"
        className="rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <p role="alert" className="text-sm font-medium text-danger">
          No se pudieron cargar los movimientos: {state.error.message}
        </p>
        <button
          type="button"
          onClick={state.retry}
          className="mt-4 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (state.status === "success") {
    if (state.data.length === 0) {
      return (
        <section
          aria-label="Movimientos"
          className="rounded-card border border-dashed border-border bg-surface p-10 text-center shadow-card"
        >
          <h2 className="text-base font-semibold text-ink">Movimientos</h2>
          <p className="mt-2 text-sm text-ink-soft">No hay movimientos.</p>
        </section>
      );
    }

    const visible = [...state.data].sort((a, b) =>
      sortByOccurredAtDesc(a.occurredAt, b.occurredAt),
    );

    return (
      <section
        aria-label="Movimientos"
        className="overflow-hidden rounded-card border border-border bg-surface shadow-card"
      >
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-ink">Movimientos</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {state.data.length}{" "}
            {state.data.length === 1 ? "movimiento" : "movimientos"} registrados
          </p>
        </div>
        <MovementFilters value={filters} onChange={setFilters} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs tracking-wide text-ink-faint uppercase">
                <th className="px-4 py-3 font-medium sm:px-6">Fecha</th>
                <th className="px-4 py-3 font-medium sm:px-6">Tipo</th>
                <th className="px-4 py-3 text-right font-medium sm:px-6">
                  Monto
                </th>
                <th className="px-4 py-3 font-medium sm:px-6">Moneda</th>
                <th className="px-4 py-3 font-medium sm:px-6">Categoría</th>
                <th className="px-4 py-3 font-medium sm:px-6">Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((movement) => (
                <tr
                  key={movement.id}
                  className="transition-colors hover:bg-canvas"
                >
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums sm:px-6">
                    {movement.occurredAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap sm:px-6">
                    <span
                      className={
                        movement.type === "INCOME"
                          ? "inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong"
                          : "inline-flex items-center rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink-soft"
                      }
                    >
                      {TYPE_LABELS[movement.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums sm:px-6">
                    {formatARS(movement.amount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-soft sm:px-6">
                    {movement.currency}
                  </td>
                  <td className="px-4 py-3 sm:px-6">
                    <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
                      {movement.category ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-soft sm:px-6">
                    {movement.note ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  // idle or loading: the request is pending
  return (
    <section
      aria-label="Movimientos"
      className="rounded-card border border-border bg-surface p-10 text-center shadow-card"
    >
      <p role="status" className="text-sm text-ink-soft">
        Cargando movimientos…
      </p>
    </section>
  );
}
