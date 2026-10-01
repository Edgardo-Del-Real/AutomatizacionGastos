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

/**
 * v2 quick-capture preview (spec quick-capture "Capture Preview with
 * Save/Correct"): shows "¿Guardamos? $ {amount} ({note})" with the type label
 * chosen at the menu tap. The category is NOT in the text anymore — it is
 * chosen by the preview buttons (a pre-resolved category is never shown).
 * The type comes ONLY from the menu tap (REAL/PENDING/INGRESO/COMPARTIDO);
 * there is no type toggle in the preview.
 */
export function previewReply(
  amount: number,
  note: string | null,
  type: "REAL" | "PENDING" | "INGRESO" | "COMPARTIDO",
): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  const typeLabel = type === "PENDING" ? "previsto" : type === "INGRESO" ? "ingreso" : type === "COMPARTIDO" ? "compartido" : "real";
  return `¿Guardamos? ${formatARS(amount)}${notePart} — Tipo: ${typeLabel}`;
}

/**
 * v2 — fixed ask-category reply when `✅ Guardar` is tapped on a preview with
 * no category selected: nothing registers and the preview asks for a category
 * (spec quick-capture "Guardar is gated until a category is chosen").
 */
export function previewAskCategoryReply(): string {
  return "El botón ✅ Guardar recién funciona cuando elegís una categoría: tocá una de abajo o creala con ➕ Crear categoría.";
}

/**
 * v2 — educational redirect for capture-shaped free text in `idle` (spec
 * bot-free-text-routing "Educational Redirect for Capture-Shaped Text"): an
 * amount with or without a note is never captured from the chat; the owner is
 * taught to tap ➕ Nuevo gasto.
 */
export function captureShapedRedirectReply(): string {
  return "Los montos no se cargan desde el chat: mandalo desde ➕ Nuevo gasto del menú.";
}

/**
 * v2 — educational redirect for the legacy `previsto:` prefix (spec
 * planned-fixed-expenses / bot-free-text-routing "Legacy Prefix Redirect"):
 * planned expenses register only through the 📅 Gasto previsto button.
 */
export function previstoPrefixRedirectReply(): string {
  return "Para registrar un gasto previsto tocá 📅 Gasto previsto en el menú y mandá el monto con la nota.";
}

/**
 * v2 — educational redirect for the legacy `compartido:` prefix (spec
 * bot-free-text-routing "Legacy Prefix Redirect"): shared captures use the
 * 👥 Compartido menu button with type COMPARTIDO.
 */
export function compartidoPrefixRedirectReply(): string {
  return "Para registrar un gasto compartido tocá 👥 Compartido en el menú y mandá el monto con la nota.";
}

/**
 * v2 — educational redirect for legacy savings-override text ("sin ahorro" /
 * "con X%"): the split is automatic on every income per the owner's rule;
 * there is no per-message override anymore (spec savings "Deterministic
 * Overrides" REMOVED).
 */
export function savingsOverrideRedirectReply(): string {
  return "El ahorro se aplica automáticamente a tus ingresos según tu regla (registrar ahorro: palabra al X%): no hace falta indicarlo en el mensaje.";
}

/**
 * v2 — the unresolvable idle fallback (spec bot-free-text-routing
 * "Unresolvable Fallback"): the message is neither query, greeting,
 * capture-shaped nor a legacy prefix; the reply is never general chat.
 */
export function unresolvableReply(): string {
  return "No puedo resolver eso. Elegí una opción del menú.";
}

/**
 * v2 — category-name prompt for the `awaiting_category_name` state (design
 * D5): one state, three flows — the preview ➕ create, the 🗂 admin create and
 * the 🗂 admin rename. The flow is persisted so the next text routes to the
 * right guarded operation.
 */
export function categoryNamePromptReply(flow: "preview" | "admin_create" | "admin_rename"): string {
  switch (flow) {
    case "preview":
      return "¿Cómo se llama la categoría nueva? La creo y la dejo seleccionada en la vista previa.";
    case "admin_create":
      return "¿Cómo se llama la categoría que querés crear?";
    case "admin_rename":
      return "¿Cómo se llama el nombre nuevo de la categoría?";
  }
}

/**
 * v2 — stateless category-delete confirmation (design D6): the picked id rides
 * in the callback (`ac:ok:<id>`/`ac:no:<id>`) and the guarded service
 * re-validates; only the expense-admin movement delete uses the persisted gate.
 */
export function categoryDeleteConfirmReply(name: string): string {
  return `¿Borrar la categoría "${name}"? Confirmá abajo.`;
}

/**
 * v2 — pick abandonment reply (spec movement-correction "Ambiguity
 * Resolution"): a menu tap or an unrelated message during a pick abandons it,
 * leaving every movement unchanged and returning to the menu.
 */
export function selectionAbandonedReply(): string {
  return "Dale, abandoné la selección: no cambié nada.";
}

