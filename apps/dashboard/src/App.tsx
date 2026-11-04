import { useCallback, useState } from "react";

import type { VisibilityFilter } from "@rita/contracts";

import { ProfileDialog } from "./features/access/ProfileDialog";
import { ProfileMenu } from "./features/access/ProfileMenu";
import { useAccess } from "./features/access/useAccess";
import type { UseAccess } from "./features/access/useAccess";
import { LoginForm } from "./features/auth/LoginForm";
import { useSession } from "./features/auth/useSession";
import { ViewerProvider, useViewer } from "./features/household/ViewerContext";
import { BalanceTrendChart } from "./features/movements/BalanceTrendChart";
import { CategoryCards } from "./features/movements/CategoryCards";
import { CategoryPieChart } from "./features/movements/CategoryPieChart";
import { KpiCards } from "./features/movements/KpiCards";
import { MonthSelector } from "./features/movements/MonthSelector";
import { MovementList } from "./features/movements/MovementList";
import { PlannedSection } from "./features/movements/PlannedSection";
import { SummarySection } from "./features/movements/SummarySection";
import { useMovementSummary } from "./features/movements/useMovementSummary";
import { useSelectedMonth } from "./features/movements/useSelectedMonth";

type DashboardSection = "kpis" | "charts" | "movements";

const SECTIONS: ReadonlyArray<{ id: DashboardSection; label: string }> = [
  { id: "kpis", label: "KPIs" },
  { id: "charts", label: "Gráficos" },
  { id: "movements", label: "Movimientos" },
];

const NAV_BUTTON_CLASS =
  "rounded-full border border-transparent px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
const NAV_ACTIVE_CLASS = "border-accent/20 bg-accent-soft text-accent";
const NAV_IDLE_CLASS = "text-ink-soft hover:bg-surface-raised hover:text-ink";

function clockLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

type DashboardProps = {
  session: { ownerId: string; name: string };
  access: UseAccess;
  onLogout: () => void;
};

