import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Movement, MovementSummary } from "@rita/contracts";

import {
  ApiError,
  deleteMovement,
  fetchCategories,
  fetchHouseholdMembers,
  fetchMovementSummary,
  fetchMovements,
  fetchSession,
  login,
  logout,
  patchMovement,
} from "./infra/api";
import { currentBaMonth, monthLabel } from "./infra/month";
import App from "./App";

vi.mock("./infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./infra/api")>()),
  fetchMovementSummary: vi.fn(),
  fetchMovements: vi.fn(),
  fetchCategories: vi.fn(),
  fetchHouseholdMembers: vi.fn(),
  fetchSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  patchMovement: vi.fn(),
  deleteMovement: vi.fn(),
}));

const summary: MovementSummary = {
  kpis: {
    income: 3000,
    expenses: 1500,
    balance: 1500,
    savings: 0,
    manualSavings: 0,
    avgPerMonth: 750,
    avgPerMovement: 500,
    maxAmount: 1200,
    count: 6,
  },
  daily: [
    { day: "2026-07-01", income: 100, expenses: 50, balance: 50 },
    { day: "2026-07-02", income: 0, expenses: 0, balance: 150 },
  ],
  categories: [
    {
      name: "food",
      expenseAmount: 1000,
      incomeAmount: 0,
      expensePercent: 100,
      incomePercent: 0,
    },
  ],
  top: {
    expenses: [
      {
        id: "e1",
        ownerId: "default",
        amount: 1200,
        currency: "ARS",
        type: "EXPENSE",
        category: "alquiler",
        note: null,
        occurredAt: new Date("2026-07-01T12:00:00Z"),
        createdAt: new Date("2026-07-01T12:00:00Z"),
      },
    ],
    income: [],
  },
  planned: { total: 0, movements: [] },
};

const emptySummary: MovementSummary = {
  kpis: {
    income: 0,
    expenses: 0,
    balance: 0,
    savings: 0,
    manualSavings: 0,
    avgPerMonth: 0,
    avgPerMovement: 0,
    maxAmount: 0,
    count: 0,
  },
  daily: [],
  categories: [],
  top: { expenses: [], income: [] },
  planned: { total: 0, movements: [] },
};

const movements: Movement[] = [
  {
    id: "i1",
    ownerId: "default",
    amount: 3000,
    currency: "ARS",
    type: "INCOME",
    category: "sueldo",
    note: "sueldo",
    occurredAt: new Date("2026-08-10T12:00:00Z"),
    createdAt: new Date("2026-08-10T12:00:00Z"),
  },
  {
    id: "e1",
    ownerId: "default",
    amount: 1200,
    currency: "ARS",
    type: "EXPENSE",
    category: "alquiler",
    note: null,
    occurredAt: new Date("2026-08-09T12:00:00Z"),
    createdAt: new Date("2026-08-09T12:00:00Z"),
  },
];

const fetchMovementSummaryMock = vi.mocked(fetchMovementSummary);
const fetchMovementsMock = vi.mocked(fetchMovements);
const fetchCategoriesMock = vi.mocked(fetchCategories);
const fetchHouseholdMembersMock = vi.mocked(fetchHouseholdMembers);
const fetchSessionMock = vi.mocked(fetchSession);
const loginMock = vi.mocked(login);
const logoutMock = vi.mocked(logout);
const patchMovementMock = vi.mocked(patchMovement);
const deleteMovementMock = vi.mocked(deleteMovement);


/**
 * online-access: the dashboard mounts only after the session fetch resolves, so
 * every test that expects the app shell must wait for the nav to appear.
 */
async function renderApp() {
  render(<App />);
  await screen.findByRole("button", { name: "Movimientos" });
}

