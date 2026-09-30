import { describe, expect, it } from "vitest";
import { parseCommand, parseSetupBatchCommand } from "./telegram.commands";

describe("parseCommand", () => {
  it("parses 'registrar categoria: X' preserving the original spelling", () => {
    expect(parseCommand("registrar categoria: Salud")).toEqual({
      type: "register",
      name: "Salud",
    });
  });

  it("recognizes accented command keywords ('categoría')", () => {
    expect(parseCommand("registrar categoría: Café")).toEqual({
      type: "register",
      name: "Café",
    });
  });

  it("is case-insensitive", () => {
    expect(parseCommand("REGISTRAR CATEGORIA: Salud")).toEqual({
      type: "register",
      name: "Salud",
    });
  });

  it("parses 'renombrar categoria: X a: Y'", () => {
    expect(parseCommand("renombrar categoria: Cafe a: Cafeteria")).toEqual({
      type: "rename",
      from: "Cafe",
      to: "Cafeteria",
    });
  });

  it("parses 'asociar palabra: P a categoria: X'", () => {
    expect(parseCommand("asociar palabra: uber a categoria: Transporte")).toEqual({
      type: "associate",
      keyword: "uber",
      category: "Transporte",
    });
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

  it("falls through to null for an empty name value", () => {
    expect(parseCommand("registrar categoria:")).toBeNull();
  });

  it("falls through to null for arbitrary text", () => {
    expect(parseCommand("hola que tal")).toBeNull();
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