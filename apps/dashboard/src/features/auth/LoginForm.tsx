import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "../../infra/api";

type LoginFormProps = {
  /** Resolves true when the cookie was set. */
  onLogin: (ownerId: string, password: string) => Promise<boolean>;
  error: ApiError | null;
  busy: boolean;
};

const FIELD_CLASS =
  "mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
const LABEL_CLASS = "text-xs font-medium tracking-wide text-ink-faint uppercase";

/**
 * online-access: the only way into the dashboard. Two household accounts, no
 * public sign-up — the credentials live in the deploy env (AUTH_USERS).
 */
export function LoginForm({ onLogin, error, busy }: LoginFormProps) {
  const [ownerId, setOwnerId] = useState("default");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password === "") return;
    await onLogin(ownerId, password);
  }

  const failed = error?.kind === "http" && error.status === 401;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-ink antialiased">
      <form
        aria-label="Ingresar"
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-card border border-border bg-surface p-6 shadow-card sm:p-8"
      >
        <h1 className="text-lg font-bold tracking-tight text-ink">Rita</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Tus finanzas, en orden. Entrá con tu usuario.
        </p>

        <div className="mt-6">
          <label htmlFor="login-owner" className={LABEL_CLASS}>
            Usuario
          </label>
          <select
            id="login-owner"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="default">Edgardo</option>
            <option value="rita">Rita</option>
          </select>
        </div>

        <div className="mt-4">
          <label htmlFor="login-password" className={LABEL_CLASS}>
            Contraseña
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        {failed ? (
          <p role="alert" className="mt-4 text-sm font-medium text-danger">
            Usuario o contraseña incorrectos.
          </p>
        ) : null}
        {error !== null && !failed ? (
          <p role="alert" className="mt-4 text-sm font-medium text-danger">
            No se pudo conectar con el servidor. Probá de nuevo.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || password === ""}
          className="mt-6 inline-flex w-full items-center justify-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
