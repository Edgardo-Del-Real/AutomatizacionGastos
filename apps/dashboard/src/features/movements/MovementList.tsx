import { useState } from "react";

import type { Movement, MovementType, VisibilityFilter } from "@rita/contracts";

import { formatARS } from "../../infra/currency";
import type { MovementListFilters } from "../../infra/api";
import { useViewer } from "../household/ViewerContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { MovementEditForm } from "./MovementEditForm";
import { MovementFilters } from "./MovementFilters";
import { useMovementMutations } from "./useMovementMutations";
import { useMovements } from "./useMovements";

const TYPE_LABELS: Record<MovementType, string> = {
  INCOME: "Ingreso",
  EXPENSE: "Gasto",
  SAVINGS: "Ahorro",
};

const TYPE_BADGE_CLASS: Record<MovementType, string> = {
  INCOME: "inline-flex items-center rounded-full bg-income-soft px-2 py-0.5 text-xs font-medium text-income",
  EXPENSE: "inline-flex items-center rounded-full bg-expense-soft px-2 py-0.5 text-xs font-medium text-expense",
  SAVINGS: "inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent",
};

const ACTION_CLASS =
  "rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

const BADGE_CLASS =
  "inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent";

/** "Previsto" badge: a PENDING expense that does not count in the KPIs yet. */
const PENDING_BADGE_CLASS =
  "inline-flex items-center rounded-full bg-expense-soft px-2 py-0.5 text-xs font-medium text-expense";

function currencyIcon(currency: string): { icon: string; label: string } {
  if (currency === "ARS") return { icon: "🇦🇷", label: "Pesos argentinos (ARS)" };
  if (currency === "USD") return { icon: "🇺🇸", label: "Dólares estadounidenses (USD)" };
  return { icon: "💱", label: currency };
}

function sortByOccurredAtDesc(a: Date, b: Date): number {
  return b.getTime() - a.getTime();
}

