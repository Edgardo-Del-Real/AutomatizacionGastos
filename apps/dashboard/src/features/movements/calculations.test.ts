import { describe, expect, it } from "vitest";

import {
  accumulateBalances,
  categoryPieSlices,
} from "./calculations";

describe("accumulateBalances", () => {
  it("returns the progressive sum of the daily balances", () => {
    const daily = [
      { day: "2026-07-01", income: 100, expenses: 50, balance: 100 },
      { day: "2026-07-02", income: 0, expenses: 0, balance: 200 },
      { day: "2026-07-03", income: 0, expenses: 0, balance: 300 },
    ];
    expect(accumulateBalances(daily)).toEqual([
      { day: "2026-07-01", accumulated: 100 },
      { day: "2026-07-02", accumulated: 300 },
      { day: "2026-07-03", accumulated: 600 },
    ]);
  });

  it("accrues negative balances correctly", () => {
    const daily = [
      { day: "2026-07-01", income: 0, expenses: 0, balance: 100 },
      { day: "2026-07-02", income: 0, expenses: 0, balance: -50 },
    ];
    expect(accumulateBalances(daily)).toEqual([
      { day: "2026-07-01", accumulated: 100 },
      { day: "2026-07-02", accumulated: 50 },
    ]);
  });

  it("returns an empty series for an empty daily list", () => {
    expect(accumulateBalances([])).toEqual([]);
  });
});

describe("categoryPieSlices", () => {
  const kpis = { income: 3000, balance: 1500 };
  const categories = [
    { name: "comida", expenseAmount: 900 },
    { name: "transporte", expenseAmount: 600 },
    { name: "sin gastos", expenseAmount: 0 },
  ];

  it("orders spending slices by amount descending and appends Disponible", () => {
    const slices = categoryPieSlices(kpis, categories);

    expect(slices.map((slice) => slice.name)).toEqual([
      "comida",
      "transporte",
      "Disponible",
    ]);
  });

  it("makes the slice amounts add up to the total income", () => {
    const slices = categoryPieSlices(kpis, categories);

    expect(slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(
      kpis.income,
    );
  });

  it("drops categories without spending", () => {
    const slices = categoryPieSlices(kpis, categories);

    expect(slices.some((slice) => slice.name === "sin gastos")).toBe(false);
  });

  it("omits Disponible when the balance is not positive", () => {
    const slices = categoryPieSlices({ income: 1500, balance: 0 }, categories);

    expect(slices.map((slice) => slice.name)).toEqual(["comida", "transporte"]);
  });

  it("returns no slices when there is no income", () => {
    expect(categoryPieSlices({ income: 0, balance: 0 }, [])).toEqual([]);
  });
});