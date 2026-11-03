import { describe, expect, it } from "vitest";

import { currentBaMonth, isMonthKey, monthToPeriod } from "./ba-month";

describe("currentBaMonth", () => {
  it("reads the Buenos Aires wall clock, not UTC", () => {
    // 2026-11-01T02:00:00Z is 2026-10-31 23:00 in Buenos Aires.
    expect(currentBaMonth(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10");
  });

  it("rolls over to the new month at 03:00 UTC", () => {
    expect(currentBaMonth(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });

  it("pads single-digit months", () => {
    expect(currentBaMonth(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
  });
});

describe("monthToPeriod", () => {
  it("returns the first and last day of a 31-day month", () => {
    expect(monthToPeriod("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("returns the first and last day of a 30-day month", () => {
    expect(monthToPeriod("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("returns February 28 in a common year", () => {
    expect(monthToPeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("returns February 29 in a leap year", () => {
    expect(monthToPeriod("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("round-trips every month of a year", () => {
    for (let month = 1; month <= 12; month += 1) {
      const key = `2026-${String(month).padStart(2, "0")}`;
      const period = monthToPeriod(key);
      expect(period.from).toBe(`${key}-01`);
      expect(period.to.startsWith(key)).toBe(true);
    }
  });
});

describe("isMonthKey", () => {
  it("accepts a valid key", () => {
    expect(isMonthKey("2026-11")).toBe(true);
  });

  it("rejects impossible or malformed keys", () => {
    for (const value of ["2026-13", "2026-00", "2026-1", "26-01", "2026-11-01", ""]) {
      expect(isMonthKey(value)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(isMonthKey(undefined)).toBe(false);
    expect(isMonthKey(202611)).toBe(false);
  });
});
