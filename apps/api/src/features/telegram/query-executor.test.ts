import { describe, expect, it, vi } from "vitest";
import type { CategoryService } from "../categories/categories.service";
import { currentBaMonth } from "../movements/ba-month";
import type { MovementService } from "../movements/movements.service";
import type { ViewerScope } from "../movements/movements.types";
import { deriveQueryType, QueryExecutor } from "./query-executor";

const ownerId = "default";
const scope: ViewerScope = { viewerId: ownerId, partnerId: "edgardo", visibility: "all" };

function summaryFixture(
  overrides: {
    kpis?: Partial<Awaited<ReturnType<MovementService["getSummary"]>>["kpis"]>;
    planned?: Awaited<ReturnType<MovementService["getSummary"]>>["planned"];
  } = {},
): Awaited<ReturnType<MovementService["getSummary"]>> {
  return {
    kpis: {
      income: 0,
      expenses: 0,
      balance: 0,
      savings: 0,
      manualSavings: 0,
      avgPerMonth: 0,
      avgPerMovement: 0,
      maxAmount: 0,
      count: 0,
      ...overrides.kpis,
    },
    daily: [],
    categories: [],
    top: { expenses: [], income: [] },
    planned: overrides.planned ?? { total: 0, movements: [] },
  };
}

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

  it("scopes the balance to the current Buenos Aires month", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue(
      summaryFixture({
        kpis: { income: 5000, expenses: 2000, balance: 3000, count: 7 },
      }),
    );

    const result = await executor.execute(scope, "balance");

    // RULE: the bot answers about the current month only; past periods belong
    // to the dashboard. A lifetime scope used to disagree with it.
    expect(mockGetSummary).toHaveBeenCalledWith(scope, currentBaMonth());
    expect(result).toEqual({
      query_type: "balance",
      month: currentBaMonth(),
      balance: 3000,
      income: 5000,
      expenses: 2000,
    });
  });

  it("asks for the current Buenos Aires month and reports its totals", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue(
      summaryFixture({
        // With a month-scoped summary the kpis ARE that month's numbers; the
        // old mom-bucket lookup is gone.
        kpis: { income: 2500, expenses: 1200, count: 3 },
      }),
    );

    const result = await executor.execute(scope, "month");

    expect(mockGetSummary).toHaveBeenCalledWith(scope, currentBaMonth());
    expect(result).toEqual({
      query_type: "month",
      month: currentBaMonth(),
      monthIncome: 2500,
      monthExpenses: 1200,
      monthCount: 3,
    });
  });

  it("reports zeros for a month without movements", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue(summaryFixture());

    const result = await executor.execute(scope, "month");

    expect(result).toEqual({
      query_type: "month",
      month: currentBaMonth(),
      monthIncome: 0,
      monthExpenses: 0,
      monthCount: 0,
    });
  });

  it("answers the savings query from the current-month kpis.savings", async () => {
    const { executor, mockGetSummary } = makeHarness();
    mockGetSummary.mockResolvedValue(summaryFixture({ kpis: { savings: 150 } }));

    const result = await executor.execute(scope, "savings");

    expect(mockGetSummary).toHaveBeenCalledWith(scope, currentBaMonth());
    expect(result).toEqual({
      query_type: "savings",
      month: currentBaMonth(),
      savings: 150,
    });
  });

  it("answers the planned query with the outstanding total and no month", async () => {
    const { executor, mockListMovements, mockGetSummary } = makeHarness();
    const pending = (id: string, amount: number, currency: string) => ({
      id,
      ownerId,
      amount,
      currency,
      category: "servicios",
      note: id,
      occurredAt: new Date("2026-09-18T12:00:00.000Z"),
      createdAt: new Date(),
      type: "EXPENSE" as const,
      status: "PENDING" as const,
    });
    mockListMovements.mockResolvedValue([
      pending("p1", 3000, "ARS"),
      pending("p2", 1000, "ARS"),
      pending("p3", 500, "USD"),
    ]);

    const result = await executor.execute(scope, "planned");

    // One query for the PENDING rows instead of the whole 8-query summary, and
    // the ARS-only total mirrors the dashboard rule.
    expect(mockGetSummary).not.toHaveBeenCalled();
    expect(mockListMovements).toHaveBeenCalledWith(scope, {
      type: "EXPENSE",
      status: "PENDING",
    });
    expect(result).toEqual({ query_type: "planned", total: 4000 });
  });

  it("answers zero for the planned query when nothing is pending", async () => {
    const { executor, mockListMovements } = makeHarness();
    mockListMovements.mockResolvedValue([]);

    const result = await executor.execute(scope, "planned");

    expect(result).toEqual({ query_type: "planned", total: 0 });
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
