import { describe, expect, it } from "vitest";

import type { Expense } from "@rita/contracts";

import { filterExpenses } from "./filterExpenses";
import type { Filters } from "./filterExpenses";

const base = {
  ownerId: "default",
  currency: "ARS",
  note: null,
  createdAt: new Date("2026-03-01T00:00:00Z"),
};

const expenses: Expense[] = [
  {
    ...base,
    id: "e1",
    amount: 500,
    category: "food",
    occurredAt: new Date("2026-03-10T12:00:00Z"),
  },
  {
    ...base,
    id: "e2",
    amount: 250,
    category: null,
    occurredAt: new Date("2026-03-11T12:00:00Z"),
  },
  {
    ...base,
    id: "e3",
    amount: 100,
    category: "food",
    occurredAt: new Date("2026-02-05T12:00:00Z"),
  },
  {
    ...base,
    id: "e4",
    amount: 300,
    category: "transport",
    occurredAt: new Date("2026-02-20T12:00:00Z"),
  },
];

describe("filterExpenses", () => {
  it("returns the full list unchanged when no filters are set (reset)", () => {
    const filters: Filters = {};

    const result = filterExpenses(expenses, filters);

    expect(result).toEqual(expenses);
  });

  it("filters by month derived from occurredAt as YYYY-MM", () => {
    const result = filterExpenses(expenses, { month: "2026-03" });

    expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("filters by category", () => {
    const result = filterExpenses(expenses, { category: "food" });

    expect(result.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("applies month and category together (AND) when both are set", () => {
    const result = filterExpenses(expenses, {
      month: "2026-02",
      category: "food",
    });

    expect(result.map((e) => e.id)).toEqual(["e3"]);
  });

  it("returns an empty array when the filters match no expenses", () => {
    const result = filterExpenses(expenses, { month: "2026-01" });
    const resultCategory = filterExpenses(expenses, { category: "rent" });

    expect(result).toEqual([]);
    expect(resultCategory).toEqual([]);
  });

  it("treats an empty-string month or category as unset", () => {
    const result = filterExpenses(expenses, { month: "", category: "food" });

    expect(result.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("does not mutate the input list", () => {
    const original = expenses.map((e) => e.id);

    filterExpenses(expenses, { month: "2026-02", category: "transport" });

    expect(expenses.map((e) => e.id)).toEqual(original);
  });
});