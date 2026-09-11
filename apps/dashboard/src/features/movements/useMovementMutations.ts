import { useCallback, useState } from "react";

import { ApiError, deleteMovement, patchMovement } from "../../infra/api";
import type { MovementPatch } from "../../infra/api";
import { OWNER_ID } from "../../infra/env";

export type MovementMutations = {
  /** PATCHes the movement; resolves true on success, false on failure. */
  updateMovement: (id: string, patch: MovementPatch) => Promise<boolean>;
  /** DELETEs the movement; resolves true on success, false on failure. */
  removeMovement: (id: string) => Promise<boolean>;
  patchError: ApiError | null;
  deleteError: ApiError | null;
  busy: "patch" | "delete" | null;
};

/**
 * Mutation helpers for movements. On success the optional `onSuccess`
 * callback fires so the App can bump its refresh token and re-fetch
 * the list and summary in place.
 */
export function useMovementMutations(onSuccess?: () => void): MovementMutations {
  const [patchError, setPatchError] = useState<ApiError | null>(null);
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<"patch" | "delete" | null>(null);

  const updateMovement = useCallback(
    async (id: string, patch: MovementPatch): Promise<boolean> => {
      setBusy("patch");
      setPatchError(null);
      try {
        await patchMovement(id, OWNER_ID, patch);
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
    [onSuccess],
  );

  const removeMovement = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy("delete");
      setDeleteError(null);
      try {
        await deleteMovement(id, OWNER_ID);
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
    [onSuccess],
  );

  return { updateMovement, removeMovement, patchError, deleteError, busy };
}