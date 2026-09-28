import { useCallback, useState } from "react";

import {
  ApiError,
  createPlannedMovement,
  deleteMovement,
  markMovementPaid,
  patchMovement,
} from "../../infra/api";
import type { MovementPatch, PlannedMovementInput } from "../../infra/api";
import { useViewer } from "../household/ViewerContext";

export type MovementMutations = {
  /** PATCHes the movement; resolves true on success, false on failure. */
  updateMovement: (id: string, patch: MovementPatch) => Promise<boolean>;
  /** DELETEs the movement; resolves true on success, false on failure. */
  removeMovement: (id: string) => Promise<boolean>;
  /** Creates a planned (PENDING EXPENSE) movement; true on success. */
  createPlanned: (input: PlannedMovementInput) => Promise<boolean>;
  /** Marks a PENDING movement paid; true on success (409 → false + error). */
  markPaid: (id: string) => Promise<boolean>;
  patchError: ApiError | null;
  deleteError: ApiError | null;
  plannedCreateError: ApiError | null;
  markPaidError: ApiError | null;
  busy: "patch" | "delete" | "createPlanned" | "markPaid" | null;
};

/**
 * Mutation helpers for movements. On success the optional `onSuccess`
 * callback fires so the App can bump its refresh token and re-fetch
 * the list and summary in place.
 */
export function useMovementMutations(onSuccess?: () => void): MovementMutations {
  const { viewerId } = useViewer();
  const [patchError, setPatchError] = useState<ApiError | null>(null);
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);
  const [plannedCreateError, setPlannedCreateError] =
    useState<ApiError | null>(null);
  const [markPaidError, setMarkPaidError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<
    "patch" | "delete" | "createPlanned" | "markPaid" | null
  >(null);

  const updateMovement = useCallback(
    async (id: string, patch: MovementPatch): Promise<boolean> => {
      setBusy("patch");
      setPatchError(null);
      try {
        await patchMovement(id, viewerId, patch);
        onSuccess?.();
        return true;
      } catch (error) {
        setPatchError(
          error instanceof ApiError ? error : new ApiError("network"),
        );
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onSuccess, viewerId],
  );

  const removeMovement = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy("delete");
      setDeleteError(null);
      try {
        await deleteMovement(id, viewerId);
        onSuccess?.();
        return true;
      } catch (error) {
        setDeleteError(
          error instanceof ApiError ? error : new ApiError("network"),
        );
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onSuccess, viewerId],
  );

  const createPlanned = useCallback(
    async (input: PlannedMovementInput): Promise<boolean> => {
      setBusy("createPlanned");
      setPlannedCreateError(null);
      try {
        await createPlannedMovement(viewerId, input);
        onSuccess?.();
        return true;
      } catch (error) {
        setPlannedCreateError(
          error instanceof ApiError ? error : new ApiError("network"),
        );
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onSuccess, viewerId],
  );

  const markPaid = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy("markPaid");
      setMarkPaidError(null);
      try {
        await markMovementPaid(id, viewerId);
        onSuccess?.();
        return true;
      } catch (error) {
        setMarkPaidError(
          error instanceof ApiError ? error : new ApiError("network"),
        );
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onSuccess, viewerId],
  );

  return {
    updateMovement,
    removeMovement,
    createPlanned,
    markPaid,
    patchError,
    deleteError,
    plannedCreateError,
    markPaidError,
    busy,
  };
}