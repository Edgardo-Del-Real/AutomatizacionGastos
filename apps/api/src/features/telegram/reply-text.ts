import type { QueryExecutionResult, RecentMovementResult } from "./query.types";
import type { ExecutionResult } from "./bot-brain";
import type { MovementCandidate } from "./movement-corrector";
import type { ReservedConcept } from "../categories/reserved";

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

/** Split confirmation (D7): reports gross, net and the saved amount. */
export function successSplitReply(gross: number, net: number, savings: number): string {
  return `Registrado: ingreso neto ${formatARS(net)} de ${formatARS(gross)} — Ahorrado: ${formatARS(savings)} (categoría ahorro)`;
}

/**
 * Planned-registration confirmation (D11): reports the previsto honestly —
 * the amount is NOT in the balance yet; it enters when marked paid.
 */
export function plannedReply(amount: number, note: string | null, category: string): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  return `Registrado como previsto: ${formatARS(amount)}${notePart} — Categoría: ${category}. Se suma cuando lo marques pagado.`;
}

/**
 * Educational redirect for combining `compartido:` with `previsto:` (either
 * order): planned expenses are INDIVIDUAL by design, so the combination is
 * rejected and nothing is created.
 */
export function plannedSharedRejectedReply(): string {
  return "Los gastos previstos son individuales: no se pueden marcar como compartidos. Usá 'previsto: monto nota' para un gasto previsto, o 'compartido: monto nota' para un gasto normal compartido.";
}

export function savingsRuleRedirectReply(): string {
  return "Para definir un ahorro automático usá el comando: registrar ahorro: <palabra> al <X>% (por ejemplo: registrar ahorro: entrenuts al 10%).";
}

export function savingsRuleDefinedReply(keyword: string, percent: number): string {
  return `Regla de ahorro guardada: "${keyword}" al ${percent}%.`;
}

export function savingsRuleInvalidReply(): string {
  return "El porcentaje de ahorro debe ser mayor a 0 y hasta 100 (ej: al 10%). No guardé nada.";
}

export function savingsOverrideInvalidReply(percent?: number): string {
  const value = percent === undefined ? "" : ` (${percent}%)`;
  return `El porcentaje de ahorro${value} debe ser mayor a 0 y hasta 100. No registré nada.`;
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

/**
 * Setup completion when one or more entries were rejected by the reserved
 * guard: confirms the created categories and appends the per-concept
 * educational redirects for the blocked names (spec "Setup entry gated").
 */
export function setupDoneWithRedirectsReply(
  created: string[],
  redirects: { name: string; concept: ReservedConcept }[],
): string {
  const createdPart = setupDoneReply(created);
  const lines = redirects.map((redirect) => `"${redirect.name}": ${reservedCategoryReply(redirect.name, redirect.concept)}`);
  return `${createdPart} No pude crear: ${lines.join(" / ")}`;
}

/**
 * Educational redirect for a reserved-concept rejection (design decision 4):
 * teaches the system usage for the concept instead of creating a phantom
 * category. Per-concept wording from the design "Redirect replies" section.
 */
export function reservedCategoryReply(name: string, concept: ReservedConcept): string {
  switch (concept) {
    case "previsto":
      return `"${name}" es un gasto fijo previsto: usá "previsto: <monto> <nota>" para registrarlo (ej: "previsto: 2500 alquiler").`;
    case "gasto fijo":
      return `"${name}" va como gasto fijo previsto: usá "previsto: <monto> <nota>" (ej: "previsto: 2500 alquiler"). Consultá tus previstos con "cuánto tengo previsto?".`;
    case "ahorro":
      return `"${name}" es la categoría de ahorro: definí tu regla con "registrar ahorro: <palabra> al <X>%" (ej: "registrar ahorro: sueldo al 10%").`;
    case "compartido":
    case "compartida":
      return `"${name}" se marca con el prefijo "compartido:" (ej: "compartido: 2500 expensas").`;
    case "otro":
      return `"${name}" es la categoría de respaldo para los movimientos sin categoría: no se crea manualmente.`;
  }
}

export function correctionOfferReply(amount: number, note: string | null, category: string): string {
  return `${successReply(amount, note, category)}. ¿Querés asignarle otra categoría? Escribí el nombre o "no".`;
}

/** Follow-up after an affirmation ("si", "dale") to the correction offer: asks the target category. */
export function categoryFollowUpReply(): string {
  return 'Dale, ¿a qué categoría lo asigno? Escribí el nombre o "no".';
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
    const kind = movement.type === "INCOME" ? "ingreso" : movement.type === "SAVINGS" ? "ahorro" : "gasto";
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

/** D12: "cuánto ahorré este mes" from the executed summary. */
export function savingsQueryReply(savings: number, month: string): string {
  const label = formatMonthLabel(month);
  return `En ${label} ahorraste ${formatARS(savings)}.`;
}

/** D7/D11: "cuánto tengo previsto" — next-month planned total from real data. */
export function plannedQueryReply(month: string, total: number): string {
  const label = formatMonthLabel(month);
  return `En ${label} tenés previsto ${formatARS(total)}.`;
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
    case "savings":
      return savingsQueryReply(result.savings, result.month);
    case "planned":
      return plannedQueryReply(result.month, result.total);
  }
}

export function associateKeywordRedirectReply(): string {
  return "Para asociar una palabra a una categoría usá el comando: asociar palabra: P a categoria: X.";
}

export function offTopicRedirectReply(): string {
  return "Solo registro gastos e ingresos: mandá el monto con una nota (ej: $2500 supermercado) y lo cargo al toque.";
}

/**
 * Registration-collection questions (spec "asked_registration Reply Action").
 * The collect dialog asks one field at a time: the amount first, then the
 * category. The note is echoed when the collect already carries one.
 */

/** Asks the amount of a registration being collected (open field: amount). */
export function askAmountReply(note: string | null): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  return `¿Qué monto tiene el gasto${notePart}? Mandame el número.`;
}

/** Asks the category of a registration being collected (open field: category). */
export function askCategoryReply(note: string | null): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  return `¿En qué categoría lo guardo${notePart}? Mandame el nombre.`;
}

/** Re-asks the open collect field after a non-answer (never dead-ends). */
export function keptCollectingReply(field: "amount" | "category"): string {
  const missing = field === "amount" ? "el monto" : "el nombre de la categoría";
  return `Sigo con el registro: falta ${missing}. Si querés cancelarlo, mandá "no, dejalo".`;
}

/** Explicit abandon of the collect: nothing registered, nothing pending. */
export function collectAbandonedReply(): string {
  return "Dale, cancelé el registro. No guardé nada.";
}

/** Warm, expense-scoped greeting for the `greeting` intent (dialogs stay open). */
export function greetingReply(): string {
  return "¡Hola! Estoy para tus gastos: mandame un monto con una nota (ej: $2500 supermercado) y lo cargo al toque.";
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

export function savingsForbiddenReply(): string {
  return 'La categoría de ahorro no se puede borrar ni renombrar: guarda los ahorros automáticos.';
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
      if (result.error === "reserved") {
        return result.message ?? categoryErrorReply("no se pudo crear la categoría");
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
      if (result.error === "savings_forbidden") {
        return savingsForbiddenReply();
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
      if (result.error === "reserved") {
        return result.message ?? categoryErrorReply("no se pudo renombrar la categoría");
      }
      if (result.error === "savings_forbidden") {
        return savingsForbiddenReply();
      }
      return categoryErrorReply(result.message ?? "no se pudo renombrar la categoría");
    case "capabilities":
      return capabilitiesSummaryReply();
    default:
      return helpReply();
  }
}