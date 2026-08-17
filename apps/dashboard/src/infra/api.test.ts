import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Expense, ExpenseSummary } from "@rita/contracts";

import { ApiError, fetchExpenses, fetchSummary } from "./api";

const validSummary: ExpenseSummary = {
  months: [
    { month: "2026-02", count: 3, totalAmount: 1500 },
    { month: "2026-03", count: 5, totalAmount: 2750 },
  ],
};

const validExpenses: Expense[] = [
  {
    id: "e1",
    ownerId: "default",
    amount: 500,
    currency: "ARS",
    category: "food",
    note: "lunch",
    occurredAt: new Date("2026-03-10T12:00:00Z"),
    createdAt: new Date("2026-03-10T12:00:00Z"),
  },
  {
    id: "e2",
    ownerId: "default",
    amount: 250,
    currency: "USD",
    category: null,
    note: null,
    occurredAt: new Date("2026-03-11T12:00:00Z"),
    createdAt: new Date("2026-03-11T12:00:00Z"),
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

describe("fetchSummary", () => {
  it("resolves validated summary data for the owner", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSummary));

    const summary = await fetchSummary("default");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/expenses/summary?ownerId=default",
    );
    expect(summary.months).toEqual([
      { month: "2026-02", count: 3, totalAmount: 1500 },
      { month: "2026-03", count: 5, totalAmount: 2750 },
    ]);
  });

  it("throws ApiError validation when months is missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await expect(fetchSummary("default")).rejects.toBeInstanceOf(ApiError);
    await expect(fetchSummary("default")).rejects.toMatchObject({
      kind: "validation",
      issues: expect.any(Array),
    });
  });

  it("throws ApiError validation when a months item is wrong-typed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ months: [{ month: "2026-02", count: "3", totalAmount: 1500 }] }),
    );

    await expect(fetchSummary("default")).rejects.toMatchObject({
      kind: "validation",
    });
  });

  it("throws ApiError http with status when the response is not ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    await expect(fetchSummary("default")).rejects.toMatchObject({
      kind: "http",
      status: 500,
    });
  });

  it("throws ApiError network when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    await expect(fetchSummary("default")).rejects.toMatchObject({
      kind: "network",
    });
  });
});

describe("fetchExpenses", () => {
  it("resolves validated expenses for the owner", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validExpenses));

    const expenses = await fetchExpenses("acme");

    expect(fetchMock).toHaveBeenCalledWith("/api/expenses?ownerId=acme");
    expect(expenses).toHaveLength(2);
    expect(expenses[0]).toMatchObject({
      id: "e1",
      amount: 500,
      currency: "ARS",
      category: "food",
      note: "lunch",
    });
    expect(expenses[0]?.occurredAt).toEqual(
      new Date("2026-03-10T12:00:00Z"),
    );
  });

  it("throws ApiError validation when occurredAt is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          id: "e1",
          ownerId: "default",
          amount: 500,
          currency: "ARS",
          category: "food",
          note: "lunch",
          createdAt: "2026-03-10T12:00:00.000Z",
        },
      ]),
    );

    await expect(fetchExpenses("default")).rejects.toMatchObject({
      kind: "validation",
    });
  });

  it("throws ApiError validation when occurredAt is wrong-typed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ ...validExpenses[0]!, occurredAt: "not-a-date" }]),
    );

    await expect(fetchExpenses("default")).rejects.toMatchObject({
      kind: "validation",
    });
  });
});