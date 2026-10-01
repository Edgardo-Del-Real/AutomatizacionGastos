import { describe, expect, it } from "vitest";
import { parseCommand, parseLegacyCategoryCrud, parseSetupBatchCommand } from "./telegram.commands";

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