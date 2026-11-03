import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { AccessHistory } from "@rita/contracts";

import { ApiError, changePassword, fetchAccessHistory } from "../../infra/api";

type ProfileDialogProps = {
  userName: string;
  ownerId: string;
  /** Display name for an ownerId, used by the access history. */
  nameOf: (ownerId: string) => string;
  onClose: () => void;
};

const FIELD_CLASS =
  "mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
const LABEL_CLASS = "text-xs font-medium tracking-wide text-ink-faint uppercase";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function historyLine(entry: AccessHistory[number], nameOf: (ownerId: string) => string): string {
  const who = nameOf(entry.requesterId);
  if (entry.revokedAt !== null) {
    return `${who} · ${formatDateTime(entry.createdAt)} · lo cortaste`;
  }
  const expired = new Date(entry.expiresAt).getTime() <= Date.now();
  return `${who} · ${formatDateTime(entry.createdAt)} · ${expired ? "venció" : "activo"}`;
}

/**
 * household-isolation: profile management. Passwords live in the database now,
 * so they can be changed here instead of editing the deploy env.
 */
export function ProfileDialog({ userName, ownerId, nameOf, onClose }: ProfileDialogProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<AccessHistory>([]);

  useEffect(() => {
    let cancelled = false;
    fetchAccessHistory()
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (next !== repeat) {
      setMessage({ tone: "error", text: "Las contraseñas nuevas no coinciden." });
      return;
    }
    if (next.length < 8) {
      setMessage({ tone: "error", text: "La contraseña nueva necesita al menos 8 caracteres." });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      setMessage({ tone: "ok", text: "Contraseña actualizada." });
    } catch (error) {
      const text =
        error instanceof ApiError && error.status === 401
          ? "La contraseña actual no es correcta."
          : "No se pudo cambiar la contraseña. Probá de nuevo.";
      setMessage({ tone: "error", text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Administrar perfil"
        className="w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-ink">Administrar perfil</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {userName} · usuario “{ownerId}”
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-control px-2 py-1 text-sm text-ink-soft transition-colors hover:bg-surface-raised hover:text-ink"
          >
            ✕
          </button>
        </div>

        <form aria-label="Cambiar contraseña" onSubmit={handleSubmit} className="mt-6">
          <h3 className="text-sm font-semibold text-ink">Cambiar contraseña</h3>
          <div className="mt-3">
            <label htmlFor="profile-current" className={LABEL_CLASS}>
              Contraseña actual
            </label>
            <input
              id="profile-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div className="mt-3">
            <label htmlFor="profile-next" className={LABEL_CLASS}>
              Nueva
            </label>
            <input
              id="profile-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div className="mt-3">
            <label htmlFor="profile-repeat" className={LABEL_CLASS}>
              Repetir nueva
            </label>
            <input
              id="profile-repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>

          {message !== null ? (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              className={`mt-3 text-sm font-medium ${
                message.tone === "error" ? "text-danger" : "text-income"
              }`}
            >
              {message.text}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || current === "" || next === "" || repeat === ""}
            className="mt-4 inline-flex items-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-ink">Quién vio mi dashboard</h3>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Nadie pidió acceso todavía.</p>
          ) : (
            <ul aria-label="Historial de accesos" className="mt-2 space-y-1">
              {history.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`} className="text-sm text-ink-soft">
                  {historyLine(entry, nameOf)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