beforeEach(() => {
  // Single-member household: existing tests keep the fixed "default" viewer.
  fetchHouseholdMembersMock.mockResolvedValue([
    { ownerId: "default", name: "Rita" },
  ]);
  // monthly-dashboard: the selected month lives in the URL, so every test must
  // start from a clean one or the previous test's ?mes= would leak.
  window.history.replaceState({}, "", "/");
  // online-access: a logged-in session by default; the gate has its own tests.
  fetchSessionMock.mockResolvedValue({ ownerId: "default" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders a section navigation with four buttons and shows KPIs by default", async () => {
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();

    // Spanish header.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rita");
    expect(screen.getByText("Tus finanzas, en orden")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", {
      name: "Secciones del dashboard",
    });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Resumen",
      "Análisis",
      "Movimientos",
    ]);
    expect(screen.getByRole("button", { name: "Resumen" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  // monthly-dashboard: one month drives the whole dashboard, and it lives in
  // the URL so a reload or a shared link keeps the period.
  it("opens on the current Buenos Aires month when the URL has no mes", async () => {
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();

    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "default",
        currentBaMonth(),
        "mine",
      ),
    );
    expect(
      (screen.getByLabelText(/Mes seleccionado/) as HTMLInputElement).value,
    ).toBe(currentBaMonth());
  });

  it("opens on the month in the URL", async () => {
    window.history.replaceState({}, "", "/?mes=2026-09");
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();

    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "default",
        "2026-09",
        "mine",
      ),
    );
  });

  it("falls back to the current month when the URL key is malformed", async () => {
    window.history.replaceState({}, "", "/?mes=2026-13");
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();

    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "default",
        currentBaMonth(),
        "mine",
      ),
    );
  });

  it("moves the KPIs and the list together when the month changes, and stores it in the URL", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Movimientos" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Mes seleccionado/), {
      target: { value: "2026-10" },
    });

    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "default",
        "2026-10",
        "mine",
      ),
    );
    await waitFor(() =>
      expect(fetchMovementsMock).toHaveBeenLastCalledWith(
        "default",
        { month: "2026-10" },
        "mine",
      ),
    );
    expect(window.location.search).toBe("?mes=2026-10");
  });

  it("steps to the previous month with the arrow", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Mes anterior" }));

    await waitFor(() =>
      expect(window.location.search).toMatch(/^\?mes=\d{4}-\d{2}$/),
    );
    expect(window.location.search).not.toBe(`?mes=${currentBaMonth()}`);
  });

  it("shows only the charts section when Análisis is selected", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Análisis" }));

    expect(
      screen.getByRole("heading", { name: "¿Dónde está tu dinero?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Evolución del saldo acumulado",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ingresos" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Análisis" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows the movement list (with its own fetch) when Movimientos is selected", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(1);
    expect(fetchMovementsMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Movimientos" }));

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(fetchMovementsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Movimientos" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ingresos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Movimientos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows a Spanish empty state for an empty summary in the default section", async () => {
    fetchMovementSummaryMock.mockResolvedValue(emptySummary);
    fetchMovementsMock.mockResolvedValue(movements);

    await renderApp();

    await waitFor(() =>
      expect(
        screen.getByText(`No hay movimientos en ${monthLabel(currentBaMonth())}.`),
      ).toBeInTheDocument(),
    );
    // No partial charts and the list section is not mounted.
    expect(screen.queryByText("¿Dónde está tu dinero?")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a Spanish error with retry for the summary and recovers", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(summary);
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar los indicadores/i);

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument(),
    );
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces an error state for a malformed summary without rendering partial data", async () => {
    const user = userEvent.setup();
    // A contract mismatch surfaces as a validation ApiError, not partial data.
    fetchMovementSummaryMock.mockRejectedValue(
      new ApiError("validation", { issues: [] }),
    );
    fetchMovementsMock.mockResolvedValue(movements);

    await renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar los indicadores/i);

    // No partial KPI cards / charts render from the malformed payload.
    expect(screen.queryByRole("heading", { name: "Ingresos" })).toBeNull();
    expect(screen.queryByText("¿Dónde está tu dinero?")).toBeNull();
    expect(screen.queryByText("$ 1.500,00")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    // The independent movement list section is still reachable via navigation.
    await user.click(screen.getByRole("button", { name: "Movimientos" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("refreshes the list and the summary in place after a confirmed delete", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);
    deleteMovementMock.mockResolvedValue(undefined);

    await renderApp();
    await user.click(screen.getByRole("button", { name: "Movimientos" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(fetchMovementsMock).toHaveBeenCalledTimes(1);
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(1);

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(
      firstRow.getByRole("button", { name: "Abrir acciones del movimiento" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "Acciones del movimiento" })).getByRole(
        "button",
        { name: /eliminar/i },
      ),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /eliminar/i,
      }),
    );

    await waitFor(() =>
      expect(deleteMovementMock).toHaveBeenCalledWith("i1", "default"),
    );
    await waitFor(() => expect(fetchMovementsMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refreshes the list and the summary after an edit is saved", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([{ name: "sueldo", keywords: [] }]);
    patchMovementMock.mockResolvedValue(movements[0]!);

    await renderApp();
    await user.click(screen.getByRole("button", { name: "Movimientos" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(
      firstRow.getByRole("button", { name: "Abrir acciones del movimiento" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "Acciones del movimiento" })).getByRole(
        "button",
        { name: /editar/i },
      ),
    );
    const form = await screen.findByRole("form", { name: "Editar movimiento" });
    await user.clear(within(form).getByLabelText("Nota"));
    await user.type(within(form).getByLabelText("Nota"), "sueldo agosto");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(patchMovementMock).toHaveBeenCalledWith("i1", "default", {
        note: "sueldo agosto",
      }),
    );
    await waitFor(() => expect(fetchMovementsMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(2),
    );
  });

  it("the hoisted visibility filter re-queries the list and the summary together", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();
    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "default",
        expect.any(String),
        "mine",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Movimientos" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Visibilidad"), "shared");

    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "default",
        expect.any(String),
        "shared",
      ),
    );
    await waitFor(() =>
      expect(fetchMovementsMock).toHaveBeenLastCalledWith(
        "default",
        { month: expect.any(String) },

        "shared",
      ),
    );

    await user.click(screen.getByRole("button", { name: /limpiar/i }));

    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "default",
        expect.any(String),
        "mine",
      ),
    );
    await waitFor(() =>
      expect(fetchMovementsMock).toHaveBeenLastCalledWith("default", { month: expect.any(String) }, "mine"),
    );
  });

  it("renders the planned section after the KPI cards in the kpis tab", async () => {
    fetchMovementSummaryMock.mockResolvedValue({
      ...summary,
      planned: { total: 4000, movements: [] },
    });
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();

    const kpisHeading = await screen.findByRole("heading", {
      name: "Ingresos",
    });
    const plannedHeading = screen.getByRole("heading", {
      name: "Gastos fijos previstos",
    });

    // D9: the planned section renders immediately after the KPI cards (the
    // KPI heading precedes the planned heading in document order).
    expect(
      plannedHeading.compareDocumentPosition(kpisHeading) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(screen.getByText("Pendientes — se suman al mes en que los pagues.")).toBeInTheDocument();
    expect(screen.getByText("$ 4.000,00")).toBeInTheDocument();
  });

  it("always shows the planned section for a PENDING-only summary", async () => {
    // First-day usage path: the owner's only movements are planned expenses,
    // so mom/daily are empty (PENDING is excluded from those aggregates) but
    // planned.total > 0. The planned total must stay visible; the KPI area may
    // render its empty state or the zeroed cards — either way the planned
    // section is present below it.
    fetchMovementSummaryMock.mockResolvedValue({
      ...emptySummary,
      planned: { total: 4000, movements: [] },
    });
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);

    await renderApp();

    expect(
      await screen.findByRole("heading", { name: "Gastos fijos previstos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pendientes — se suman al mes en que los pagues.")).toBeInTheDocument();
    expect(screen.getByText("$ 4.000,00")).toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "Agregar previsto" }),
    ).toBeInTheDocument();
  });
});

