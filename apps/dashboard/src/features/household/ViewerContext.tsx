import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { HouseholdMember } from "@rita/contracts";

import { OWNER_ID } from "../../infra/env";
import { useHousehold } from "./useHousehold";

export type ViewerContextValue = {
  /** The session owner: the single source of truth for every API request. */
  viewerId: string;
  /** Household members (no chatIds) used for the shared-row badge names. */
  members: HouseholdMember[];
};

/**
 * Degraded value used when a component renders outside the provider: the
 * `VITE_OWNER_ID` fallback with no members. Components keep working standalone.
 */
const FALLBACK_VIEWER: ViewerContextValue = {
  viewerId: OWNER_ID,
  members: [],
};

const ViewerContext = createContext<ViewerContextValue | null>(null);

/**
 * online-access: the viewer is no longer chosen in the UI — it comes from the
 * session cookie. This provider only carries it down and loads the member list
 * for display names.
 */
export function ViewerProvider({
  ownerId,
  children,
}: {
  ownerId: string;
  children: ReactNode;
}) {
  const household = useHousehold();
  const members = household.status === "success" ? household.data : [];

  const value = useMemo<ViewerContextValue>(
    () => ({ viewerId: ownerId, members }),
    [ownerId, members],
  );

  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  );
}

/**
 * Exposes the active viewer. Outside a `ViewerProvider` it degrades to the
 * `VITE_OWNER_ID` fallback, so any component keeps working standalone.
 */
export function useViewer(): ViewerContextValue {
  return useContext(ViewerContext) ?? FALLBACK_VIEWER;
}
