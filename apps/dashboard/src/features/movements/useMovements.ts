import { useCallback, useEffect, useMemo, useState } from "react";

import type { Movement } from "@rita/contracts";

import { ApiError, fetchMovements } from "../../infra/api";
import type { MovementListFilters } from "../../infra/api";
import type { AsyncState } from "./asyncState";

export type MovementsState = AsyncState<Movement[]> & { retry: () => void };

export function useMovements(
  ownerId: string,
  filters: MovementListFilters = {},
  refreshToken?: number,
): MovementsState {
  const [state, setState] = useState<AsyncState<Movement[]>>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  // A caller may pass a freshly-allocated filters object each render; depend on
  // its serialized value so equal filters do not trigger an effect loop.
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchMovements(ownerId, filters)
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
  }, [ownerId, attempt, filtersKey, refreshToken]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
