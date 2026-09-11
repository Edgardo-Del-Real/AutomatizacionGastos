import { useState } from "react";
import type { FormEvent } from "react";

import type { Movement } from "@rita/contracts";

import type { MovementPatch } from "../../infra/api";
import { OWNER_ID } from "../../infra/env";
import { useCategories } from "./useCategories";
import { useMovementMutations } from "./useMovementMutations";

type MovementEditFormProps = {
  movement: Movement;
  refreshToken?: number;
  onSaved: () => void;
  onCancel: () => void;
};

const FIELD_CLASS =
  "mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LABEL_CLASS = "text-xs font-medium tracking-wide text-ink-faint uppercase";

export function MovementEditForm({
  movement,
  refreshToken,
  onSaved,
  onCancel,
}: MovementEditFormProps) {
  const categories = useCategories(OWNER_ID, refreshToken);
  const { updateMovement, patchError, busy } = useMovementMutations(onSaved);
  const [amount, setAmount] = useState(String(movement.amount));
  const [note, setNote] = useState(movement.note ?? "");
  const [category, setCategory] = useState(movement.category ?? "");
  const [invalidAmount, setInvalidAmount] = useState(false);

  const categoryNames =
    categories.status === "success" ? categories.data.map((item) => item.name) : [];
  // Legacy slugs are not part of the owner list; keep the current value selectable.
  const showCurrentCategory =
    movement.category !== null && !categoryNames.includes(movement.category);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setInvalidAmount(true);
      return;
    }

    const patch: MovementPatch = {};
    if (parsedAmount !== movement.amount) patch.amount = parsedAmount;
    if (note !== (movement.note ?? "")) patch.note = note.trim() === "" ? null : note;
    if (category !== (movement.category ?? "")) {
      patch.category = category === "" ? null : category;
    }

    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }

    void updateMovement(movement.id, patch);
  }

  return (
    <form
      aria-label="Editar movimiento"
      onSubmit={handleSubmit}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <label htmlFor="edit-amount" className={LABEL_CLASS}>
          Monto
        </label>
        <input
          id="edit-amount"
          type="number"
          step="0.01"
          value={amount}
          aria-invalid={invalidAmount}
          aria-describedby={invalidAmount ? "edit-error" : undefined}
          onChange={(event) => {
            setAmount(event.target.value);
            setInvalidAmount(false);
          }}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="edit-note" className={LABEL_CLASS}>
          Nota
        </label>
        <input
          id="edit-note"
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="edit-category" className={LABEL_CLASS}>
          Categoría
        </label>
        <select
          id="edit-category"
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
          {showCurrentCategory ? (
            <option value={movement.category!}>{movement.category}</option>
          ) : null}
        </select>
      </div>

      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={busy === "patch"}
          className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Cancelar
        </button>
      </div>

      {invalidAmount ? (
        <p
          id="edit-error"
          role="alert"
          className="text-sm font-medium text-danger sm:col-span-2 lg:col-span-4"
        >
          El monto debe ser un número positivo.
        </p>
      ) : null}
      {patchError ? (
        <p
          role="alert"
          className="text-sm font-medium text-danger sm:col-span-2 lg:col-span-4"
        >
          No se pudo guardar el movimiento.
        </p>
      ) : null}
    </form>
  );
}