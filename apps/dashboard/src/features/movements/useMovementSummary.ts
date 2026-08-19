import { useCallback, useEffect, useState } from "react";

import type { MovementSummary } from "@rita/contracts";

import { ApiError, fetchMovementSummary } from "../../infra/api";
import type { AsyncState } from "./asyncState";

export type MovementSummaryState = AsyncState<MovementSummary> & {
  retry: () => void;
};

export function useMovementSummary(ownerId: string): MovementSummaryState {
  const [state, setState] = useState<AsyncState<MovementSummary>>({
    status: "idle",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchMovementSummary(ownerId)
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
  }, [ownerId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
