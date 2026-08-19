import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { ApiError, fetchMovementSummary } from "../../infra/api";
import { useMovementSummary } from "./useMovementSummary";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchMovementSummary: vi.fn(),
}));

const summary: MovementSummary = {
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
  daily: [{ day: "2026-07-01", income: 100, expenses: 50, balance: 50 }],
  categories: [],
  top: { expenses: [], income: [] },
};

const fetchMovementSummaryMock = vi.mocked(fetchMovementSummary);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMovementSummary", () => {
  it("transitions idle → loading → success with the summary data", async () => {
    fetchMovementSummaryMock.mockResolvedValue(summary);

    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const state = useMovementSummary("default");
      statuses.push(state.status);
      return state;
    });

    expect(statuses[0]).toBe("idle");
    expect(statuses).toContain("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));

    const state = result.current;
    if (state.status === "success") {
      expect(state.data.kpis.balance).toBe(1500);
    }
    expect(fetchMovementSummaryMock).toHaveBeenCalledWith("default");
  });

  it("reports the ApiError when the request fails", async () => {
    fetchMovementSummaryMock.mockRejectedValue(new ApiError("network"));

    const { result } = renderHook(() => useMovementSummary("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));

    const state = result.current;
    if (state.status === "error") {
      expect(state.error).toBeInstanceOf(ApiError);
      expect(state.error.kind).toBe("network");
    }
  });

  it("retry() re-issues the request after an error and recovers", async () => {
    fetchMovementSummaryMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(summary);

    const { result } = renderHook(() => useMovementSummary("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(2);
  });
});
