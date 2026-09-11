import type { MovementType } from "@rita/contracts";

import type { MovementListFilters } from "../../infra/api";

export type MovementFiltersProps = {
  value: MovementListFilters;
  onChange: (filters: MovementListFilters) => void;
};

const CONTROL_CLASS =
  "h-9 rounded-control border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
const LABEL_CLASS =
  "text-xs font-semibold tracking-wide text-ink-faint uppercase";

export function MovementFilters({ value, onChange }: MovementFiltersProps) {
  const update = (patch: Partial<MovementListFilters>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="movement-type-filter" className={LABEL_CLASS}>
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
          className={CONTROL_CLASS}
        >
          <option value="">Todos</option>
          <option value="INCOME">Ingreso</option>
          <option value="EXPENSE">Gasto</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="movement-from-filter" className={LABEL_CLASS}>
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
          className={CONTROL_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="movement-to-filter" className={LABEL_CLASS}>
          Hasta
        </label>
        <input
          id="movement-to-filter"
          aria-label="Hasta"
          type="date"
          value={value.to ?? ""}
          onChange={(event) => update({ to: event.target.value || undefined })}
          className={CONTROL_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="movement-category-filter" className={LABEL_CLASS}>
          Categoría
        </label>
        <input
          id="movement-category-filter"
          aria-label="Categoría"
          value={value.category ?? ""}
          onChange={(event) =>
            update({ category: event.target.value || undefined })
          }
          className={CONTROL_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="movement-q-filter" className={LABEL_CLASS}>
          Texto
        </label>
        <input
          id="movement-q-filter"
          aria-label="Texto"
          value={value.q ?? ""}
          onChange={(event) => update({ q: event.target.value || undefined })}
          className={CONTROL_CLASS}
        />
      </div>

      <button
        type="button"
        onClick={() => onChange({})}
        className="inline-flex h-9 items-center rounded-control border border-border bg-surface px-4 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        Limpiar
      </button>
    </div>
  );
}