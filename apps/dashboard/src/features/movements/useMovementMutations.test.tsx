import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, deleteMovement, patchMovement } from "../../infra/api";
import { useMovementMutations } from "./useMovementMutations";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  patchMovement: vi.fn(),
  deleteMovement: vi.fn(),
}));

const patchMovementMock = vi.mocked(patchMovement);
const deleteMovementMock = vi.mocked(deleteMovement);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMovementMutations", () => {
  it("updateMovement patches the movement and fires onSuccess", async () => {
    patchMovementMock.mockResolvedValue({ id: "m1" } as never);
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.updateMovement("m1", { note: "cena" });
    });

    expect(patchMovementMock).toHaveBeenCalledWith("m1", "default", {
      note: "cena",
    });
    expect(ok).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.patchError).toBeNull();
  });

  it("updateMovement failure sets patchError and does not fire onSuccess", async () => {
    patchMovementMock.mockRejectedValue(new ApiError("http", { status: 422 }));
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.updateMovement("m1", { category: "no-existe" });
    });

    expect(ok).toBe(false);
    expect(result.current.patchError).toBeInstanceOf(ApiError);
    expect(result.current.patchError?.kind).toBe("http");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("removeMovement deletes the movement and fires onSuccess", async () => {
    deleteMovementMock.mockResolvedValue(undefined);
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeMovement("m1");
    });

    expect(deleteMovementMock).toHaveBeenCalledWith("m1", "default");
    expect(ok).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.deleteError).toBeNull();
  });

  it("removeMovement failure sets deleteError and does not fire onSuccess", async () => {
    deleteMovementMock.mockRejectedValue(new ApiError("http", { status: 500 }));
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeMovement("m1");
    });

    expect(ok).toBe(false);
    expect(result.current.deleteError).toBeInstanceOf(ApiError);
    expect(result.current.deleteError?.kind).toBe("http");
    expect(onSuccess).not.toHaveBeenCalled();
  });
});