import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "./bot-brain";
import {
  amountConfirmationAbandonedReply,
  amountConflictReply,
  balanceQueryReply,
  capabilitiesSummaryReply,
  categoriesQueryReply,
  categoryCommandReplyTemplate,
  categoryCreatedReply,
  categoryDeletedReply,
  categoryErrorReply,
  categoryListReply,
  categoryNotFoundReply,
  categoryRenamedReply,
  correctionAbandonedReply,
  correctionDoneReply,
  correctionOfferReply,
  duplicateCategoryReply,
  formatARS,
  helpReply,
  keywordAssociatedReply,
  missingCategoryReply,
  monthQueryReply,
  movementMissingReply,
  otroDeleteForbiddenReply,
  otroKeptReply,
  queryReplyTemplate,
  recentQueryReply,
  setupDoneReply,
  setupQuestionReply,
  setupRetryReply,
  successReply,
  truncateNote,
} from "./reply-text";

describe("formatARS", () => {
  it("formats ARS amounts with the es-AR locale", () => {
    expect(formatARS(2500)).toBe("$\u00A02.500,00");
  });

  it("formats decimal amounts", () => {
    expect(formatARS(1500.5)).toBe("$\u00A01.500,50");
  });
});

describe("truncateNote", () => {
  it("keeps a short note unchanged", () => {
    expect(truncateNote("cafe")).toBe("cafe");
  });

  it("truncates a note longer than 500 chars with an ellipsis", () => {
    const long = "a".repeat(520);
    const result = truncateNote(long);

    expect(result).toHaveLength(500);
    expect(result.endsWith("…")).toBe(true);
    expect(result.slice(0, 499)).toBe("a".repeat(499));
  });
});

describe("reply builders", () => {
  it("builds a success confirmation with amount, note and category", () => {
    expect(successReply(2500, "cafe", "Cafe")).toBe(
      "Registrado: $\u00A02.500,00 (cafe) — Categoría: Cafe",
    );
  });

  it("builds a success confirmation without a note", () => {
    expect(successReply(8000, null, "otro")).toBe(
      "Registrado: $\u00A08.000,00 — Categoría: otro",
    );
  });

  it("truncates long notes inside the success reply", () => {
    const long = "x".repeat(600);
    const result = successReply(100, long, "Cafe");
    expect(result).toContain("…");
    expect(result.length).toBeLessThan(600);
  });

  it("builds the help text mentioning commands", () => {
    const text = helpReply();
    expect(text).toContain("No entendí");
    expect(text).toContain("registrar categoria");
    expect(text).toContain("renombrar categoria");
    expect(text).toContain("asociar palabra");
    expect(text).toContain("listar categorias");
    expect(text).toContain("configurar categorias");
  });

  it("builds the setup question", () => {
    expect(setupQuestionReply()).toContain("categorías");
  });

  it("builds the setup retry question", () => {
    expect(setupRetryReply()).toContain("categoría");
  });

  it("builds the setup-done confirmation listing the created categories", () => {
    expect(setupDoneReply(["Cafe", "Transporte", "otro"])).toBe(
      'Categorías creadas: Cafe, Transporte, otro.',
    );
  });

  it("builds the correction offer confirming the registration first and then offering reassignment", () => {
    expect(correctionOfferReply(2500, "capuchino", "otro")).toBe(
      'Registrado: $\u00A02.500,00 (capuchino) — Categoría: otro. ¿Querés asignarle otra categoría? Escribí el nombre o "no".',
    );
  });

  it("builds the correction done confirmation", () => {
    expect(correctionDoneReply("Transporte")).toBe('Listo, el movimiento quedó en "Transporte".');
  });

  it("builds the keep-as-otro confirmation", () => {
    expect(otroKeptReply()).toBe('Listo, quedó en "otro".');
  });

  it("builds the category-not-found reply listing the existing categories", () => {
    const reply = categoryNotFoundReply("Zapateria", ["Cafe", "otro"]);
    expect(reply).toContain('"Zapateria"');
    expect(reply).toContain('"Cafe"');
    expect(reply).toContain('"otro"');
  });

  it("builds the abandoned-correction warning", () => {
    expect(correctionAbandonedReply()).toContain("otro");
  });

  it("builds the amount-conflict reply showing both formatted amounts", () => {
    const reply = amountConflictReply(5000, 4800);

    expect(reply).toContain(formatARS(5000));
    expect(reply).toContain(formatARS(4800));
    expect(reply).toContain("Respondé con el monto, o mandá un registro nuevo y lo descarto");
  });

  it("builds the amount-confirmation abandonment reply", () => {
    const reply = amountConfirmationAbandonedReply();

    expect(reply).toContain("monto");
    expect(reply).toContain("registro");
  });

  it("builds command confirmations", () => {
    expect(categoryCreatedReply("Salud")).toBe('Categoría "Salud" creada.');
    expect(categoryRenamedReply("Cafe", "Cafeteria")).toBe(
      'Categoría renombrada: "Cafe" → "Cafeteria".',
    );
    expect(keywordAssociatedReply("uber", "Transporte")).toBe(
      'Palabra "uber" asociada a "Transporte".',
    );
  });

  it("builds the delete confirmation and the otro-guard warning", () => {
    expect(categoryDeletedReply("Viajes")).toBe('Categoría "Viajes" borrada.');
    expect(otroDeleteForbiddenReply()).toContain("otro");
  });

  it("builds a capabilities summary listing what the bot can do", () => {
    const summary = capabilitiesSummaryReply();

    expect(summary).toContain("registrar");
    expect(summary).toContain("consultar");
    expect(summary).toContain("borrar");
    expect(summary).toContain("renombrar");
    expect(summary).toContain("asociar");
  });

  it("builds command error replies", () => {
    expect(duplicateCategoryReply("Salud")).toContain("Salud");
    expect(missingCategoryReply("Salud")).toContain("Salud");
    expect(categoryErrorReply("boom")).toBe("Error: boom");
    expect(movementMissingReply()).toContain("no existe");
  });

  it("builds a category list with keywords", () => {
    const list = categoryListReply([
      { name: "Cafe", keywords: ["cafe"] },
      { name: "otro", keywords: [] },
    ]);
    expect(list).toContain("Cafe");
    expect(list).toContain("cafe");
    expect(list).toContain("otro");
  });

  it("builds an empty category list message", () => {
    expect(categoryListReply([])).toBe("No hay categorías.");
  });
});

