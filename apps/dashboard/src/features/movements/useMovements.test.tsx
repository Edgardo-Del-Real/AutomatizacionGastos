import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Movement } from "@rita/contracts";

import { ApiError, fetchMovements } from "../../infra/api";
import type { MovementListFilters } from "../../infra/api";
import { useMovements } from "./useMovements";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchMovements: vi.fn(),
}));

const movements: Movement[] = [
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

const fetchMovementsMock = vi.mocked(fetchMovements);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMovements", () => {
  it("transitions idle → loading → success with the movement list", async () => {
    fetchMovementsMock.mockResolvedValue(movements);

    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const state = useMovements("default");
      statuses.push(state.status);
      return state;
    });

    expect(statuses[0]).toBe("idle");
    expect(statuses).toContain("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));

    const state = result.current;
    if (state.status === "success") {
      expect(state.data).toHaveLength(2);
    }
    expect(fetchMovementsMock).toHaveBeenCalledWith("default", {});
  });

  it("refetches with the new filters when the filter object changes", async () => {
    fetchMovementsMock.mockResolvedValue(movements);

    const firstFilters: MovementListFilters = { type: "INCOME" };
    const { result, rerender } = renderHook(
      ({ filters }) => useMovements("default", filters),
      { initialProps: { filters: firstFilters } },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchMovementsMock).toHaveBeenCalledWith("default", firstFilters);

    const secondFilters: MovementListFilters = { type: "EXPENSE", q: "taxi" };
    rerender({ filters: secondFilters });

    await waitFor(() =>
      expect(fetchMovementsMock).toHaveBeenCalledWith("default", secondFilters),
    );
  });

  it("reports the ApiError when the request fails", async () => {
    fetchMovementsMock.mockRejectedValue(new ApiError("http", { status: 500 }));

    const { result } = renderHook(() => useMovements("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));

    const state = result.current;
    if (state.status === "error") {
      expect(state.error).toBeInstanceOf(ApiError);
      expect(state.error.kind).toBe("http");
    }
  });

  it("retry() re-issues the request after an error and recovers", async () => {
    fetchMovementsMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(movements);

    const { result } = renderHook(() => useMovements("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(fetchMovementsMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchMovementsMock).toHaveBeenCalledTimes(2);
  });

  it("refetches when the refreshToken changes", async () => {
    fetchMovementsMock.mockResolvedValue(movements);

    const { result, rerender } = renderHook(
      ({ token }) => useMovements("default", {}, token),
      { initialProps: { token: 0 } },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchMovementsMock).toHaveBeenCalledTimes(1);

    rerender({ token: 1 });

    await waitFor(() => expect(fetchMovementsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("success"));
  });
});
