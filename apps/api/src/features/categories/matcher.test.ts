import { describe, expect, it } from "vitest";
import { firstSignificantWord, matchCategory, normalizeForMatch } from "./matcher";

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

describe("firstSignificantWord", () => {
  it("returns the first token containing a letter, skipping amount tokens", () => {
    expect(firstSignificantWord("$8000 super")).toBe("super");
  });

  it("returns null when no token contains a letter", () => {
    expect(firstSignificantWord("8000")).toBeNull();
  });

  it("returns the token itself when it mixes letters and digits", () => {
    expect(firstSignificantWord("pague en cafe2go")).toBe("pague");
  });

  it("handles leading whitespace", () => {
    expect(firstSignificantWord("  $500 uber viaje")).toBe("uber");
  });
});