describe("query reply templates", () => {
  it("lists the categories with their keywords", () => {
    const text = categoriesQueryReply([
      { name: "Cafe", keywords: ["cafe"] },
      { name: "otro", keywords: [] },
    ]);

    expect(text).toContain("Cafe");
    expect(text).toContain("cafe");
    expect(text).toContain("otro");
  });

  it("warns when there are no categories", () => {
    expect(categoriesQueryReply([])).toContain("categorías");
  });

  it("lists the recent movements with amount, category, note and date", () => {
    const text = recentQueryReply([
      { amount: 2500, category: "Cafe", note: "cafe con leche", date: "2026-09-17", type: "EXPENSE" },
      { amount: 50000, category: null, note: null, date: "2026-09-16", type: "INCOME" },
    ]);

    expect(text).toContain(formatARS(2500));
    expect(text).toContain("Cafe");
    expect(text).toContain("cafe con leche");
    expect(text).toContain("17/09");
    expect(text).toContain(formatARS(50000));
    expect(text).toContain("ingreso");
  });

  it("warns when there are no movements", () => {
    expect(recentQueryReply([])).toContain("movimientos");
  });

  it("builds the balance reply from income minus expenses", () => {
    const text = balanceQueryReply(1000, 3000, 2000);

    expect(text).toContain(formatARS(1000));
    expect(text).toContain(formatARS(3000));
    expect(text).toContain(formatARS(2000));
  });

  it("builds the month summary reply", () => {
    const text = monthQueryReply("2026-09", 3000, 2000, 4);

    expect(text).toContain(formatARS(2000));
    expect(text).toContain(formatARS(3000));
    expect(text).toContain("4");
  });

  it("selects the fixed template per query_type", () => {
    expect(queryReplyTemplate({ query_type: "categories", categories: [] })).toContain("categorías");
    expect(queryReplyTemplate({ query_type: "recent", movements: [] })).toContain("movimientos");
    expect(queryReplyTemplate({ query_type: "balance", balance: 1, income: 2, expenses: 1 })).toContain("balance");
    expect(
      queryReplyTemplate({ query_type: "month", month: "2026-09", monthIncome: 1, monthExpenses: 2, monthCount: 3 }),
    ).toContain("septiembre");
  });
});

function categoryResult(overrides: Partial<ExecutionResult>): ExecutionResult {
  return {
    intent: "create_category",
    ok: true,
    action: "created",
    amount: null,
    category: "Mascotas",
    note: null,
    ...overrides,
  };
}

describe("category command reply templates", () => {
  it("confirms a created category", () => {
    const text = categoryCommandReplyTemplate(categoryResult({ intent: "create_category", category: "Mascotas" }));

    expect(text).toBe('Categoría "Mascotas" creada.');
  });

  it("reports a duplicate on create", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "create_category", ok: false, error: "duplicate", category: "Mascotas", message: "already exists" }),
    );

    expect(text).toContain("Ya existe");
    expect(text).toContain("Mascotas");
  });

  it("confirms a deleted category", () => {
    const text = categoryCommandReplyTemplate(categoryResult({ intent: "delete_category", category: "Viajes" }));

    expect(text).toBe('Categoría "Viajes" borrada.');
  });

  it("reports a missing category on delete", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "delete_category", ok: false, error: "not_found", category: "Viajes", message: "not found" }),
    );

    expect(text).toContain("No existe");
  });

  it("refuses to delete the otro fallback", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "delete_category", ok: false, error: "otro_forbidden", category: "otro", message: "fallback" }),
    );

    expect(text).toContain("otro");
    expect(text).not.toContain("No existe");
  });

  it("confirms a rename with both names", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "rename_category", category: "Super", new_name: "Supermercado" }),
    );

    expect(text).toContain("Super");
    expect(text).toContain("Supermercado");
  });

  it("reports a duplicate on rename", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "rename_category", ok: false, error: "duplicate", category: "Super", new_name: "Supermercado", message: "already exists" }),
    );

    expect(text).toContain("Ya existe");
    expect(text).toContain("Supermercado");
  });

  it("falls back to the capabilities summary for the capabilities intent", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "capabilities", ok: true, action: "capabilities" }),
    );

    expect(text).toBe(capabilitiesSummaryReply());
  });
});