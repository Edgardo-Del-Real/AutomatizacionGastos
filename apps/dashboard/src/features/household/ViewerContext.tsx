import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { HouseholdMember } from "@rita/contracts";

import { OWNER_ID } from "../../infra/env";
import { useHousehold } from "./useHousehold";

/** localStorage key holding the persisted viewer selection. */
export const VIEWER_STORAGE_KEY = "rita.viewer";

export type ViewerContextValue = {
  /** Single source of truth for the owner of every API request. */
  viewerId: string;
  /** Household members (no chatIds) used for the selector and badge names. */
  members: HouseholdMember[];
  /** Persists the selection across reloads (localStorage). */
  setViewerId: (ownerId: string) => void;
  /** True only when the household has more than one member (spec: single-user hides the selector). */
  selectorVisible: boolean;
};

/**
 * Degraded single-user value used when a component renders outside the
 * provider: no members, `VITE_OWNER_ID` fallback, no selector. This mirrors
 * the pre-change behavior and keeps the rollback story (unset household →
 * fixed owner) intact.
 */
const FALLBACK_VIEWER: ViewerContextValue = {
  viewerId: OWNER_ID,
  members: [],
  setViewerId: () => {},
  selectorVisible: false,
};

const ViewerContext = createContext<ViewerContextValue | null>(null);

function readStoredViewer(): string | null {
  try {
    return window.localStorage.getItem(VIEWER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredViewer(ownerId: string): void {
  try {
    window.localStorage.setItem(VIEWER_STORAGE_KEY, ownerId);
  } catch {
    // Storage unavailable (private mode): the selection lives in memory only.
  }
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const household = useHousehold();
  const members = household.status === "success" ? household.data : [];
  const selectorVisible = members.length > 1;
  const [storedViewer, setStoredViewer] = useState<string | null>(() =>
    readStoredViewer(),
  );

  // Resolve the effective viewer: the persisted selection when it is a known
  // member; otherwise fall back to VITE_OWNER_ID when it is a member, and to
  // the first member only as a last resort. Single-member/error → VITE_OWNER_ID.
  const viewerId = useMemo(() => {
    if (!selectorVisible) return OWNER_ID;
    const memberIds = members.map((member) => member.ownerId);
    if (storedViewer !== null && memberIds.includes(storedViewer)) {
      return storedViewer;
    }
    if (memberIds.includes(OWNER_ID)) return OWNER_ID;
    return memberIds[0] ?? OWNER_ID;
  }, [selectorVisible, members, storedViewer]);

  const setViewerId = useCallback((ownerId: string) => {
    setStoredViewer(ownerId);
    writeStoredViewer(ownerId);
  }, []);

  const value = useMemo<ViewerContextValue>(
    () => ({ viewerId, members, setViewerId, selectorVisible }),
    [viewerId, members, setViewerId, selectorVisible],
  );

  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  );
}

/**
 * Exposes the active viewer. Outside a `ViewerProvider` it degrades to the
 * single-user fallback (`VITE_OWNER_ID`, no members, no selector), so any
 * component keeps working standalone.
 */
export function useViewer(): ViewerContextValue {
  return useContext(ViewerContext) ?? FALLBACK_VIEWER;
}