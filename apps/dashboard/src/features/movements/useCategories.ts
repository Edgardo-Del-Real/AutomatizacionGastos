import { useCallback, useEffect, useState } from "react";

import type { OwnerCategory } from "@rita/contracts";

import { ApiError, fetchCategories } from "../../infra/api";
import type { AsyncState } from "./asyncState";

export type CategoriesState = AsyncState<OwnerCategory[]> & {
  retry: () => void;
};

export function useCategories(
  ownerId: string,
  refreshToken?: number,
): CategoriesState {
  const [state, setState] = useState<AsyncState<OwnerCategory[]>>({
    status: "idle",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchCategories(ownerId)
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof ApiError ? error : new ApiError("network"),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, attempt, refreshToken]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}