/** Capture prompt after Corregir (D4): reopens text capture with the short format. */
export function capturePromptReply(): string {
  return "Dale, mandame de nuevo el monto con la nota, por ejemplo: 30000 gym.";
}

/** Educational prompt for the `m:prev` menu button (D8): teaches the prefix AND the Previsto button. */
export function pendingCapturePromptReply(): string {
  return "Para un gasto previsto mandá el monto con la nota usando el prefijo 'previsto:' (ej: previsto: 30000 alquiler), o registralo y tocá el botón Previsto de la vista previa.";
}

/** Idempotency reply for a retried callback whose token/state was consumed (D5). */
export function alreadyProcessedReply(): string {
  return "Esa acción ya fue procesada: no la vuelvo a ejecutar.";
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

export function setupQuestionReply(existing: string[]): string {
  if (existing.length === 0) {
    return "No tenés categorías todavía. Enviá una lista separada por comas o líneas, por ejemplo: Cafe, Transporte, Salud. También podés usar comandos: borrar categoria: X, renombrar categoria: X a: Y.";
  }
  const lines = existing.map((name) => `- ${name}`);
  return `Tus categorías actuales:\n${lines.join("\n")}\nMandá categorías nuevas, o comandos como "borrar categoria: X" / "renombrar categoria: X a: Y".`;
}

export function setupRetryReply(): string {
  return "No reconocí ninguna categoría. Enviá la lista de nuevo, por ejemplo: Cafe, Transporte, Salud.";
}

export function setupDoneReply(created: string[]): string {
  return `Categorías creadas: ${created.join(", ")}.`;
}

/**
 * Single summary reply for a setup batch (design D11): created names,
 * executed deletes/renames, and any reserved redirects in one message.
 */
export function setupBatchDoneReply(summary: {
  created: string[];
  redirects: { name: string; concept: ReservedConcept }[];
  deleted: string[];
  renamed: { from: string; to: string }[];
}): string {
  const parts: string[] = [];
  if (summary.created.length > 0) {
    parts.push(setupDoneReply(summary.created));
  }
  if (summary.deleted.length > 0) {
    parts.push(`Borradas: ${summary.deleted.join(", ")}.`);
  }
  if (summary.renamed.length > 0) {
    parts.push(`Renombradas: ${summary.renamed.map((rename) => `"${rename.from}" a "${rename.to}"`).join(", ")}.`);
  }
  if (summary.redirects.length > 0) {
    parts.push(
      `No pude crear: ${summary.redirects.map((redirect) => `"${redirect.name}": ${reservedCategoryReply(redirect.name, redirect.concept)}`).join(" / ")}`,
    );
  }
  return parts.join(" ");
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

/**
 * D9 — the closed-set category picker prompt: renders when a dialog answer
 * matches no category (single-token or multi-word). The existing categories
 * render as inline buttons (cat:<id>, "otro" included) and the state stays
 * open — never an auto-create (spec conversational-categories / registration-
 * collection "Dialog Category Answers (Closed Set)").
 */
export function categoryButtonsReply(): string {
  return "Elegí una de estas categorías (o tocá una de abajo): incluye 'otro' para dejarlo sin categoría.";
}

/** D9 — a `cat:` callback on an already-closed dialog: honest, nothing executes. */
export function dialogClosedReply(): string {
  return "Ese diálogo ya está cerrado: no cambié nada.";
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

/**
 * v2 — educational redirect for legacy text category-CRUD commands (spec
 * telegram-bot "Bot Commands"): `registrar categoria:`, `renombrar
 * categoria:` and `asociar palabra:` are NOT commands anymore; a message
 * carrying one teaches the 🗂 Administrar categorías button and never creates
 * or renames anything.
 */
export function categoryCrudRedirectReply(): string {
  return "Para crear, renombrar o asociar categorías usá el botón 🗂 Administrar categorías del menú.";
}

export function offTopicRedirectReply(): string {
  return "Solo registro gastos e ingresos: mandá el monto con una nota (ej: $2500 supermercado) y lo cargo al toque.";
}

/**
 * Main-menu text (D8): the five actions render as one-per-row buttons
 * (m:new/m:prev/m:del/m:rep/m:help) — Nuevo gasto, Gasto previsto, Borrar,
 * Reporte, Ayuda (spec bot-main-menu "Main Menu Actions").
 */
export function menuReply(): string {
  return "Elegí una opción del menú:";
}

/**
 * v2 static help (spec bot-main-menu "Static Help"): explains the eight-button
 * menu with real capture examples, works with GROQ_API_KEY unset, and states
 * that amounts typed directly in chat are not captured (they redirect to ➕
 * Nuevo gasto). Never teaches prefixes or text category commands.
 */
export function ayudaReply(): string {
  return (
    "Bot de gastos e ingresos.\n" +
    "- ➕ Nuevo gasto — tocá el botón y mandá el monto con la nota (ej: 30000 gym).\n" +
    "- 📅 Gasto previsto — tocá el botón y mandá monto + nota (ej: 2500 alquiler).\n" +
    "- ➕ Ingreso — tocá el botón y mandá monto + nota (ej: 1000 entrenuts).\n" +
    "- 👥 Compartido — tocá el botón y mandá monto + nota.\n" +
    "- 🗂 Administrar categorías — creá, renombrá y borrá categorías.\n" +
    "- 🧾 Administrar gastos — borrá gastos, corregí categorías y marcá previstos como pagados.\n" +
    "- 📊 Reportes — consultá movimientos, saldo y resúmenes.\n" +
    "- ❓ Ayuda — mostrá esta ayuda.\n" +
    "Los montos escritos directo en el chat no se cargan: usá ➕ Nuevo gasto.\n" +
    "Comandos: menu, ayuda, listar categorias, configurar categorias."
  );
}

/**
 * Honest reply for an unrecognized callback action prefix (spec
 * bot-inline-interactions "Unknown action replied honestly"): the action does
 * not exist, nothing ran and no state changed.
 */
export function callbackUnavailableReply(): string {
  return "Esa acción ya no está disponible.";
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

/**
 * v2 warm, expense-scoped greeting for the `greeting` intent (spec
 * telegram-bot "Success and Help Reply Content"): greets and points to the
 * menu; it never teaches free-text capture and never starts a flow.
 */
export function greetingReply(): string {
  return "¡Hola! Estoy listo para tus gastos e ingresos. Elegí una opción del menú o preguntame por tus números.";
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
    "- marcar como pagado un gasto previsto\n" +
    "- borrar un gasto\n" +
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
export function movementCandidatesList(candidates: { amount: number; note: string | null; date: string }[]): string {
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

/** Lifecycle candidate shape for the ambiguity ask (the executor's `LifecycleCandidate` satisfies it). */
export type LifecycleAskCandidate = { amount: number; note: string | null; date: string };

/** Confirms a marked-paid transition (PENDING → PAID) with the executed facts. */
export function markPaidReply(amount: number, note: string | null, category: string | null): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  const categoryPart = category !== null && category.length > 0 ? ` — Categoría: ${category}` : "";
  return `Listo, marqué como pagado: ${formatARS(amount)}${notePart}${categoryPart}.`;
}

/** Conflict notice for an already-PAID referenced movement (409): nothing changed. */
export function markPaidAlreadyReply(): string {
  return "Ese movimiento ya estaba pagado: no cambié nada.";
}

/** Mark-paid no-match: nothing was pending, nothing changed (dedicated wording mirrors the delete path). */
export function nothingPendingReply(): string {
  return "No encontré ningún gasto previsto pendiente que coincida con eso.";
}

/** Delete no-match: states BOTH that nothing matched AND that nothing was deleted. */
export function nothingToDeleteReply(): string {
  return "No encontré ningún movimiento que coincida con eso para borrar. No borré nada.";
}

/** Confirms a deleted expense with the executed facts. */
export function deletedMovementReply(amount: number, note: string | null, category: string | null): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  const categoryPart = category !== null && category.length > 0 ? ` — Categoría: ${category}` : "";
  return `Borré el gasto: ${formatARS(amount)}${notePart}${categoryPart}.`;
}

/** Ambiguity ask for mark-paid: which planned expense was paid (fixed-only). */
export function markPaidAskReply(candidates: LifecycleAskCandidate[]): string {
  return `¿Cuál de estos gastos previstos marcaste como pagado?\n${movementCandidatesList(candidates)}`;
}

/** Ambiguity ask for delete: which expense to delete (fixed-only). */
export function deleteAskReply(candidates: LifecycleAskCandidate[]): string {
  return `¿Cuál de estos gastos querés borrar?\n${movementCandidatesList(candidates)}`;
}

/**
 * Delete-confirmation gate (D6): names the resolved target and asks for the
 * explicit 🗑 confirmation. Nothing is deleted until the owner taps it.
 */
export function deleteConfirmReply(amount: number, note: string | null, category: string | null): string {
  const notePart = note === null ? "" : ` (${truncateNote(note)})`;
  const categoryPart = category !== null && category.length > 0 ? ` — Categoría: ${category}` : "";
  return `¿Borrar este gasto? ${formatARS(amount)}${notePart}${categoryPart} Confirmá abajo.`;
}

/** Cancel reply for `dc:no`: the gate closes and nothing was deleted (D6). */
export function deleteCancelledReply(): string {
  return "Dale, cancelé el borrado: no se borró nada.";
}

/** Pick list for the menu `Borrar` entry (D10): numbered candidates to choose from. */
export function deletePickListReply(candidates: LifecycleAskCandidate[]): string {
  return `¿Cuál querés borrar?\n${movementCandidatesList(candidates)}`;
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