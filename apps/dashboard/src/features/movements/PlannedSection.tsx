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
 * Planned expenses are INDIVIDUAL by design: there is no shared toggle.
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
      className="overflow-hidden rounded-card border border-border bg-surface shadow-card"
    >
      <div className="grid lg:grid-cols-[minmax(220px,0.75fr)_minmax(0,1.25fr)]">
        <div className="bg-accent p-6 text-on-accent sm:p-8">
          <p className="text-xs font-semibold tracking-[0.16em] text-on-accent/70 uppercase">
            Próximo mes
          </p>
          <h2 className="mt-3 text-xl font-bold">Gastos fijos previstos</h2>
          <p className="mt-1 text-sm text-on-accent/75">{monthLabel(planned.month)}</p>
          <p className="mt-8 font-mono text-3xl font-bold tabular-nums">
            {formatARS(planned.total)}
          </p>
          <p className="mt-2 text-sm text-on-accent/75">
            Planificá hoy para llegar tranquilo.
          </p>
        </div>
        <form
          aria-label="Agregar previsto"
          onSubmit={handleSubmit}
          className="grid gap-3 p-6 sm:grid-cols-2 sm:p-8"
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

          <div className="flex items-end sm:col-span-2">
          <button
            type="submit"
            disabled={busy === "createPlanned"}
            className="inline-flex items-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
          >
            Agregar previsto
          </button>
          </div>
        </form>
      </div>

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