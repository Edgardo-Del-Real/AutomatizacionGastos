import { describe, expect, it } from "vitest";
import {
  parseCommand,
  parseLegacyCategoryCrud,
  parseManualSavingsPayload,
  parseSavingsPercentInput,
  parseSetupBatchCommand,
  parseSharedContributionInput,
} from "./telegram.commands";

describe("parseCommand (D12 normalization)", () => {
  it("normalizes a leading slash on the menu command", () => {
    expect(parseCommand("/menu")).toEqual({ type: "menu" });
    expect(parseCommand("/start")).toEqual({ type: "start" });
  });

  it("normalizes underscores to spaces in slash commands", () => {
    expect(parseCommand("/listar_categorias")).toEqual({ type: "list" });
    expect(parseCommand("/configurar_categorias")).toEqual({ type: "configurar" });
  });

  it("normalizes a slash with underscores on the ayuda command", () => {
    expect(parseCommand("/ayuda")).toEqual({ type: "ayuda" });
  });

  it("keeps the bare text forms working after the normalization", () => {
    expect(parseCommand("menu")).toEqual({ type: "menu" });
    expect(parseCommand("ayuda")).toEqual({ type: "ayuda" });
    expect(parseCommand("listar categorias")).toEqual({ type: "list" });
  });

  it("falls through to null for an unrecognized slash command", () => {
    expect(parseCommand("/navegar")).toBeNull();
  });
});

describe("parseCommand", () => {
  it("is case-insensitive", () => {
    expect(parseCommand("listar categorias")).toEqual({ type: "list" });
  });

  it("parses 'listar categorias'", () => {
    expect(parseCommand("listar categorias")).toEqual({ type: "list" });
  });

  it("parses 'configurar categorias'", () => {
    expect(parseCommand("configurar categorias")).toEqual({ type: "configurar" });
  });

  it("parses 'registrar ahorro: palabra al X%' with the percent", () => {
    expect(parseCommand("registrar ahorro: entrenuts al 10%")).toEqual({
      type: "savings-rule",
      keyword: "entrenuts",
      percent: 10,
    });
  });

  it("recognizes the savings-rule command case-insensitively with accents", () => {
    expect(parseCommand("REGISTRAR AHORRO: Entrenuts al 5%")).toEqual({
      type: "savings-rule",
      keyword: "Entrenuts",
      percent: 5,
    });
  });

  it("returns a savings-rule-invalid command for an out-of-range percent (nothing is stored)", () => {
    expect(parseCommand("registrar ahorro: entrenuts al 0%")).toEqual({ type: "savings-rule-invalid" });
    expect(parseCommand("registrar ahorro: entrenuts al 150%")).toEqual({ type: "savings-rule-invalid" });
    expect(parseCommand("registrar ahorro: entrenuts al -3%")).toEqual({ type: "savings-rule-invalid" });
  });

  it("falls through to null for a plain registration", () => {
    expect(parseCommand("$2000 supermercado")).toBeNull();
  });

  it("falls through to null for an unrecognized command-like text", () => {
    expect(parseCommand("listar")).toBeNull();
    expect(parseCommand("registrar")).toBeNull();
  });

  it("falls through to null for empty name values", () => {
    expect(parseCommand("registrar categoria:")).toBeNull();
  });

  it("falls through to null for arbitrary text", () => {
    expect(parseCommand("hola que tal")).toBeNull();
  });
});

