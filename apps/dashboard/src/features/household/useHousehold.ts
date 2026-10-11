import { useCallback, useEffect, useState } from "react";

import type { HouseholdMember } from "@rita/contracts";

import { ApiError, fetchHouseholdMembers } from "../../infra/api";
import type { AsyncState } from "../movements/asyncState";

export type HouseholdState = AsyncState<HouseholdMember[]> & { retry: () => void };

/**
 * Fetches the household members from `GET /household/members`.
 *
 * The hook is deliberately dumb: it only reports the async result. Consumers
 * (ViewerContext) decide the viewer identity, falling back to `VITE_OWNER_ID`
 * when the request fails or the household has a single member.
 */
export function useHousehold(): HouseholdState {
  const [state, setState] = useState<AsyncState<HouseholdMember[]>>({
    status: "idle",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchHouseholdMembers()
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
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
