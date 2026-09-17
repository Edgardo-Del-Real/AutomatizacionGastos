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