describe("parseCommand savings-rule management (D10)", () => {
  it("parses 'listar ahorros'", () => {
    expect(parseCommand("listar ahorros")).toEqual({ type: "savings-rule-list" });
  });

  it("normalizes a leading slash and underscores on the list command", () => {
    expect(parseCommand("/listar_ahorros")).toEqual({ type: "savings-rule-list" });
  });

  it("parses 'borrar ahorro: <palabra>' preserving the original spelling", () => {
    expect(parseCommand("borrar ahorro: Entrenuts")).toEqual({
      type: "savings-rule-delete",
      keyword: "Entrenuts",
    });
  });

  it("recognizes the delete command case-insensitively with accents", () => {
    expect(parseCommand("BORRAR AHORRO: suéldo")).toEqual({
      type: "savings-rule-delete",
      keyword: "suéldo",
    });
  });

  it("does not collide with 'borrar categoria:' (falls through)", () => {
    expect(parseCommand("borrar categoria: Salud")).toBeNull();
  });

  it("falls through to null for an empty keyword value", () => {
    expect(parseCommand("borrar ahorro:")).toBeNull();
  });
});

describe("parseSavingsPercentInput (D10: optional %, comma decimal, 0 < p <= 100)", () => {
  it("parses a plain integer percent", () => {
    expect(parseSavingsPercentInput("15")).toBe(15);
  });

  it("accepts an optional percent sign", () => {
    expect(parseSavingsPercentInput("15%")).toBe(15);
  });

  it("accepts a comma decimal separator", () => {
    expect(parseSavingsPercentInput("15,5")).toBe(15.5);
  });

  it("accepts a dot decimal separator", () => {
    expect(parseSavingsPercentInput("10.5%")).toBe(10.5);
  });

  it("accepts 100 as the inclusive upper bound", () => {
    expect(parseSavingsPercentInput("100")).toBe(100);
  });

  it("rejects 0 and 100+ as out of range", () => {
    expect(parseSavingsPercentInput("0")).toBeNull();
    expect(parseSavingsPercentInput("150")).toBeNull();
  });

  it("rejects negative percents", () => {
    expect(parseSavingsPercentInput("-5")).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parseSavingsPercentInput("quince")).toBeNull();
    expect(parseSavingsPercentInput("15abc")).toBeNull();
  });

  it("rejects an empty input", () => {
    expect(parseSavingsPercentInput("")).toBeNull();
  });

  it("accepts a numeric input value", () => {
    expect(parseSavingsPercentInput(15)).toBe(15);
  });
});

describe("parseSharedContributionInput (D4: es-AR percent-or-amount, 1..99)", () => {
  it("reads a percent suffix as a percent", () => {
    expect(parseSharedContributionInput("30%", 40000)).toBe(30);
  });

  it("reads a bare small number (<= 100) as a percent", () => {
    expect(parseSharedContributionInput("25", 40000)).toBe(25);
  });

  it("reads a comma-decimal bare number as a percent", () => {
    expect(parseSharedContributionInput("45,5", 40000)).toBe(45.5);
  });

  it("reads a bare large number as an amount and derives the percent", () => {
    expect(parseSharedContributionInput("30000", 40000)).toBe(75);
  });

  it("reads es-AR dotted thousands as an amount", () => {
    expect(parseSharedContributionInput("45.000", 90000)).toBe(50);
  });

  it("reads a $ currency-prefixed amount", () => {
    expect(parseSharedContributionInput("$45.000", 90000)).toBe(50);
  });

  it("reads an 'ars'-suffixed amount", () => {
    expect(parseSharedContributionInput("45.000 ars", 90000)).toBe(50);
  });

  it("rejects 100 percent", () => {
    expect(parseSharedContributionInput("100", 40000)).toBeNull();
    expect(parseSharedContributionInput("100%", 40000)).toBeNull();
  });

  it("rejects 0 and a value equal to the total (the owner keeps the whole bill)", () => {
    expect(parseSharedContributionInput("0", 40000)).toBeNull();
    expect(parseSharedContributionInput("40000", 40000)).toBeNull();
    expect(parseSharedContributionInput("=total", 40000)).toBeNull();
  });

  it("rejects non-numeric and negative input", () => {
    expect(parseSharedContributionInput("quince", 40000)).toBeNull();
    expect(parseSharedContributionInput("-5", 40000)).toBeNull();
    expect(parseSharedContributionInput("", 40000)).toBeNull();
  });
});

