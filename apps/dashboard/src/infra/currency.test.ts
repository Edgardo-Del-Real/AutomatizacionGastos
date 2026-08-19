import { describe, expect, it } from "vitest";

import { formatARS } from "./currency";

// es-AR currency format uses a non-breaking space (U+00A0) between the "$" sign
// and the number, and a comma as the decimal separator: "$ 1.500,00".
describe("formatARS", () => {
  it("formats a whole-number amount with es-AR currency style", () => {
    expect(formatARS(1500)).toBe("$\u00A01.500,00");
  });

  it("formats zero as es-AR currency", () => {
    expect(formatARS(0)).toBe("$\u00A00,00");
  });

  it("formats a large amount with thousands separators and decimals", () => {
    expect(formatARS(1234567.89)).toBe("$\u00A01.234.567,89");
  });

  it("formats a fractional amount with two decimal places", () => {
    expect(formatARS(1200.5)).toBe("$\u00A01.200,50");
  });

  it("formats a negative amount with a leading minus sign", () => {
    expect(formatARS(-250)).toBe("-$\u00A0250,00");
  });
});
