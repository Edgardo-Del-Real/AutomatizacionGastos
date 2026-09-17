import { describe, expect, it, vi } from "vitest";
import type { CategoryService } from "../categories/categories.service";
import type { MovementService } from "../movements/movements.service";
import { deriveQueryType, QueryExecutor } from "./query-executor";

const ownerId = "default";

function makeHarness() {
  const movementService = {
    listMovements: vi.fn(async () => []),
    getSummary: vi.fn(),
  } as unknown as MovementService;
  const categoryService = {
    listCategories: vi.fn(async () => []),
  } as unknown as CategoryService;
  const executor = new QueryExecutor(movementService, categoryService);
  return {
    executor,
    movementService,
    categoryService,
    mockListMovements: vi.mocked(movementService.listMovements),
    mockGetSummary: vi.mocked(movementService.getSummary),
    mockListCategories: vi.mocked(categoryService.listCategories),
  };
}

describe("deriveQueryType", () => {
  it("maps the query intent from its query_type", () => {
    expect(deriveQueryType("query", "categories")).toBe("categories");
    expect(deriveQueryType("query", "recent")).toBe("recent");
    expect(deriveQueryType("query", "balance")).toBe("balance");
    expect(deriveQueryType("query", "month")).toBe("month");
  });

  it("maps the legacy query_* intents without a query_type", () => {
    expect(deriveQueryType("query_recent", null)).toBe("recent");
    expect(deriveQueryType("query_balance", null)).toBe("balance");
    expect(deriveQueryType("query_month", null)).toBe("month");
  });

  it("returns null for a query intent without a query_type and for non-query intents", () => {
    expect(deriveQueryType("query", null)).toBeNull();
    expect(deriveQueryType("register_expense", null)).toBeNull();
    expect(deriveQueryType("off_topic", null)).toBeNull();
  });
});

describe("QueryExecutor.execute", () => {
  it("returns the owner categories with their keywords", async () => {
    const { executor, mockListCategories } = makeHarness();
    mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: ["cafe", "cafeteria"] },
      { id: "c2", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    const result = await executor.execute(ownerId, "categories");

    expect(mockListCategories).toHaveBeenCalledWith(ownerId);
    expect(result).toEqual({
      query_type: "categories",
      categories: [
        { name: "Cafe", keywords: ["cafe", "cafeteria"] },
        { name: "otro", keywords: [] },
      ],
    });
  });

  it("returns the N most recent movements with amount, category, note, date and type", async () => {
    const { executor, mockListMovements } = makeHarness();
    const movements = Array.from({ length: 7 }, (_, index) => ({
      id: `m${index}`,
      ownerId,
      amount: 100 + index,
      currency: "ARS",
      category: index % 2 === 0 ? "Cafe" : null,
      note: index % 2 === 0 ? "cafe" : null,
      occurredAt: new Date(`2026-09-${String(17 - index).padStart(2, "0")}T12:00:00.000Z`),
      createdAt: new Date(),
      type: index === 1 ? ("INCOME" as const) : ("EXPENSE" as const),
    }));
    mockListMovements.mockResolvedValue(movements);

    const result = await executor.execute(ownerId, "recent");

    expect(mockListMovements).toHaveBeenCalledWith(ownerId, {});
    expect(result.query_type).toBe("recent");
    if (result.query_type !== "recent") return;
    expect(result.movements).toHaveLength(5);
    expect(result.movements[0]).toEqual({
      amount: 100,
      category: "Cafe",
      note: "cafe",
      date: "2026-09-17",
      type: "EXPENSE",
    });
    expect(result.movements[1]).toEqual({
      amount: 101,
      category: null,
      note: null,
      date: "2026-09-16",
      type: "INCOME",
    });
  });

  it("returns the all-time balance from the summary kpis", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue({
      kpis: {
        income: 5000,
        expenses: 2000,
        balance: 3000,
        avgPerMonth: 1500,
        avgPerMovement: 500,
        maxAmount: 2000,
        count: 7,
        countThisMonth: 2,
      },
      mom: { months: [{ month: "2026-09", income: 1000, expenses: 500, balance: 500 }] },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
    });

    const result = await executor.execute(ownerId, "balance");

    expect(mockGetSummary).toHaveBeenCalledWith(ownerId);
    expect(result).toEqual({
      query_type: "balance",
      balance: 3000,
      income: 5000,
      expenses: 2000,
    });
  });

  it("returns the current-month totals and movement count from the summary", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue({
      kpis: {
        income: 5000,
        expenses: 2000,
        balance: 3000,
        avgPerMonth: 1500,
        avgPerMovement: 500,
        maxAmount: 2000,
        count: 7,
        countThisMonth: 3,
      },
      mom: {
        months: [
          { month: "2026-08", income: 1500, expenses: 800, balance: 700 },
          { month: "2026-09", income: 2500, expenses: 1200, balance: 1300 },
        ],
      },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
    });

    const result = await executor.execute(ownerId, "month");

    expect(mockGetSummary).toHaveBeenCalledWith(ownerId);
    expect(result).toEqual({
      query_type: "month",
      month: "2026-09",
      monthIncome: 2500,
      monthExpenses: 1200,
      monthCount: 3,
    });
  });

  it("defaults the month bucket to zeros when the summary has no current-month bucket", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue({
      kpis: {
        income: 0,
        expenses: 0,
        balance: 0,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 0,
        count: 0,
        countThisMonth: 0,
      },
      mom: { months: [] },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
    });

    const result = await executor.execute(ownerId, "month");

    expect(result).toEqual({
      query_type: "month",
      month: "",
      monthIncome: 0,
      monthExpenses: 0,
      monthCount: 0,
    });
  });
});