describe("parseCommand manual savings (D9)", () => {
  it("parses 'registrar ahorro manual: <monto>' with an amount only", () => {
    expect(parseCommand("registrar ahorro manual: 500")).toEqual({
      type: "manual-savings",
      amount: 500,
      note: null,
    });
  });

  it("parses the amount with an optional note preserving the original spelling", () => {
    expect(parseCommand("registrar ahorro manual: 500 Fondo Vacaciones")).toEqual({
      type: "manual-savings",
      amount: 500,
      note: "Fondo Vacaciones",
    });
    expect(parseCommand("REGISTRAR AHORRO MANUAL: 500 ahorro más para el viaje")).toEqual({
      type: "manual-savings",
      amount: 500,
      note: "ahorro más para el viaje",
    });
  });

  it("accepts es-AR dotted and comma thousands in the amount", () => {
    expect(parseCommand("registrar ahorro manual: 1.500 fondo")).toEqual({
      type: "manual-savings",
      amount: 1500,
      note: "fondo",
    });
    expect(parseCommand("registrar ahorro manual: 1,500 fondo")).toEqual({
      type: "manual-savings",
      amount: 1500,
      note: "fondo",
    });
  });

  it("normalizes the slash and underscore command form with a payload", () => {
    expect(parseCommand("/registrar_ahorro_manual: 500 fondo")).toEqual({
      type: "manual-savings",
      amount: 500,
      note: "fondo",
    });
  });

  it("returns manual-savings-invalid for a zero amount (nothing is stored)", () => {
    expect(parseCommand("registrar ahorro manual: 0")).toEqual({ type: "manual-savings-invalid" });
  });

  it("returns manual-savings-invalid for a non-numeric or empty payload", () => {
    expect(parseCommand("registrar ahorro manual: abc")).toEqual({ type: "manual-savings-invalid" });
    expect(parseCommand("registrar ahorro manual:")).toEqual({ type: "manual-savings-invalid" });
    expect(parseCommand("registrar ahorro manual:   ")).toEqual({ type: "manual-savings-invalid" });
  });

  it("rejects a non-first-token amount (the amount must lead the payload)", () => {
    expect(parseCommand("registrar ahorro manual: fondo 500")).toEqual({ type: "manual-savings-invalid" });
  });

  it("keeps the savings rule a rule: 'registrar ahorro: manual al 10%' is a rule with keyword manual (disjoint)", () => {
    expect(parseCommand("registrar ahorro: manual al 10%")).toEqual({
      type: "savings-rule",
      keyword: "manual",
      percent: 10,
    });
  });

  it("checks the manual command BEFORE the savings-rule regex (order pin)", () => {
    // "manual" sits between "ahorro" and ":" so the rule regex cannot match;
    // this is a manual savings ONLY because the manual branch runs first.
    expect(parseCommand("registrar ahorro manual: 500 al 10%")).toEqual({
      type: "manual-savings",
      amount: 500,
      note: "al 10%",
    });
  });
});

describe("parseManualSavingsPayload (D9 first-token amount)", () => {
  it("parses an amount-only payload", () => {
    expect(parseManualSavingsPayload("500")).toEqual({ amount: 500, note: null });
  });

  it("parses amount + note with normalized inner whitespace", () => {
    expect(parseManualSavingsPayload("500 fondo vacaciones")).toEqual({ amount: 500, note: "fondo vacaciones" });
    expect(parseManualSavingsPayload("500   fondo    vacaciones")).toEqual({ amount: 500, note: "fondo vacaciones" });
  });

  it("accepts dotted and comma thousands (parseNumberToken rules)", () => {
    expect(parseManualSavingsPayload("1.500 fondo")).toEqual({ amount: 1500, note: "fondo" });
    expect(parseManualSavingsPayload("1,500 fondo")).toEqual({ amount: 1500, note: "fondo" });
  });

  it("rejects decimals — uniform with captureParse (D9)", () => {
    expect(parseManualSavingsPayload("500.50")).toBeNull();
    expect(parseManualSavingsPayload("500,50")).toBeNull();
  });

  it("rejects zero, negatives, non-numeric and empty payloads", () => {
    expect(parseManualSavingsPayload("0")).toBeNull();
    expect(parseManualSavingsPayload("-5")).toBeNull();
    expect(parseManualSavingsPayload("abc")).toBeNull();
    expect(parseManualSavingsPayload("")).toBeNull();
    expect(parseManualSavingsPayload("   ")).toBeNull();
  });

  it("rejects a non-first-token amount", () => {
    expect(parseManualSavingsPayload("fondo 500")).toBeNull();
  });
});

