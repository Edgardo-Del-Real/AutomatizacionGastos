import { describe, expect, it } from "vitest";
import { parseCommand } from "./telegram.commands";

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