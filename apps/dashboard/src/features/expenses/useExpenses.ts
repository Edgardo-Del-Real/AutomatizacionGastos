import { useCallback, useEffect, useState } from "react";

import type { Expense } from "@rita/contracts";

import { ApiError, fetchExpenses } from "../../infra/api";
import type { AsyncState } from "../metrics/useMetrics";

export type ExpensesState = AsyncState<Expense[]> & { retry: () => void };

export function useExpenses(ownerId: string): ExpensesState {
  const [state, setState] = useState<AsyncState<Expense[]>>({
    status: "idle",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchExpenses(ownerId)
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