describe("parseLegacyCategoryCrud (v2 detection-only)", () => {
  it("detects 'registrar categoria: X' as legacy CRUD", () => {
    expect(parseLegacyCategoryCrud("registrar categoria: Salud")).toEqual({ kind: "register" });
  });

  it("recognizes accented and case-insensitive create keywords", () => {
    expect(parseLegacyCategoryCrud("REGISTRAR CATEGORÍA: Café")).toEqual({ kind: "register" });
  });

  it("detects 'renombrar categoria: X a: Y' as legacy CRUD", () => {
    expect(parseLegacyCategoryCrud("renombrar categoria: Cafe a: Cafeteria")).toEqual({ kind: "rename" });
  });

  it("detects 'asociar palabra: P a categoria: X' as legacy CRUD", () => {
    expect(parseLegacyCategoryCrud("asociar palabra: uber a categoria: Transporte")).toEqual({ kind: "associate" });
  });

  it("returns null for the v2 savings-rule command", () => {
    expect(parseLegacyCategoryCrud("registrar ahorro: entrenuts al 10%")).toBeNull();
  });

  it("returns null for a v2 command", () => {
    expect(parseLegacyCategoryCrud("listar categorias")).toBeNull();
    expect(parseLegacyCategoryCrud("menu")).toBeNull();
  });

  it("returns null for an empty name value", () => {
    expect(parseLegacyCategoryCrud("registrar categoria:")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseLegacyCategoryCrud("$2000 supermercado")).toBeNull();
    expect(parseLegacyCategoryCrud("hola que tal")).toBeNull();
  });
});

describe("parseSetupBatchCommand", () => {
  it("classifies a plain name as a create entry", () => {
    expect(parseSetupBatchCommand("Cafe")).toEqual([{ kind: "create", name: "Cafe" }]);
  });

  it("classifies 'borrar categoria: X' as a delete entry preserving the original spelling", () => {
    expect(parseSetupBatchCommand("borrar categoria: No")).toEqual([{ kind: "delete", name: "No" }]);
  });

  it("recognizes accented and case-insensitive delete commands", () => {
    expect(parseSetupBatchCommand("BORRAR CATEGORÍA: no")).toEqual([{ kind: "delete", name: "no" }]);
  });

  it("classifies 'renombrar categoria: X a: Y' as a rename entry", () => {
    expect(parseSetupBatchCommand("renombrar categoria: Cafe a: Cafeteria")).toEqual([
      { kind: "rename", from: "Cafe", to: "Cafeteria" },
    ]);
  });

  it("folds 'registrar categoria: X' into a plain create entry", () => {
    expect(parseSetupBatchCommand("registrar categoria: Salud")).toEqual([{ kind: "create", name: "Salud" }]);
  });

  it("classifies a mixed comma/newline setup reply into ordered entries", () => {
    expect(parseSetupBatchCommand("Cafe\nborrar categoria: no, Salud")).toEqual([
      { kind: "create", name: "Cafe" },
      { kind: "delete", name: "no" },
      { kind: "create", name: "Salud" },
    ]);
  });

  it("drops empty tokens", () => {
    expect(parseSetupBatchCommand("  ,  \n ")).toEqual([]);
  });
});