import { useEffect, useRef, useState } from "react";

type ProfileMenuProps = {
  /** Name of the logged-in person. */
  userName: string;
  /** Name of the person whose dashboard is being viewed, or null. */
  viewingName: string | null;
  /** The other member of the household, or null in single-user mode. */
  partnerName: string | null;
  /** ISO expiry of the active grant. */
  grantExpiresAt: string | null;
  /** True while the other person has not answered yet. */
  waiting: boolean;
  onRequestAccess: () => void;
  onRevoke: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
};

const BUTTON_CLASS =
  "rounded-control border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60";

function clockLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

/**
 * household-isolation: the header used to carry a month selector, a visibility
 * selector and a logout button. Identity and access actions live here now, so
 * the header stays at three items: brand, month, you.
 */
export function ProfileMenu({
  userName,
  viewingName,
  partnerName,
  grantExpiresAt,
  waiting,
  onRequestAccess,
  onRevoke,
  onOpenProfile,
  onLogout,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const viewing = viewingName !== null;
  const label = viewing ? `${userName} · viendo a ${viewingName}` : userName;

  function close(action: () => void) {
    return () => {
      setOpen(false);
      action();
    };
  }

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`${BUTTON_CLASS} ${viewing ? "border-accent/40 text-accent" : ""}`}
      >
        <span aria-hidden="true">{viewing ? "👁 " : ""}</span>
        {label}
        <span aria-hidden="true" className="ml-1 text-ink-faint">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default bg-transparent"
          />
          <div
            role="menu"
            aria-label="Perfil"
            className="absolute right-0 top-full z-20 mt-2 flex w-64 flex-col gap-1 rounded-control border border-border bg-surface p-1.5 shadow-card"
          >
            {viewing ? (
              <>
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-ink">
                    Estás viendo el dashboard de {viewingName}
                  </p>
                  {grantExpiresAt !== null ? (
                    <p className="mt-0.5 text-xs text-ink-soft">
                      Se cierra a las {clockLabel(grantExpiresAt)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={close(onRevoke)}
                  className={ITEM_CLASS}
                >
                  Volver a mi dashboard
                </button>
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={waiting || partnerName === null}
                onClick={close(onRequestAccess)}
                className={ITEM_CLASS}
              >
                {waiting
                  ? `Esperando que ${partnerName ?? "la otra persona"} responda…`
                  : `Ver el dashboard de ${partnerName ?? "la otra persona"}`}
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={close(onOpenProfile)}
              className={ITEM_CLASS}
            >
              <span aria-hidden="true">⚙️</span> Administrar perfil
            </button>

            <div className="my-1 border-t border-border" role="separator" />

            <button type="button" role="menuitem" onClick={close(onLogout)} className={ITEM_CLASS}>
              Salir
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
