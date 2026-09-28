import { describe, expect, it, vi } from "vitest";
import type { CategoryService } from "../categories/categories.service";
import type { MovementService } from "../movements/movements.service";
import type { ViewerScope } from "../movements/movements.types";
import { deriveQueryType, QueryExecutor } from "./query-executor";

const ownerId = "default";
const scope: ViewerScope = { viewerId: ownerId, partnerId: "edgardo", visibility: "all" };

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
    expect(deriveQueryType("query", "savings")).toBe("savings");
    expect(deriveQueryType("query", "planned")).toBe("planned");
  });

  it("maps the legacy query_* intents without a query_type", () => {
    expect(deriveQueryType("query_recent", null)).toBe("recent");
    expect(deriveQueryType("query_balance", null)).toBe("balance");
    expect(deriveQueryType("query_month", null)).toBe("month");
    expect(deriveQueryType("query_planned", null)).toBe("planned");
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
      { id: "c1", ownerId, name: "Cafe", type: "NORMAL", createdAt: new Date(), keywords: ["cafe", "cafeteria"] },
      { id: "c2", ownerId, name: "otro", type: "NORMAL", createdAt: new Date(), keywords: [] },
    ]);

    const result = await executor.execute(scope, "categories");

    expect(mockListCategories).toHaveBeenCalledWith(scope.viewerId);
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

    const result = await executor.execute(scope, "recent");

    expect(mockListMovements).toHaveBeenCalledWith(scope, {});
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
        savings: 0,
        avgPerMonth: 1500,
        avgPerMovement: 500,
        maxAmount: 2000,
        count: 7,
        countThisMonth: 2,
      },
      mom: { months: [{ month: "2026-09", income: 1000, expenses: 500, balance: 500, savings: 0 }] },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
      planned: { month: "2026-09", total: 0 },
    });

    const result = await executor.execute(scope, "balance");

    expect(mockGetSummary).toHaveBeenCalledWith(scope);
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
        savings: 0,
        avgPerMonth: 1500,
        avgPerMovement: 500,
        maxAmount: 2000,
        count: 7,
        countThisMonth: 3,
      },
      mom: {
        months: [
          { month: "2026-08", income: 1500, expenses: 800, balance: 700, savings: 0 },
          { month: "2026-09", income: 2500, expenses: 1200, balance: 1300, savings: 0 },
        ],
      },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
      planned: { month: "2026-09", total: 0 },
    });

    const result = await executor.execute(scope, "month");

    expect(mockGetSummary).toHaveBeenCalledWith(scope);
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
        savings: 0,
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
      planned: { month: "2026-09", total: 0 },
    });

    const result = await executor.execute(scope, "month");

    expect(result).toEqual({
      query_type: "month",
      month: "",
      monthIncome: 0,
      monthExpenses: 0,
      monthCount: 0,
    });
  });

  it("answers the month-savings query from the current-month kpis.savings and the last month bucket", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue({
      kpis: {
        income: 0,
        expenses: 0,
        balance: 0,
        savings: 150,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 0,
        count: 0,
        countThisMonth: 0,
      },
      mom: {
        months: [
          { month: "2026-08", income: 0, expenses: 0, balance: 0, savings: 200 },
          { month: "2026-09", income: 0, expenses: 0, balance: 0, savings: 150 },
        ],
      },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
      planned: { month: "2026-09", total: 0 },
    });

    const result = await executor.execute(scope, "savings");

    expect(mockGetSummary).toHaveBeenCalledWith(scope);
    expect(result).toEqual({
      query_type: "savings",
      month: "2026-09",
      savings: 150,
    });
  });

  it("answers the planned query from the summary planned block (real data)", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue({
      kpis: {
        income: 0,
        expenses: 0,
        balance: 0,
        savings: 0,
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
      planned: { month: "2026-10", total: 4000 },
    });

    const result = await executor.execute(scope, "planned");

    expect(mockGetSummary).toHaveBeenCalledWith(scope);
    expect(result).toEqual({
      query_type: "planned",
      month: "2026-10",
      total: 4000,
    });
  });

  it("answers zero for the planned query when no PENDING expense targets next month", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue({
      kpis: {
        income: 0,
        expenses: 0,
        balance: 0,
        savings: 0,
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
      planned: { month: "2026-10", total: 0 },
    });

    const result = await executor.execute(scope, "planned");

    expect(result).toEqual({ query_type: "planned", month: "2026-10", total: 0 });
  });

  it("omits PENDING movements from the recent list", async () => {
    const { executor, mockListMovements } = makeHarness();
    mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "alquiler",
        occurredAt: new Date("2026-09-18T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
        status: "PAID",
      },
      {
        id: "m2",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "alquiler",
        occurredAt: new Date("2026-09-17T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
        status: "PENDING",
      },
      {
        id: "m3",
        ownerId,
        amount: 900,
        currency: "ARS",
        category: null,
        note: null,
        occurredAt: new Date("2026-09-16T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
        status: "PAID",
      },
    ]);

    const result = await executor.execute(scope, "recent");

    expect(mockListMovements).toHaveBeenCalledWith(scope, {});
    expect(result.query_type).toBe("recent");
    if (result.query_type !== "recent") return;
    expect(result.movements.map((movement) => movement.amount)).toEqual([2500, 900]);
    // The PENDING row (occurredAt 2026-09-17) is filtered out; the PAID 2500 (2026-09-18) stays.
    expect(result.movements.some((movement) => movement.date === "2026-09-17")).toBe(false);
    expect(result.movements.some((movement) => movement.date === "2026-09-18")).toBe(true);
  });
});