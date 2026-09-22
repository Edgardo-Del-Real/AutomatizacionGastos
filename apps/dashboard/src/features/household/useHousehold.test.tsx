import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HouseholdMember } from "@rita/contracts";

import { ApiError, fetchHouseholdMembers } from "../../infra/api";
import { useHousehold } from "./useHousehold";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchHouseholdMembers: vi.fn(),
}));

const members: HouseholdMember[] = [
  { ownerId: "rita", name: "Rita" },
  { ownerId: "edgardo", name: "Edgardo" },
];

const fetchHouseholdMembersMock = vi.mocked(fetchHouseholdMembers);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useHousehold", () => {
  it("transitions idle → loading → success with the household members", async () => {
    fetchHouseholdMembersMock.mockResolvedValue(members);

    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const state = useHousehold();
      statuses.push(state.status);
      return state;
    });

    expect(statuses[0]).toBe("idle");
    expect(statuses).toContain("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));

    const state = result.current;
    if (state.status === "success") {
      expect(state.data).toEqual(members);
    }
    expect(fetchHouseholdMembersMock).toHaveBeenCalledTimes(1);
  });

  it("exposes a single-member household so consumers render no selector", async () => {
    fetchHouseholdMembersMock.mockResolvedValue([
      { ownerId: "default", name: "Rita" },
    ]);

    const { result } = renderHook(() => useHousehold());

    await waitFor(() => expect(result.current.status).toBe("success"));

    const state = result.current;
    if (state.status === "success") {
      expect(state.data).toHaveLength(1);
    }
  });

  it("reports an error so the viewer falls back to VITE_OWNER_ID", async () => {
    fetchHouseholdMembersMock.mockRejectedValue(new ApiError("network"));

    const { result } = renderHook(() => useHousehold());

    await waitFor(() => expect(result.current.status).toBe("error"));

    const state = result.current;
    if (state.status === "error") {
      expect(state.error).toBeInstanceOf(ApiError);
      expect(state.error.kind).toBe("network");
    }
  });

  it("retry() re-issues the request after an error and recovers", async () => {
    fetchHouseholdMembersMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(members);

    const { result } = renderHook(() => useHousehold());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(fetchHouseholdMembersMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchHouseholdMembersMock).toHaveBeenCalledTimes(2);
  });
});