function Dashboard({ session, access, onLogout }: DashboardProps) {
  // The viewer is the session owner, unless a live grant lets us read the
  // other person's dashboard (household-isolation).
  const { viewerId, members } = useViewer();
  const partner = members.find((member) => member.ownerId !== session.ownerId) ?? null;
  const viewingName =
    access.viewAs === null
      ? null
      : (members.find((member) => member.ownerId === access.viewAs)?.name ?? access.viewAs);

  // Single App-level refresh token (D11): bumping it re-fetches both the
  // movement list and the summary in place after any successful mutation.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  // Hoisted visibility filter (AD8): one state drives BOTH the summary and the
  // list requests so the charts and the table always agree.
  const [visibility, setVisibility] = useState<VisibilityFilter>("mine");

  const [activeSection, setActiveSection] = useState<DashboardSection>("kpis");
  // Tab switching used to unmount the hidden sections, so every visit to
  // "Movimientos" refetched the whole list. A section mounts the first time it
  // is opened and stays alive (hidden) afterwards: coming back is instant and
  // the list keeps its filters.
  const [mountedSections, setMountedSections] = useState<ReadonlySet<DashboardSection>>(
    () => new Set<DashboardSection>(["kpis"]),
  );
  const [profileOpen, setProfileOpen] = useState(false);
  // monthly-dashboard: ONE month for the whole dashboard, backed by the URL so
  // it survives a reload and a shared link. Every section reads it from here.
  const { month, setMonth } = useSelectedMonth();
  const summaryState = useMovementSummary(viewerId, month, visibility, refreshKey);

  const changeSection = useCallback((next: DashboardSection) => {
    setActiveSection(next);
    setMountedSections((current) => {
      if (current.has(next)) return current;
      const grown = new Set(current);
      grown.add(next);
      return grown;
    });
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <main className="min-h-screen bg-canvas text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-border bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent shadow-card"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-5 w-5 text-on-accent"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-ink sm:text-xl">
                  Rita
                </h1>
                <p className="text-xs text-ink-soft sm:text-sm">
                  Tus finanzas, en orden
                </p>
              </div>
            </div>
            <MonthSelector month={month} onChange={setMonth} />
            <ProfileMenu
              userName={session.name}
              viewingName={viewingName}
              partnerName={partner?.name ?? null}
              grantExpiresAt={access.status?.grant?.expiresAt ?? null}
              waiting={access.waiting}
              onRequestAccess={() => void access.request()}
              onRevoke={() => void access.revoke()}
              onOpenProfile={() => setProfileOpen(true)}
              onLogout={onLogout}
            />
            <nav
              aria-label="Secciones del dashboard"
              className="flex flex-wrap items-center gap-1.5"
            >
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-current={
                    activeSection === section.id ? "page" : undefined
                  }
                  onClick={() => changeSection(section.id)}
                  className={`${NAV_BUTTON_CLASS} ${
                    activeSection === section.id
                      ? NAV_ACTIVE_CLASS
                      : NAV_IDLE_CLASS
                  }`}
                >
                  {section.id === "kpis" ? "Resumen" : section.id === "charts" ? "Análisis" : section.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
        {viewingName !== null ? (
          <div
            role="status"
            className="border-t border-accent/30 bg-accent-soft px-4 py-2 text-center text-sm font-medium text-accent sm:px-6"
          >
            Estás viendo el dashboard de {viewingName}
            {access.status?.grant?.expiresAt !== undefined
              ? ` · se cierra a las ${clockLabel(access.status.grant.expiresAt)}`
              : ""}
            {" · "}
            <button
              type="button"
              onClick={() => void access.revoke()}
              className="underline underline-offset-2 hover:no-underline"
            >
              Volver al mío
            </button>
          </div>
        ) : null}
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {access.waiting ? (
          <p role="status" className="mb-6 rounded-card border border-dashed border-border bg-surface p-3 text-center text-sm text-ink-soft">
            Esperando que {partner?.name ?? "la otra persona"} responda en Telegram…
          </p>
        ) : null}
        {mountedSections.has("kpis") && (
          <div hidden={activeSection !== "kpis"} className="space-y-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
                Resumen financiero
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                {viewingName === null
                  ? "Tomá el control de tu mes."
                  : `El mes de ${viewingName}.`}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                {viewingName === null
                  ? "Una vista simple de lo que entra, lo que sale y lo que estás construyendo."
                  : "Estás mirando su dashboard en modo lectura: no podés editar ni borrar nada."}
              </p>
            </div>
            <SummarySection state={summaryState} month={month}>
              {(data) => (
                <>
                  <KpiCards kpis={data.kpis} />
                  {/* D9: the planned expenses section sits immediately after
                      the KPI cards. Its form and total share one refresh token.
                      The SummarySection emptiness predicate accounts for
                      planned.total, so a PENDING-only owner (empty mom/daily
                      but planned.total > 0) never collapses to the empty state
                      and the planned total + form stay visible. */}
                  <PlannedSection
                    planned={data.planned}
                    refreshToken={refreshKey}
                    onMutated={bumpRefresh}
                  />
                  <CategoryCards
                    categories={data.categories}
                    refreshToken={refreshKey}
                  />
                </>
              )}
            </SummarySection>
          </div>
        )}
        {mountedSections.has("charts") && (
          <div hidden={activeSection !== "charts"}>
            <SummarySection state={summaryState} month={month}>
              {(data) => (
                <div className="space-y-6">
                  <CategoryPieChart kpis={data.kpis} categories={data.categories} />
                  <BalanceTrendChart daily={data.daily} />
                </div>
              )}
            </SummarySection>
          </div>
        )}
        {mountedSections.has("movements") && (
          <div hidden={activeSection !== "movements"}>
            <MovementList
              month={month}
              refreshToken={refreshKey}
              onMutated={bumpRefresh}
              visibility={visibility}
              onVisibilityChange={setVisibility}
            />
          </div>
        )}
      </div>
      {profileOpen ? (
        <ProfileDialog
          userName={session.name}
          ownerId={session.ownerId}
          nameOf={(ownerId) =>
            members.find((member) => member.ownerId === ownerId)?.name ?? ownerId
          }
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </main>
  );
}

export default function App() {
  const session = useSession();
  const authenticated = session.state.status === "authenticated";
  const access = useAccess(authenticated);

  if (session.state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-ink antialiased">
        <p role="status" className="text-sm text-ink-soft">
          Cargando…
        </p>
      </main>
    );
  }

  if (session.state.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-ink antialiased">
        <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6 text-center shadow-card">
          <p role="alert" className="text-sm font-medium text-danger">
            No se pudo conectar con el servidor.
          </p>
          <button
            type="button"
            onClick={session.retry}
            className="mt-4 inline-flex items-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  if (session.state.status === "anonymous") {
    return (
      <LoginForm
        onLogin={session.login}
        error={session.error}
        busy={session.busy}
      />
    );
  }

  const effectiveOwnerId = access.viewAs ?? session.state.ownerId;

  return (
    <ViewerProvider ownerId={effectiveOwnerId}>
      <Dashboard
        session={{ ownerId: session.state.ownerId, name: session.state.name }}
        access={access}
        onLogout={session.logout}
      />
    </ViewerProvider>
  );
}
