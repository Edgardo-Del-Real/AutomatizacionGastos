import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExpenseSummary } from "@rita/contracts";

import { ApiError, fetchSummary } from "../../infra/api";
import { useMetrics } from "./useMetrics";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchSummary: vi.fn(),
}));

const summary: ExpenseSummary = {
  months: [
    { month: "2026-02", count: 3, totalAmount: 1500 },
    { month: "2026-03", count: 5, totalAmount: 2750 },
  ],
};

const fetchSummaryMock = vi.mocked(fetchSummary);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMetrics", () => {
  it("transitions idle → loading → success with the summary data", async () => {
    fetchSummaryMock.mockResolvedValue(summary);

    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const state = useMetrics("default");
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
      expect(state.data).toEqual(summary);
    }
    expect(fetchSummaryMock).toHaveBeenCalledWith("default");
  });

  it("reports the ApiError when the request fails", async () => {
    fetchSummaryMock.mockRejectedValue(new ApiError("network"));

    const { result } = renderHook(() => useMetrics("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));

    const state = result.current;
    if (state.status === "error") {
      expect(state.error).toBeInstanceOf(ApiError);
      expect(state.error.kind).toBe("network");
    }
  });

  it("retry() re-issues the request after an error and recovers", async () => {
    fetchSummaryMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(summary);

    const { result } = renderHook(() => useMetrics("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(fetchSummaryMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    const state = result.current;
    if (state.status === "success") {
      expect(state.data).toEqual(summary);
    }
    expect(fetchSummaryMock).toHaveBeenCalledTimes(2);
  });
});