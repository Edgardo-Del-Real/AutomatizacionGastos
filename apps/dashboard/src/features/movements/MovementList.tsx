import { useState } from "react";

import type { MovementType } from "@rita/contracts";

import { OWNER_ID } from "../../infra/env";
import { formatARS } from "../../infra/currency";
import type { MovementListFilters } from "../../infra/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { MovementEditForm } from "./MovementEditForm";
import { MovementFilters } from "./MovementFilters";
import { useMovementMutations } from "./useMovementMutations";
import { useMovements } from "./useMovements";

const TYPE_LABELS: Record<MovementType, string> = {
  INCOME: "Ingreso",
  EXPENSE: "Gasto",
};

const ACTION_CLASS =
  "rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function sortByOccurredAtDesc(a: Date, b: Date): number {
  return b.getTime() - a.getTime();
}

type MovementListProps = {
  refreshToken?: number;
  onMutated?: () => void;
};

export function MovementList({ refreshToken, onMutated }: MovementListProps) {
  const [filters, setFilters] = useState<MovementListFilters>({});
  const state = useMovements(OWNER_ID, filters, refreshToken);
  const { removeMovement, deleteError, busy } = useMovementMutations(onMutated);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
    const confirmingMovement = confirmingId
      ? (state.data.find((movement) => movement.id === confirmingId) ?? null)
      : null;

    async function handleConfirmDelete() {
      if (!confirmingId) return;
      const ok = await removeMovement(confirmingId);
      if (ok) setConfirmingId(null);
    }

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
                <th className="px-4 py-3 font-medium sm:px-6">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((movement) =>
                movement.id === editingId ? (
                  <tr key={movement.id} className="bg-canvas">
                    <td colSpan={7} className="px-4 py-4 sm:px-6">
                      <MovementEditForm
                        movement={movement}
                        refreshToken={refreshToken}
                        onSaved={() => {
                          setEditingId(null);
                          onMutated?.();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
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
                    <td className="px-4 py-3 whitespace-nowrap sm:px-6">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(movement.id)}
                          className={ACTION_CLASS}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(movement.id)}
                          className={ACTION_CLASS}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        {confirmingMovement ? (
          <ConfirmDialog
            title="Eliminar movimiento"
            message={`¿Eliminar el movimiento de ${formatARS(confirmingMovement.amount)}?`}
            confirmLabel="Eliminar"
            cancelLabel="Cancelar"
            onConfirm={handleConfirmDelete}
            onCancel={() => setConfirmingId(null)}
            busy={busy === "delete"}
            error={
              deleteError ? "No se pudo eliminar el movimiento." : undefined
            }
          />
        ) : null}
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