function formatMovementDate(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** The registrant is the author of the row: `registrantId` (derived alias of ownerId). */
function registrantOf(movement: Movement): string {
  return movement.registrantId ?? movement.ownerId;
}

type MovementListProps = {
  refreshToken?: number;
  onMutated?: () => void;
  /** Hoisted visibility filter (drives list AND summary); default all. */
  visibility?: VisibilityFilter;
  /** Reports visibility changes up so the App can re-query the summary too. */
  onVisibilityChange?: (visibility: VisibilityFilter) => void;
};

export function MovementList({
  refreshToken,
  onMutated,
  visibility,
  onVisibilityChange,
}: MovementListProps) {
  const { viewerId, members } = useViewer();
  const [filters, setFilters] = useState<MovementListFilters>({});
  // Uncontrolled fallback: when the App does not hoist the filter (standalone
  // usage) the list manages its own visibility, defaulting to all.
  const [internalVisibility, setInternalVisibility] =
    useState<VisibilityFilter>("all");
  const effectiveVisibility = visibility ?? internalVisibility;
  const state = useMovements(
    viewerId,
    filters,
    effectiveVisibility,
    refreshToken,
  );
  const { removeMovement, markPaid, deleteError, markPaidError, busy } =
    useMovementMutations(onMutated);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);

  const memberNames = new Map(
    members.map((member) => [member.ownerId, member.name]),
  );

  function registrantName(movement: Movement): string {
    return memberNames.get(registrantOf(movement)) ?? registrantOf(movement);
  }

  function handleFiltersChange(next: MovementListFilters) {
    const { visibility: nextVisibility, ...rest } = next;
    setFilters(rest);
    const resolved = nextVisibility ?? "all";
    if (onVisibilityChange) {
      onVisibilityChange(resolved);
    } else {
      setInternalVisibility(resolved);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmingId) return;
    const ok = await removeMovement(confirmingId);
    if (ok) setConfirmingId(null);
  }

  function renderActions(movement: Movement) {
    if (registrantOf(movement) !== viewerId) return null;
    const isOpen = openActionsId === movement.id;
    const closeActions = () => setOpenActionsId(null);
    return (
      <div className="relative flex justify-center">
        <button
          type="button"
          aria-label="Abrir acciones del movimiento"
          aria-expanded={isOpen}
          title="Acciones"
          onClick={() => setOpenActionsId(isOpen ? null : movement.id)}
          className={`${ACTION_CLASS} min-w-9 text-base leading-none`}
        >
          ⋯
        </button>
        {isOpen ? (
          <>
            <button
              type="button"
              aria-label="Cerrar acciones"
              onClick={closeActions}
              className="fixed inset-0 z-10 cursor-default bg-transparent"
            />
            <div
              role="menu"
              aria-label="Acciones del movimiento"
              className="absolute right-0 top-full z-20 mt-2 flex min-w-44 flex-col gap-1 rounded-control border border-border bg-surface p-1.5 shadow-card"
            >
              {movement.status === "PENDING" ? (
                <button
                  type="button"
                  onClick={() => {
                    closeActions();
                    void markPaid(movement.id);
                  }}
                  disabled={busy === "markPaid"}
                  className="flex items-center gap-2 rounded-control px-3 py-2 text-left text-sm text-ink hover:bg-surface-raised"
                >
                  <span aria-hidden="true">✅</span> Marcar pagado
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  closeActions();
                  setEditingId(movement.id);
                }}
                className="flex items-center gap-2 rounded-control px-3 py-2 text-left text-sm text-ink hover:bg-surface-raised"
              >
                <span aria-hidden="true">✏️</span> Editar
              </button>
              <button
                type="button"
                onClick={() => {
                  closeActions();
                  setConfirmingId(movement.id);
                }}
                className="flex items-center gap-2 rounded-control px-3 py-2 text-left text-sm text-ink hover:bg-surface-raised"
              >
                <span aria-hidden="true">🗑️</span> Eliminar
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

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
          className="mt-4 inline-flex items-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
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
          className="overflow-hidden rounded-card border border-border bg-surface shadow-card"
        >
          <MovementFilters
            value={{ ...filters, visibility: effectiveVisibility }}
            onChange={handleFiltersChange}
          />
          <div className="border-t border-dashed border-border p-10 text-center">
            <h2 className="text-base font-semibold text-ink">Movimientos</h2>
            <p className="mt-2 text-sm text-ink-soft">
              No hay movimientos que coincidan con los filtros.
            </p>
          </div>
        </section>
      );
    }

    const visible = [...state.data].sort((a, b) =>
      sortByOccurredAtDesc(a.occurredAt, b.occurredAt),
    );
    const confirmingMovement = confirmingId
      ? (state.data.find((movement) => movement.id === confirmingId) ?? null)
      : null;

    return (
      <section
        aria-label="Movimientos"
        className="overflow-visible rounded-card border border-border bg-surface shadow-card"
      >
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-ink">Movimientos</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {state.data.length}{" "}
            {state.data.length === 1 ? "movimiento" : "movimientos"} registrados
          </p>
        </div>
        <MovementFilters value={{ ...filters, visibility: effectiveVisibility }} onChange={handleFiltersChange} />
        {markPaidError ? (
          <p
            role="alert"
            className="border-t border-border px-4 py-3 text-sm font-medium text-danger sm:px-6"
          >
            {markPaidError.status === 409
              ? "El movimiento ya no está pendiente."
              : "No se pudo marcar como pagado."}
          </p>
        ) : null}
        {false && (
        <div className="space-y-3 p-4">
          {visible.map((movement) =>
            movement.id === editingId ? (
              <div key={movement.id} className="rounded-card border border-border bg-surface-raised">
                <MovementEditForm
                  movement={movement}
                  refreshToken={refreshToken}
                  onSaved={() => {
                    setEditingId(null);
                    onMutated?.();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <article
                key={movement.id}
                className="rounded-card border border-border bg-surface-raised p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs tabular-nums text-ink-faint">
                      {formatMovementDate(movement.occurredAt)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={TYPE_BADGE_CLASS[movement.type]}>
                        {TYPE_LABELS[movement.type]}
                      </span>
                      {movement.status === "PENDING" ? (
                        <span className={PENDING_BADGE_CLASS}>Previsto</span>
                      ) : null}
                    </div>
                  </div>
                  <p
                    className={`shrink-0 text-right font-mono font-semibold tabular-nums ${
                      movement.type === "INCOME"
                        ? "text-income"
                        : movement.type === "SAVINGS"
                          ? "text-accent"
                          : "text-expense"
                    }`}
                  >
                    {formatARS(movement.amount)}
                  </p>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-faint">Categoría</dt>
                    <dd className="mt-1 break-words text-ink">
                      {movement.category ?? "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-faint">Moneda</dt>
                    <dd className="mt-1 text-ink-soft">{movement.currency}</dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-xs text-ink-faint">Nota</dt>
                    <dd className="mt-1 break-words text-ink-soft">
                      {movement.note ?? "—"}
                    </dd>
                  </div>
                  {movement.visibility === "SHARED" ? (
                    <div className="col-span-2 min-w-0">
                      <dt className="text-xs text-ink-faint">Compartido</dt>
                      <dd className="mt-1 break-words text-ink-soft">
                        {registrantName(movement)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {registrantOf(movement) === viewerId ? (
                  <div className="mt-4 border-t border-border pt-3">
                    {renderActions(movement)}
                  </div>
                ) : null}
              </article>
            ),
          )}
        </div>
        )}

        <div className="overflow-visible">
          <table className="w-full table-fixed text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs tracking-wide text-ink-faint uppercase">
                  <th className="px-2 py-3 font-medium sm:px-3">Fecha</th>
                  <th className="px-2 py-3 font-medium sm:px-3">Tipo</th>
                  <th className="px-2 py-3 text-right font-medium sm:px-3">
                    Monto
                  </th>
                  <th className="hidden px-2 py-3 text-center font-medium sm:table-cell sm:px-3">Moneda</th>
                  <th className="w-32 px-2 py-3 font-medium sm:w-40 sm:px-3">Categoría</th>
                  <th className="px-2 py-3 font-medium sm:px-3">Nota</th>
                  <th className="hidden w-20 px-2 py-3 text-center font-medium sm:table-cell sm:px-3">Compartido</th>
                  <th className="px-2 py-3 text-center font-medium sm:px-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((movement) =>
                  movement.id === editingId ? (
                    <tr key={movement.id} className="bg-surface-raised">
                      <td colSpan={8} className="px-0 py-0">
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
                      className="transition-colors even:bg-white/[0.02] hover:bg-white/5"
                    >
                      <td className="px-2 py-3 whitespace-nowrap tabular-nums sm:px-3">
                        {formatMovementDate(movement.occurredAt)}
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap sm:px-3">
                        <span className={TYPE_BADGE_CLASS[movement.type]}>
                          {TYPE_LABELS[movement.type]}
                        </span>
                        {movement.status === "PENDING" ? (
                          <span className={`${PENDING_BADGE_CLASS} ml-2`}>
                            Previsto
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={`px-2 py-3 text-right whitespace-nowrap sm:px-3 ${
                          movement.type === "INCOME"
                            ? "font-mono font-semibold text-income tabular-nums"
                            : movement.type === "SAVINGS"
                              ? "font-mono font-semibold text-accent tabular-nums"
                              : "font-mono font-semibold text-expense tabular-nums"
                        }`}
                      >
                        {formatARS(movement.amount)}
                      </td>
                      <td className="hidden px-2 py-3 text-center text-ink-soft sm:table-cell sm:px-3">
                        <span
                          aria-label={currencyIcon(movement.currency).label}
                          title={currencyIcon(movement.currency).label}
                        >
                          {currencyIcon(movement.currency).icon}
                        </span>
                      </td>
                      <td className="w-32 px-2 py-3 sm:w-40 sm:px-3">
                        <span className="inline-flex max-w-full whitespace-nowrap rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                          {movement.category ?? "—"}
                        </span>
                      </td>
                      <td className="break-words px-2 py-3 text-ink-soft sm:px-3">
                        {movement.note ?? "—"}
                      </td>
                      <td className="hidden w-20 px-2 py-3 text-center sm:table-cell sm:px-3">
                        {movement.visibility === "SHARED" ? (
                          <span
                            className={BADGE_CLASS}
                            aria-label="Movimiento compartido"
                            title="Movimiento compartido"
                          >
                            ✅
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-3 text-center whitespace-nowrap sm:px-3">{renderActions(movement)}</td>
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