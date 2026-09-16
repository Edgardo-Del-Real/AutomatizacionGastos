import { describe, expect, it } from "vitest";
import { matchCategory, normalizeForMatch, significantKeywords } from "./matcher";

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

describe("significantKeywords", () => {
  it("prefers the LAST significant words, skipping stopwords and short tokens", () => {
    expect(significantKeywords("compre un cafe en el kiosco")).toEqual(["cafe", "kiosco"]);
  });

  it("normalizes and dedupes keywords, keeping the last occurrence", () => {
    expect(significantKeywords("compré Café")).toEqual(["cafe"]);
    expect(significantKeywords("cafe transporte cafe")).toEqual(["transporte", "cafe"]);
  });

  it("returns an empty list when no significant token remains", () => {
    expect(significantKeywords("8000")).toEqual([]);
    expect(significantKeywords("compre el pan hoy")).toEqual(["pan"]);
  });

  it("respects the max keyword count, keeping the trailing ones", () => {
    expect(significantKeywords("compre un cafe en el kiosco", 1)).toEqual(["kiosco"]);
  });

  it("drops tokens without letters and keeps mixed alphanumeric tokens", () => {
    expect(significantKeywords("pague en cafe2go")).toEqual(["cafe2go"]);
    expect(significantKeywords("  $500 uber viaje")).toEqual(["uber", "viaje"]);
  });
});