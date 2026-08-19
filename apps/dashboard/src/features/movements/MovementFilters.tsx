import type { MovementType } from "@rita/contracts";

import type { MovementListFilters } from "../../infra/api";

export type MovementFiltersProps = {
  value: MovementListFilters;
  onChange: (filters: MovementListFilters) => void;
};

export function MovementFilters({ value, onChange }: MovementFiltersProps) {
  const update = (patch: Partial<MovementListFilters>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="movement-type-filter"
          className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
        >
          Tipo
        </label>
        <select
          id="movement-type-filter"
          aria-label="Tipo"
          value={value.type ?? ""}
          onChange={(event) =>
            update({
              type: (event.target.value || undefined) as
                | MovementType
                | undefined,
            })
          }
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        >
          <option value="">Todos</option>
          <option value="INCOME">Ingreso</option>
          <option value="EXPENSE">Gasto</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="movement-from-filter"
          className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
        >
          Desde
        </label>
        <input
          id="movement-from-filter"
          aria-label="Desde"
          type="date"
          value={value.from ?? ""}
          onChange={(event) =>
            update({ from: event.target.value || undefined })
          }
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="movement-to-filter"
          className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
        >
          Hasta
        </label>
        <input
          id="movement-to-filter"
          aria-label="Hasta"
          type="date"
          value={value.to ?? ""}
          onChange={(event) => update({ to: event.target.value || undefined })}
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="movement-category-filter"
          className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
        >
          Categoría
        </label>
        <input
          id="movement-category-filter"
          aria-label="Categoría"
          value={value.category ?? ""}
          onChange={(event) =>
            update({ category: event.target.value || undefined })
          }
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="movement-q-filter"
          className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
        >
          Texto
        </label>
        <input
          id="movement-q-filter"
          aria-label="Texto"
          value={value.q ?? ""}
          onChange={(event) => update({ q: event.target.value || undefined })}
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      <button
        type="button"
        onClick={() => onChange({})}
        className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Limpiar
      </button>
    </div>
  );
}
