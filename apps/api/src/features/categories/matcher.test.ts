import { describe, expect, it } from "vitest";
import {
  foldSpanishPluralToken,
  matchCategory,
  normalizeForMatch,
  normalizeForMatchGuard,
  normalizeForMatchTolerant,
} from "./matcher";

const createdAt = (iso: string): Date => new Date(iso);

describe("normalizeForMatch", () => {
  it("lowercases and accent-folds a value, preserving length", () => {
    const input = "Café";
    const result = normalizeForMatch(input);

    expect(result).toBe("cafe");
    expect(result.length).toBe(input.length);
  });

  it("folds multiple accented characters", () => {
    expect(normalizeForMatch("Categoría Ágil Ünïcórnio")).toBe("categoria agil unicornio");
  });

  it("leaves already-normalized text unchanged", () => {
    expect(normalizeForMatch("transporte")).toBe("transporte");
  });
});

describe("matchCategory", () => {
  const cafeRule = { keyword: "cafe", category: "Cafe", createdAt: createdAt("2026-09-01T10:00:00Z") };

  it("matches a keyword inside a note with word boundaries", () => {
    expect(matchCategory("tostado y cafe con leche", [cafeRule])).toBe("Cafe");
  });

  it("is diacritic-insensitive: accented note matches plain keyword", () => {
    expect(matchCategory("tostado y café con leche", [cafeRule])).toBe("Cafe");
  });

  it("does NOT match inside a larger word (cafe2go)", () => {
    expect(matchCategory("pague $500 en cafe2go", [cafeRule])).toBeNull();
  });

  it("does NOT match when the keyword is a suffix of a longer word", () => {
    expect(matchCategory("cafeteria abierta", [cafeRule])).toBeNull();
  });

  it("returns null when no rule matches", () => {
    expect(matchCategory("pague $500 en la farmacia", [cafeRule])).toBeNull();
  });

  it("oldest-learned rule wins when a note contains both keywords (D4)", () => {
    const transporte = { keyword: "transporte", category: "Transporte", createdAt: createdAt("2026-09-01T10:00:00Z") };
    const sube = { keyword: "sube", category: "Sube", createdAt: createdAt("2026-09-02T10:00:00Z") };

    expect(matchCategory("viaje en sube y transporte", [transporte, sube])).toBe("Transporte");
    expect(matchCategory("viaje en sube y transporte", [sube, transporte])).toBe("Transporte");
  });

  it("ties on createdAt are broken by keyword ascending", () => {
    const aaa = { keyword: "aaa", category: "A", createdAt: createdAt("2026-09-01T10:00:00Z") };
    const zzz = { keyword: "zzz", category: "Z", createdAt: createdAt("2026-09-01T10:00:00Z") };

    expect(matchCategory("zzz y aaa", [zzz, aaa])).toBe("A");
  });
});

describe("foldSpanishPluralToken", () => {
  it.each([
    ["meses", "mes"],
    ["gases", "gas"],
    ["toses", "tos"],
    ["reses", "res"],
  ])("folds -ses plurals onto their short singular (%s → %s)", (input, expected) => {
    expect(foldSpanishPluralToken(input)).toBe(expected);
  });

  it.each([
    ["cafes", "cafe"],
    ["casas", "casa"],
    ["libros", "libro"],
  ])("folds vowel+s plurals by stripping the s, never -es (%s → %s)", (input, expected) => {
    expect(foldSpanishPluralToken(input)).toBe(expected);
  });

  it("folds luces to luz through the -ces rule", () => {
    expect(foldSpanishPluralToken("luces")).toBe("luz");
    expect(foldSpanishPluralToken("voces")).toBe("voz");
  });

  it("folds jerseis to jersey through the -is→-y rule", () => {
    expect(foldSpanishPluralToken("jerseis")).toBe("jersey");
  });

  it("folds pies to pie and never folds the 3-letter singular mes", () => {
    expect(foldSpanishPluralToken("pies")).toBe("pie");
    expect(foldSpanishPluralToken("mes")).toBe("mes");
  });

  it.each([
    ["lunes", "lunes"],
    ["crisis", "crisis"],
    ["frances", "frances"],
    ["pais", "pais"],
    ["dios", "dios"],
  ])("leaves excluded words unchanged (%s)", (input, expected) => {
    expect(foldSpanishPluralToken(input)).toBe(expected);
  });

  it("folds the brand entrenuts to entrenut (self-consistent folding)", () => {
    expect(foldSpanishPluralToken("entrenuts")).toBe("entrenut");
  });

  it("folds multi-token phrases per token", () => {
    expect(normalizeForMatchTolerant("gastos fijos")).toBe("gasto fijo");
    expect(normalizeForMatchTolerant("gastos fijo")).toBe("gasto fijo");
  });
});

