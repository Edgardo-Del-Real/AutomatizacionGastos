import { describe, expect, it } from "vitest";
import {
  categoryCreatedReply,
  categoryErrorReply,
  categoryListReply,
  categoryRenamedReply,
  correctionDoneReply,
  correctionQuestionReply,
  duplicateCategoryReply,
  formatARS,
  helpReply,
  keywordAssociatedReply,
  missingCategoryReply,
  movementMissingReply,
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

  it("builds the correction question with the pending note", () => {
    expect(correctionQuestionReply("uber viaje")).toContain("uber viaje");
  });

  it("builds the correction done confirmation", () => {
    expect(correctionDoneReply("Transporte")).toContain("Transporte");
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