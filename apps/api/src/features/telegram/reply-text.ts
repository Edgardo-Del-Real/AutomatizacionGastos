import type { QueryExecutionResult, RecentMovementResult } from "./query.types";
import type { ExecutionResult } from "./bot-brain";
import type { MovementCandidate } from "./movement-corrector";

const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

const NOTE_MAX_LENGTH = 500;

/** Formats a number as ARS currency using the es-AR locale (e.g. "$ 1.500,00"). */
export function formatARS(value: number): string {
  return arsFormatter.format(value);
}

/** Truncates a note to NOTE_MAX_LENGTH chars, appending an ellipsis when cut. */
export function truncateNote(note: string): string {
  if (note.length <= NOTE_MAX_LENGTH) {
    return note;
  }
  return `${note.slice(0, NOTE_MAX_LENGTH - 1)}…`;
}

export function successReply(amount: number, note: string | null, category: string): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  return `Registrado: ${formatARS(amount)}${notePart} — Categoría: ${category}`;
}

export function helpReply(): string {
  return (
    "No entendí el mensaje. Enviá un monto con una nota, por ejemplo: $2500 supermercado.\n" +
    "Comandos:\n" +
    "- registrar categoria: X\n" +
    "- renombrar categoria: X a: Y\n" +
    "- asociar palabra: P a categoria: X\n" +
    "- listar categorias\n" +
    "- configurar categorias"
  );
}

export function setupQuestionReply(): string {
  return "No tenés categorías todavía. Enviá una lista separada por comas o líneas, por ejemplo: Cafe, Transporte, Salud.";
}

export function setupRetryReply(): string {
  return "No reconocí ninguna categoría. Enviá la lista de nuevo, por ejemplo: Cafe, Transporte, Salud.";
}

export function setupDoneReply(created: string[]): string {
  return `Categorías creadas: ${created.join(", ")}.`;
}

export function correctionOfferReply(amount: number, note: string | null, category: string): string {
  return `${successReply(amount, note, category)}. ¿Querés asignarle otra categoría? Escribí el nombre o "no".`;
}

export function correctionDoneReply(category: string): string {
  return `Listo, el movimiento quedó en "${category}".`;
}

export function otroKeptReply(): string {
  return `Listo, quedó en "otro".`;
}

export function categoryNotFoundReply(name: string, categories: string[]): string {
  const quoted = categories.map((category) => `"${category}"`).join(", ");
  return `No encontré la categoría "${name}". Elegí una de estas: ${quoted}.`;
}

export function correctionAbandonedReply(): string {
  return `Ojo: dejé sin asignar la corrección anterior (el movimiento queda en "otro"). Ahora registro el nuevo.`;
}

export function amountConflictReply(deterministic: number, llm: number): string {
  return `El monto no me queda claro: parseé ${formatARS(deterministic)} y también ${formatARS(llm)}. Respondé con el monto, o mandá un registro nuevo y lo descarto.`;
}

export function amountConfirmationAbandonedReply(): string {
  return "Ojo: dejé sin asignar la pregunta del monto. Ahora registro el mensaje nuevo.";
}

export function queryRedirectReply(): string {
  return "No pude consultar los datos ahora. Probá de nuevo en un ratito, o mandá el monto con una nota para registrar un gasto.";
}

/** Formats a "YYYY-MM-DD" date as "DD/MM" for compact movement lines. */
function formatDateShort(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (year === undefined || month === undefined || day === undefined) {
    return isoDate;
  }
  return `${day}/${month}`;
}

export function categoriesQueryReply(categories: { name: string; keywords: string[] }[]): string {
  if (categories.length === 0) {
    return "No tenés categorías todavía.";
  }
  const lines = categories.map((category) => {
    const keywords = category.keywords.length > 0 ? ` (${category.keywords.join(", ")})` : "";
    return `- ${category.name}${keywords}`;
  });
  return `Tus categorías:\n${lines.join("\n")}`;
}

export function recentQueryReply(movements: RecentMovementResult[]): string {
  if (movements.length === 0) {
    return "Todavía no tenés movimientos registrados.";
  }
  const lines = movements.map((movement) => {
    const kind = movement.type === "INCOME" ? "ingreso" : "gasto";
    const category = movement.category ?? "sin categoría";
    const note = movement.note !== null ? ` (${truncateNote(movement.note)})` : "";
    return `- ${formatDateShort(movement.date)} · ${kind} ${formatARS(movement.amount)} · ${category}${note}`;
  });
  return `Tus últimos movimientos:\n${lines.join("\n")}`;
}

export function balanceQueryReply(balance: number, income: number, expenses: number): string {
  return `Tu balance es ${formatARS(balance)} (ingresos ${formatARS(income)} − gastos ${formatARS(expenses)}).`;
}

