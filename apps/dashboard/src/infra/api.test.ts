import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Movement, MovementSummary } from "@rita/contracts";

import { ApiError, fetchMovements, fetchMovementSummary } from "./api";

const validSummary: MovementSummary = {
  kpis: {
    income: 3000,
    expenses: 1500,
    balance: 1500,
    avgPerMonth: 1500,
    avgPerMovement: 500,
    maxAmount: 1000,
    count: 3,
  },
  mom: {
    months: [
      { month: "2026-06", income: 2000, expenses: 1000, balance: 1000 },
      { month: "2026-07", income: 1000, expenses: 500, balance: 500 },
    ],
  },
  daily: [
    { day: "2026-07-01", income: 100, expenses: 50, balance: 50 },
    { day: "2026-07-02", income: 0, expenses: 30, balance: -30 },
  ],
  categories: [
    {
      name: "food",
      expenseAmount: 1000,
      incomeAmount: 0,
      expensePercent: 100,
      incomePercent: 0,
    },
  ],
  top: {
    expenses: [],
    income: [],
  },
};

const validMovements: Movement[] = [
  {
    id: "m1",
    ownerId: "default",
    amount: 500,
    currency: "ARS",
    type: "INCOME",
    category: "sueldo",
    note: "sueldo julio",
    occurredAt: new Date("2026-08-10T12:00:00Z"),
    createdAt: new Date("2026-08-10T12:00:00Z"),
  },
  {
    id: "m2",
    ownerId: "default",
    amount: 200,
    currency: "ARS",
    type: "EXPENSE",
    category: "food",
    note: null,
    occurredAt: new Date("2026-08-11T12:00:00Z"),
    createdAt: new Date("2026-08-11T12:00:00Z"),
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMovementSummary", () => {
  it("resolves validated summary data for the owner", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSummary));

    const summary = await fetchMovementSummary("default");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/movements/summary?ownerId=default",
    );
    expect(summary.kpis.balance).toBe(1500);
    expect(summary.mom.months).toHaveLength(2);
    expect(summary.daily[0]).toMatchObject({ day: "2026-07-01", balance: 50 });
  });

  it("throws ApiError validation when kpis is missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await expect(fetchMovementSummary("default")).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(fetchMovementSummary("default")).rejects.toMatchObject({
      kind: "validation",
      issues: expect.any(Array),
    });
  });

  it("throws ApiError http with status when the response is not ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    await expect(fetchMovementSummary("default")).rejects.toMatchObject({
      kind: "http",
      status: 500,
    });
  });

  it("throws ApiError network when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    await expect(fetchMovementSummary("default")).rejects.toMatchObject({
      kind: "network",
    });
  });
});

describe("fetchMovements", () => {
  it("resolves validated movements for the owner with no filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validMovements));

    const movements = await fetchMovements("acme");

    expect(fetchMock).toHaveBeenCalledWith("/api/movements?ownerId=acme");
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({
      id: "m1",
      amount: 500,
      type: "INCOME",
      category: "sueldo",
    });
    expect(movements[0]?.occurredAt).toEqual(new Date("2026-08-10T12:00:00Z"));
  });

  it("builds query params from all active filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validMovements));

    await fetchMovements("default", {
      type: "INCOME",
      from: "2026-08-01",
      to: "2026-08-31",
      category: "sueldo",
      q: "julio",
    });

    // URLSearchParams preserves insertion order: ownerId first, then filters.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/movements?ownerId=default&type=INCOME&from=2026-08-01&to=2026-08-31&category=sueldo&q=julio",
    );
  });

  it("omits empty filter values from the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validMovements));

    await fetchMovements("default", { q: "" });

    expect(fetchMock).toHaveBeenCalledWith("/api/movements?ownerId=default");
  });

  it("throws ApiError validation when a movement is wrong-typed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ ...validMovements[0]!, type: "SAVINGS" }]),
    );

    await expect(fetchMovements("default")).rejects.toMatchObject({
      kind: "validation",
    });
  });

  it("throws ApiError validation when occurredAt is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          id: "m1",
          ownerId: "default",
          amount: 500,
          currency: "ARS",
          type: "EXPENSE",
          category: "food",
          note: null,
          createdAt: "2026-08-10T12:00:00.000Z",
        },
      ]),
    );

    await expect(fetchMovements("default")).rejects.toMatchObject({
      kind: "validation",
    });
  });
});
