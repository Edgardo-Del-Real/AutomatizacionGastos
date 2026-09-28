import { useState } from "react";
import type { FormEvent } from "react";

import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";
import { useViewer } from "../household/ViewerContext";
import { useCategories } from "./useCategories";
import { useMovementMutations } from "./useMovementMutations";

type Planned = MovementSummary["planned"];

type PlannedSectionProps = {
  /** `summary.planned` from the API: next-month PENDING EXPENSE total. */
  planned: Planned;
  /** Bumped on any successful mutation so categories re-fetch in place. */
  refreshToken?: number;
  /** Fires on successful creation so the App bumps the list + summary. */
  onMutated?: () => void;
};

const FIELD_CLASS =
  "mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
const LABEL_CLASS = "text-xs font-medium tracking-wide text-ink-faint uppercase";
const ERROR_CLASS = "text-sm font-medium text-danger";

/** Formats a "YYYY-MM" month key as an es-AR long month label ("septiembre de 2026"). */
function monthLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  // The API contract pins "YYYY-MM" (movementSummarySchema.planned.month); the
  // defaults are unreachable for a valid key.
  const date = new Date(Date.UTC(year ?? 1970, (monthIndex ?? 1) - 1, 1));
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * D9 — planned expenses section, rendered right after the KPI cards in the
 * kpis tab. Shows `summary.planned` (next-month total, es-AR) and hosts the
 * inline "Agregar previsto" form: amount, note, and category, with a
 * positive-amount guard that never reaches the API on invalid input.
 */
export function PlannedSection({
  planned,
  refreshToken,
  onMutated,
}: PlannedSectionProps) {
  const { viewerId } = useViewer();
  const categories = useCategories(viewerId, refreshToken);
  const { createPlanned, plannedCreateError, busy } =
    useMovementMutations(onMutated);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [invalidAmount, setInvalidAmount] = useState(false);

  const categoryNames =
    categories.status === "success"
      ? categories.data.map((item) => item.name)
      : [];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount);
    if (
      amount.trim() === "" ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    ) {
      setInvalidAmount(true);
      return;
    }

    void createPlanned({
      amount: parsedAmount,
      note: note.trim() === "" ? null : note,
      category: category === "" ? null : category,
    });
  }

  return (
    <section
      aria-label="Gastos fijos previstos"
      className="rounded-card border border-border bg-surface p-6 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-ink">
          Gastos fijos previstos
        </h2>
        <p className="text-sm text-ink-soft">{monthLabel(planned.month)}</p>
      </div>
      <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink">
        {formatARS(planned.total)}
      </p>

      <form
        aria-label="Agregar previsto"
        onSubmit={handleSubmit}
        className="mt-6 grid gap-3 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <label htmlFor="planned-amount" className={LABEL_CLASS}>
            Monto
          </label>
          <input
            id="planned-amount"
            type="number"
            step="0.01"
            value={amount}
            aria-invalid={invalidAmount}
            aria-describedby={invalidAmount ? "planned-error" : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
              setInvalidAmount(false);
            }}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="planned-note" className={LABEL_CLASS}>
            Nota
          </label>
          <input
            id="planned-note"
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="planned-category" className={LABEL_CLASS}>
            Categoría
          </label>
          <select
            id="planned-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">Sin categoría</option>
            {categoryNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy === "createPlanned"}
            className="inline-flex items-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
          >
            Agregar previsto
          </button>
        </div>
      </form>

      {invalidAmount ? (
        <p id="planned-error" role="alert" className={`${ERROR_CLASS} mt-3`}>
          El monto debe ser un número positivo.
        </p>
      ) : null}
      {plannedCreateError ? (
        <p role="alert" className={`${ERROR_CLASS} mt-3`}>
          No se pudo crear el gasto previsto.
        </p>
      ) : null}
    </section>
  );
}