export function monthQueryReply(month: string, income: number, expenses: number, count: number): string {
  const label = formatMonthLabel(month);
  return `En ${label} ingresaste ${formatARS(income)} y gastaste ${formatARS(expenses)} (${count} movimientos).`;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (year === undefined || month === undefined || Number.isNaN(year) || Number.isNaN(month)) {
    return monthKey;
  }
  // Local date construction: the label must not shift a day/month across TZs.
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

export function queryReplyTemplate(result: QueryExecutionResult): string {
  switch (result.query_type) {
    case "categories":
      return categoriesQueryReply(result.categories);
    case "recent":
      return recentQueryReply(result.movements);
    case "balance":
      return balanceQueryReply(result.balance, result.income, result.expenses);
    case "month":
      return monthQueryReply(result.month, result.monthIncome, result.monthExpenses, result.monthCount);
  }
}

export function associateKeywordRedirectReply(): string {
  return "Para asociar una palabra a una categoría usá el comando: asociar palabra: P a categoria: X.";
}

export function offTopicRedirectReply(): string {
  return "Solo registro gastos e ingresos: mandá el monto con una nota (ej: $2500 supermercado) y lo cargo al toque.";
}

export function categoryCreatedReply(name: string): string {
  return `Categoría "${name}" creada.`;
}

export function categoryDeletedReply(name: string): string {
  return `Categoría "${name}" borrada.`;
}

export function otroDeleteForbiddenReply(): string {
  return 'No puedo borrar la categoría "otro": es el respaldo para los movimientos sin categoría.';
}

export function capabilitiesSummaryReply(): string {
  return (
    "Puedo:\n" +
    "- registrar gastos e ingresos (monto + nota)\n" +
    "- corregir el monto o la categoría de un movimiento\n" +
    "- consultar tus categorías, últimos movimientos, saldo o resumen del mes\n" +
    "- crear, borrar y renombrar categorías\n" +
    "- asociar una palabra a una categoría\n" +
    "- ayudarte (mandá un monto con una nota y lo cargo)"
  );
}

export function categoryRenamedReply(from: string, to: string): string {
  return `Categoría renombrada: "${from}" → "${to}".`;
}

export function keywordAssociatedReply(keyword: string, category: string): string {
  return `Palabra "${keyword}" asociada a "${category}".`;
}

export function categoryListReply(categories: { name: string; keywords: string[] }[]): string {
  if (categories.length === 0) {
    return "No hay categorías.";
  }
  return categories
    .map((category) => {
      const keywords = category.keywords.length > 0 ? ` (${category.keywords.join(", ")})` : "";
      return `- ${category.name}${keywords}`;
    })
    .join("\n");
}

export function duplicateCategoryReply(name: string): string {
  return `Ya existe una categoría "${name}".`;
}

export function missingCategoryReply(name: string): string {
  return `No existe la categoría "${name}".`;
}

export function movementMissingReply(): string {
  return "Ese movimiento ya no existe.";
}

/** Numbered candidates list: `n) DD/MM · $ monto · nota` (design D8: fixed-only). */
export function movementCandidatesList(candidates: MovementCandidate[]): string {
  return candidates
    .map((candidate, index) => {
      const note = candidate.note !== null ? ` · ${truncateNote(candidate.note)}` : "";
      return `${index + 1}) ${formatDateShort(candidate.date)} · ${formatARS(candidate.amount)}${note}`;
    })
    .join("\n");
}

export function movementAmbiguousReply(
  _reference: { amount: number | null; note: string | null },
  candidates: MovementCandidate[],
): string {
  return `¿Cuál de estos movimientos corrijo?\n${movementCandidatesList(candidates)}`;
}

export function movementNoReferenceReply(candidates: MovementCandidate[]): string {
  return `¿Qué movimiento querés corregir?\n${movementCandidatesList(candidates)}`;
}

export function movementNoMatchReply(): string {
  return "No encontré ningún movimiento que coincida con eso.";
}

export function movementSelectionAbandonedReply(): string {
  return "Dale, dejé la corrección. No cambié ningún movimiento.";
}

/** Phantom-guard abandon: nothing was resolved, nothing was reprocessed. */
export function questionDroppedReply(): string {
  return "Ojo: dejé la pregunta anterior sin responder. No registré ni modifiqué nada.";
}

export function movementCorrectionDoneReply(category: string, amount: number, note: string | null): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  return `Listo, el movimiento de ${formatARS(amount)}${notePart} quedó en "${category}".`;
}

export function categoryCreatedReassignedReply(category: string): string {
  return `Categoría "${category}" creada y el movimiento pendiente quedó guardado ahí.`;
}

export function categoryErrorReply(message: string): string {
  return `Error: ${message}`;
}

/**
 * Fixed fallback for the category CRUD and capabilities execution results.
 * Mirrors `queryReplyTemplate`: renders the same facts the brain reply would.
 */
export function categoryCommandReplyTemplate(result: ExecutionResult): string {
  switch (result.intent) {
    case "create_category":
      if (result.ok && result.action === "created_reassigned") {
        return categoryCreatedReassignedReply(result.category ?? "");
      }
      if (result.ok) {
        return categoryCreatedReply(result.category ?? "");
      }
      if (result.error === "duplicate") {
        return duplicateCategoryReply(result.category ?? "");
      }
      return categoryErrorReply(result.message ?? "no se pudo crear la categoría");
    case "delete_category":
      if (result.ok) {
        return categoryDeletedReply(result.category ?? "");
      }
      if (result.error === "not_found") {
        return missingCategoryReply(result.category ?? "");
      }
      if (result.error === "otro_forbidden") {
        return otroDeleteForbiddenReply();
      }
      return categoryErrorReply(result.message ?? "no se pudo borrar la categoría");
    case "rename_category":
      if (result.ok) {
        return categoryRenamedReply(result.category ?? "", result.new_name ?? "");
      }
      if (result.error === "not_found") {
        return missingCategoryReply(result.category ?? "");
      }
      if (result.error === "duplicate") {
        return duplicateCategoryReply(result.new_name ?? "");
      }
      return categoryErrorReply(result.message ?? "no se pudo renombrar la categoría");
    case "capabilities":
      return capabilitiesSummaryReply();
    default:
      return helpReply();
  }
}