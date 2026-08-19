import { describe, expect, it } from "vitest";

import { dailyAverage, momPercent } from "./calculations";

describe("momPercent", () => {
  it("returns a positive percentage when the current month grows", () => {
    expect(momPercent(1000, 1500)).toBe(50);
  });

  it("returns a negative percentage when the current month shrinks", () => {
    expect(momPercent(1000, 500)).toBe(-50);
  });

  it("returns 100 when growing from a zero previous month", () => {
    expect(momPercent(0, 500)).toBe(100);
  });

  it("returns 0 when both months are zero", () => {
    expect(momPercent(0, 0)).toBe(0);
  });

  it("returns 0 when the balance is unchanged", () => {
    expect(momPercent(500, 500)).toBe(0);
  });
});

describe("dailyAverage", () => {
  it("returns the mean balance across the daily series", () => {
    const daily = [
      { day: "2026-07-01", income: 100, expenses: 50, balance: 100 },
      { day: "2026-07-02", income: 0, expenses: 0, balance: 200 },
      { day: "2026-07-03", income: 0, expenses: 0, balance: 300 },
    ];
    expect(dailyAverage(daily)).toBe(200);
  });

  it("averages negative balances correctly", () => {
    const daily = [
      { day: "2026-07-01", income: 0, expenses: 0, balance: 100 },
      { day: "2026-07-02", income: 0, expenses: 0, balance: -50 },
    ];
    expect(dailyAverage(daily)).toBe(25);
  });

  it("returns 0 for an empty series", () => {
    expect(dailyAverage([])).toBe(0);
  });
});
