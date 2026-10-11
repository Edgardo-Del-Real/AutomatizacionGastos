import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createPlannedMovement,
  deleteMovement,
  markMovementPaid,
  patchMovement,
} from "../../infra/api";
import { useMovementMutations } from "./useMovementMutations";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  patchMovement: vi.fn(),
  deleteMovement: vi.fn(),
  createPlannedMovement: vi.fn(),
  markMovementPaid: vi.fn(),
}));

const patchMovementMock = vi.mocked(patchMovement);
const deleteMovementMock = vi.mocked(deleteMovement);
const createPlannedMovementMock = vi.mocked(createPlannedMovement);
const markMovementPaidMock = vi.mocked(markMovementPaid);

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

  it("createPlanned creates a planned expense and fires onSuccess", async () => {
    createPlannedMovementMock.mockResolvedValue({ id: "p1" } as never);
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.createPlanned({
        amount: 2500,
        note: "alquiler",
        category: "alquiler",
      });
    });

    expect(createPlannedMovementMock).toHaveBeenCalledWith("default", {
      amount: 2500,
      note: "alquiler",
      category: "alquiler",
    });
    expect(ok).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.plannedCreateError).toBeNull();
  });

  it("createPlanned failure sets plannedCreateError and does not fire onSuccess", async () => {
    createPlannedMovementMock.mockRejectedValue(
      new ApiError("http", { status: 422 }),
    );
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.createPlanned({ amount: 2500, note: null, category: null });
    });

    expect(ok).toBe(false);
    expect(result.current.plannedCreateError).toBeInstanceOf(ApiError);
    expect(result.current.plannedCreateError?.kind).toBe("http");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("markPaid marks the movement paid and fires onSuccess", async () => {
    markMovementPaidMock.mockResolvedValue({ id: "p1", status: "PAID" } as never);
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.markPaid("p1");
    });

    expect(markMovementPaidMock).toHaveBeenCalledWith("p1", "default");
    expect(ok).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.markPaidError).toBeNull();
  });

  it("markPaid failure sets markPaidError and does not fire onSuccess", async () => {
    markMovementPaidMock.mockRejectedValue(
      new ApiError("http", { status: 409 }),
    );
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useMovementMutations(onSuccess));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.markPaid("p1");
    });

    expect(ok).toBe(false);
    expect(result.current.markPaidError).toBeInstanceOf(ApiError);
    expect(result.current.markPaidError?.kind).toBe("http");
    expect(onSuccess).not.toHaveBeenCalled();
  });
});