describe("matchCategory tolerant folding", () => {
  it("matches a plural note against a singular keyword (gastos fijos ↔ gasto fijo)", () => {
    const rule = { keyword: "gasto fijo", category: "Gasto Fijo", createdAt: createdAt("2026-09-01T10:00:00Z") };

    expect(matchCategory("gastos fijos en el super", [rule])).toBe("Gasto Fijo");
  });

  it("matches a singular note against a plural keyword", () => {
    const rule = { keyword: "gastos fijos", category: "Gasto Fijo", createdAt: createdAt("2026-09-01T10:00:00Z") };

    expect(matchCategory("gasto fijo en el super", [rule])).toBe("Gasto Fijo");
  });

  it("folds single-token plurals: cafes matches the cafe keyword (never caf)", () => {
    const rule = { keyword: "cafe", category: "Cafe", createdAt: createdAt("2026-09-01T10:00:00Z") };

    expect(matchCategory("cafes", [rule])).toBe("Cafe");
    expect(matchCategory("meses", [{ keyword: "mes", category: "Mes", createdAt: createdAt("2026-09-01T10:00:00Z") }])).toBe("Mes");
  });

  it("still does NOT match inside a larger word after folding (cafe2go)", () => {
    const rule = { keyword: "cafe", category: "Cafe", createdAt: createdAt("2026-09-01T10:00:00Z") };

    expect(matchCategory("pague $500 en cafe2go", [rule])).toBeNull();
    expect(matchCategory("cafeteria abierta", [rule])).toBeNull();
  });

  it("leaves excluded words unmatched (lunes never folds onto lun)", () => {
    const rule = { keyword: "lun", category: "Lun", createdAt: createdAt("2026-09-01T10:00:00Z") };

    expect(matchCategory("fue el lunes", [rule])).toBeNull();
  });
});

describe("normalizeForMatchGuard", () => {
  it("strips punctuation from guard words ('no.', 'si.', 'no,' -> 'no'/'si'/'no')", () => {
    expect(normalizeForMatchGuard("no.")).toBe("no");
    expect(normalizeForMatchGuard("si.")).toBe("si");
    expect(normalizeForMatchGuard("no,")).toBe("no");
  });

  it("collapses whitespace runs to single spaces", () => {
    expect(normalizeForMatchGuard("dale   dale")).toBe("dale dale");
  });

  it("strips punctuation from multi-word guard phrases ('no, dejalo' -> 'no dejalo')", () => {
    expect(normalizeForMatchGuard("no, dejalo")).toBe("no dejalo");
  });

  it("accents fold before punctuation stripping ('sí.' -> 'si')", () => {
    expect(normalizeForMatchGuard("sí.")).toBe("si");
  });

  it("normalizes a punctuation-only answer to empty", () => {
    expect(normalizeForMatchGuard("...")).toBe("");
  });

  it("keeps normalizeForMatch byte-identical: length-preserving contract unchanged", () => {
    const input = "No, lo dejo!";
    expect(normalizeForMatch(input)).toBe("no, lo dejo!");
    expect(normalizeForMatch(input).length).toBe(input.length);
  });
});