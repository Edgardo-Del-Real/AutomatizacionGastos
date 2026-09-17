import { describe, expect, it } from "vitest";
import { isMilStance } from "./mil-stance";

describe("isMilStance", () => {
  it.each([
    ["gaste 5 mil en el super", 5, true],
    ["5mil super", 5, true],
    ["2k cafe", 2, true],
    ["15 mil de nafta", 15, true],
    ["500 mil", 500, true],
    ["5 MIL", 5, true],
    ["gaste 5 en el kiosco", 5, false],
    ["cafe 2500", 2500, false],
    ["gaste 2500, mil gracias", 2500, false],
    ["gaste 5 mil en el super", null, false],
  ])("detects the mil stance for %s with deterministic amount %s", (body, deterministicAmount, expected) => {
    expect(isMilStance(body, deterministicAmount)).toBe(expected);
  });
});