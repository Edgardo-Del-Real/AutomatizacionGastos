import { useCallback, useEffect, useState } from "react";

import type { Session } from "@rita/contracts";

import {
  ApiError,
  fetchSession,
  login as loginRequest,
  logout as logoutRequest,
} from "../../infra/api";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; ownerId: string; name: string }
  | { status: "error"; error: ApiError };

export type UseSession = {
  state: SessionState;
  /** Resolves true when the cookie is set; false keeps the form open. */
  login: (ownerId: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  retry: () => void;
  /** Last login failure, so the form can show "credenciales inválidas". */
  error: ApiError | null;
  busy: boolean;
};

/**
 * online-access: the dashboard never picks an identity anymore — it asks the
 * API who the session belongs to. Without a session the app renders the login
 * gate instead of the data.
 */
export function useSession(): UseSession {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSession()
      .then((session: Session | null) => {
        if (cancelled) return;
        setState(
          session === null
            ? { status: "anonymous" }
            : { status: "authenticated", ownerId: session.ownerId, name: session.name },
        );
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: caught instanceof ApiError ? caught : new ApiError("network"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const login = useCallback(async (ownerId: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const session = await loginRequest(ownerId, password);
      setState({ status: "authenticated", ownerId: session.ownerId, name: session.name });
      return true;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError("network"));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setState({ status: "anonymous" });
    }
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, login, logout, retry, error, busy };
}