describe("App login gate", () => {
  it("shows the login form without a session and enters after login", async () => {
    const user = userEvent.setup();
    fetchSessionMock.mockResolvedValueOnce(null);
    loginMock.mockResolvedValue({ ownerId: "rita" });
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    render(<App />);

    const form = await screen.findByRole("form", { name: "Ingresar" });
    expect(screen.queryByRole("button", { name: "Movimientos" })).toBeNull();

    await user.type(within(form).getByLabelText("Contraseña"), "clave-rita");
    await user.click(within(form).getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("default", "clave-rita"));
    await screen.findByRole("button", { name: "Movimientos" });
    await waitFor(() =>
      expect(fetchMovementSummaryMock).toHaveBeenLastCalledWith(
        "rita",
        expect.any(String),
        "mine",
      ),
    );
  });

  it("keeps the form open with a Spanish error on bad credentials", async () => {
    const user = userEvent.setup();
    fetchSessionMock.mockResolvedValueOnce(null);
    loginMock.mockRejectedValue(new ApiError("http", { status: 401 }));

    render(<App />);

    const form = await screen.findByRole("form", { name: "Ingresar" });
    await user.type(within(form).getByLabelText("Contraseña"), "mal");
    await user.click(within(form).getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /usuario o contraseña incorrectos/i,
    );
    expect(screen.queryByRole("button", { name: "Movimientos" })).toBeNull();
  });

  it("returns to the form after logging out", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);
    logoutMock.mockResolvedValue(undefined);

    await renderApp();
    await user.click(screen.getByRole("button", { name: "Salir" }));

    expect(await screen.findByRole("form", { name: "Ingresar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Movimientos" })).toBeNull();
  });
});
