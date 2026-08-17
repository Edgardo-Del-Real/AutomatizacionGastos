import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Expense } from "@rita/contracts";

import { ApiError, fetchExpenses } from "../../infra/api";
import { useExpenses } from "./useExpenses";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchExpenses: vi.fn(),
}));

const expenses: Expense[] = [
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

const fetchExpensesMock = vi.mocked(fetchExpenses);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useExpenses", () => {
  it("transitions idle → loading → success with the expense list", async () => {
    fetchExpensesMock.mockResolvedValue(expenses);

    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const state = useExpenses("default");
      statuses.push(state.status);
      return state;
    });

    // The initial render is idle before any request starts.
    expect(statuses[0]).toBe("idle");
    // The request is in flight: the hook has left idle.
    expect(statuses).toContain("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(statuses.at(-1)).toBe("success");
    const state = result.current;
    if (state.status === "success") {
      expect(state.data).toEqual(expenses);
    }
    expect(fetchExpensesMock).toHaveBeenCalledWith("default");
  });

  it("reports the ApiError when the request fails", async () => {
    fetchExpensesMock.mockRejectedValue(new ApiError("http", { status: 500 }));

    const { result } = renderHook(() => useExpenses("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));

    const state = result.current;
    if (state.status === "error") {
      expect(state.error).toBeInstanceOf(ApiError);
      expect(state.error.kind).toBe("http");
      expect(state.error.status).toBe(500);
    }
  });

  it("retry() re-issues the request after an error and recovers", async () => {
    fetchExpensesMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(expenses);

    const { result } = renderHook(() => useExpenses("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(fetchExpensesMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    const state = result.current;
    if (state.status === "success") {
      expect(state.data).toEqual(expenses);
    }
    expect(fetchExpensesMock).toHaveBeenCalledTimes(2);
  });
});