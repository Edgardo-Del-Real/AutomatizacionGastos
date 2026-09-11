import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OwnerCategory } from "@rita/contracts";

import { ApiError, fetchCategories } from "../../infra/api";
import { useCategories } from "./useCategories";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchCategories: vi.fn(),
}));

const categories: OwnerCategory[] = [
  { name: "comida", keywords: ["comida", "restaurante"] },
  { name: "sueldo", keywords: [] },
];

const fetchCategoriesMock = vi.mocked(fetchCategories);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCategories", () => {
  it("transitions idle → loading → success with the owner categories", async () => {
    fetchCategoriesMock.mockResolvedValue(categories);

    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const state = useCategories("default");
      statuses.push(state.status);
      return state;
    });

    expect(statuses[0]).toBe("idle");
    expect(statuses).toContain("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));

    const state = result.current;
    if (state.status === "success") {
      expect(state.data).toHaveLength(2);
      expect(state.data[0]).toEqual({
        name: "comida",
        keywords: ["comida", "restaurante"],
      });
    }
    expect(fetchCategoriesMock).toHaveBeenCalledWith("default");
  });

  it("refetches when the refreshToken changes", async () => {
    fetchCategoriesMock.mockResolvedValue(categories);

    const { result, rerender } = renderHook(
      ({ token }) => useCategories("default", token),
      { initialProps: { token: 0 } },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchCategoriesMock).toHaveBeenCalledTimes(1);

    rerender({ token: 1 });

    await waitFor(() => expect(fetchCategoriesMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("reports the ApiError when the request fails", async () => {
    fetchCategoriesMock.mockRejectedValue(new ApiError("http", { status: 500 }));

    const { result } = renderHook(() => useCategories("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));

    const state = result.current;
    if (state.status === "error") {
      expect(state.error).toBeInstanceOf(ApiError);
      expect(state.error.kind).toBe("http");
    }
  });

  it("retry() re-issues the request after an error and recovers", async () => {
    fetchCategoriesMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(categories);

    const { result } = renderHook(() => useCategories("default"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(fetchCategoriesMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchCategoriesMock).toHaveBeenCalledTimes(2);
  });
});