import { describe, expect, it } from "vitest";
import { classifyMovementType, extractNote, parseAmount, parseAmountAndNote } from "./message.parser";

describe("parseAmount", () => {
  it("parses a plain integer amount", () => {
    expect(parseAmount("café 2500")).toBe(2500);
  });

  it("parses an amount with dot thousands separators", () => {
    expect(parseAmount("café 2.500")).toBe(2500);
  });

  it("parses an amount with comma thousands separators", () => {
    expect(parseAmount("café 2,500")).toBe(2500);
  });

  it("ignores currency symbols and letters", () => {
    expect(parseAmount("$ 2.500 pesos")).toBe(2500);
  });

  it("returns the last number-like token when there are several", () => {
    expect(parseAmount("ayer gasté 100 y hoy 300")).toBe(300);
  });

  it("returns null when no number is present", () => {
    expect(parseAmount("hola")).toBeNull();
  });

  it("returns null for an empty body", () => {
    expect(parseAmount("")).toBeNull();
  });
});

describe("extractNote", () => {
  it("strips the amount token and trims the remaining text", () => {
    expect(extractNote("café 2.500")).toBe("café");
  });

  it("collapses whitespace left by the removed token", () => {
    expect(extractNote("compré pan 1200 ayer")).toBe("compré pan ayer");
  });

  it("returns null when the body is only an amount", () => {
    expect(extractNote("2.500")).toBeNull();
  });
});

describe("parseAmountAndNote", () => {
  it("returns the amount and the note", () => {
    expect(parseAmountAndNote("café 2.500")).toEqual({ amount: 2500, note: "café" });
  });

  it("returns null when there is no amount", () => {
    expect(parseAmountAndNote("solo texto")).toBeNull();
  });
});

describe("classifyMovementType", () => {
  it("classifies a message with an income keyword as INCOME", () => {
    expect(classifyMovementType("Recibí $50000 de sueldo")).toBe("INCOME");
  });

  it("classifies a message with an income keyword case-insensitively", () => {
    expect(classifyMovementType("VENTA de auto 50000")).toBe("INCOME");
  });

  it("classifies a plus-prefixed amount as INCOME even without a keyword", () => {
    expect(classifyMovementType("+5000")).toBe("INCOME");
  });

  it("defaults a plain expense message to EXPENSE", () => {
    expect(classifyMovementType("$2000 supermercado")).toBe("EXPENSE");
  });

  it("is conservative and does not match a keyword inside another word", () => {
    expect(classifyMovementType("compré 3000 en inventario")).toBe("EXPENSE");
  });

  it("is conservative and defaults a message with money but no income signal to EXPENSE", () => {
    expect(classifyMovementType("transferencia 800")).toBe("EXPENSE");
  });

  it("classifies an income keyword that appears after a space as INCOME", () => {
    expect(classifyMovementType("Recibi 5000 de sueldo")).toBe("INCOME");
  });

  it("classifies an income keyword in the middle of the message as INCOME", () => {
    expect(classifyMovementType("ayer cobro 8000")).toBe("INCOME");
  });

  it("does not match a keyword that is a prefix of another word", () => {
    expect(classifyMovementType("sueldos 5000")).toBe("EXPENSE");
  });
});