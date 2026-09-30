import { describe, expect, it } from "vitest";
import { resolveReservedConcept } from "./reserved";

describe("resolveReservedConcept", () => {
  it.each([
    ["provisorio", "previsto"],
    ["provisorios", "previsto"],
    ["gasto provisorio", "previsto"],
    ["gastos provisorios", "previsto"],
    ["provisto", "previsto"],
  ])("resolves the guard alias '%s' to %s (full-name or token-level check)", (input, concept) => {
    expect(resolveReservedConcept(input)).toBe(concept);
  });

  it.each([
    ["otro", "otro"],
    ["previsto", "previsto"],
    ["gastos fijos", "gasto fijo"],
    ["compartidos", "compartido"],
  ])("keeps full-name reserved concepts for '%s'", (input, concept) => {
    expect(resolveReservedConcept(input)).toBe(concept);
  });

  it("does NOT over-block: a name containing a real concept word stays creatable ('un otro gasto')", () => {
    // "otro" is a real reserved concept, not a guard-only alias: the token
    // check applies ONLY to misspelling aliases (provisto/provisorio), so a
    // legitimate owner category name containing "otro" is not blocked.
    expect(resolveReservedConcept("un otro gasto")).toBeNull();
  });

  it("returns null for a normal owner category name", () => {
    expect(resolveReservedConcept("Cafe")).toBeNull();
    expect(resolveReservedConcept("gastos hormiga")).toBeNull();
    expect(resolveReservedConcept("supermercado")).toBeNull();
  });
});