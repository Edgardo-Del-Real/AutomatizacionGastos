import { useCallback, useEffect, useState } from "react";

import type { ExpenseSummary } from "@rita/contracts";

import { ApiError, fetchSummary } from "../../infra/api";

export type AsyncState<T> =
  | { status: "idle" | "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError };

export type MetricsState = AsyncState<ExpenseSummary> & { retry: () => void };

export function useMetrics(ownerId: string): MetricsState {
  const [state, setState] = useState<AsyncState<ExpenseSummary>>({
    status: "idle",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSummary(ownerId)
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