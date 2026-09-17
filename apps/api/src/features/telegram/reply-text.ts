import type { QueryExecutionResult, RecentMovementResult } from "./query.types";

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

export function categoryErrorReply(message: string): string {
  return `Error: ${message}`;
}