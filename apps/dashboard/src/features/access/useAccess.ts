import { useCallback, useEffect, useRef, useState } from "react";

import type { AccessStatus } from "../../infra/api";
import { ApiError, fetchAccessStatus, requestAccess, revokeAccess } from "../../infra/api";

/** How often the requester asks whether the other person already answered. */
const POLL_MS = 4000;

export type UseAccess = {
  status: AccessStatus | null;
  error: ApiError | null;
  /** True while the request POST is in flight. */
  requesting: boolean;
  /** The partner whose dashboard is currently visible, or null. */
  viewAs: string | null;
  /** True while a request is pending the other person's answer. */
  waiting: boolean;
  request: () => Promise<void>;
  revoke: () => Promise<void>;
  refresh: () => void;
};

/**
 * household-isolation: the requester's side of the permission.
 *
 * The decision happens in the other person's Telegram chat, so while a request
 * is pending the dashboard polls until it is answered, expires or is cancelled.
 */
export function useAccess(enabled: boolean): UseAccess {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchAccessStatus()
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught : new ApiError("network"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const waiting = status?.pending !== null && status?.pending !== undefined;

  // Poll only while there is something to wait for: a pending request or a
  // grant with an expiry that the UI has to notice.
  useEffect(() => {
    if (!enabled) return;
    if (!waiting && status?.grant === null) return;
    const timer = setInterval(() => setAttempt((n) => n + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, waiting, status?.grant]);

  const request = useCallback(async () => {
    setRequesting(true);
    setError(null);
    try {
      await requestAccess();
      setAttempt((n) => n + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError("network"));
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }, []);

  const revoke = useCallback(async () => {
    try {
      await revokeAccess();
    } finally {
      setAttempt((n) => n + 1);
    }
  }, []);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    status,
    error,
    requesting,
    viewAs: status?.grant?.targetOwnerId ?? null,
    waiting,
    request,
    revoke,
    refresh,
  };
}
