import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Movement, MovementSummary } from "@rita/contracts";

import {
  ApiError,
  deleteMovement,
  fetchCategories,
  fetchMovementSummary,
  fetchMovements,
  patchMovement,
} from "./infra/api";
import App from "./App";

vi.mock("./infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./infra/api")>()),
  fetchMovementSummary: vi.fn(),
  fetchMovements: vi.fn(),
  fetchCategories: vi.fn(),
  patchMovement: vi.fn(),
  deleteMovement: vi.fn(),
}));

const summary: MovementSummary = {
  kpis: {
    income: 3000,
    expenses: 1500,
    balance: 1500,
    avgPerMonth: 750,
    avgPerMovement: 500,
    maxAmount: 1200,
    count: 6,
    countThisMonth: 2,
  },
  mom: {
    months: [
      { month: "2026-06", income: 2000, expenses: 1000, balance: 1000 },
      { month: "2026-07", income: 1000, expenses: 500, balance: 1500 },
    ],
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
};

const emptySummary: MovementSummary = {
  kpis: {
    income: 0,
    expenses: 0,
    balance: 0,
    avgPerMonth: 0,
    avgPerMovement: 0,
    maxAmount: 0,
    count: 0,
    countThisMonth: 0,
  },
  mom: { months: [] },
  daily: [],
  categories: [],
  top: { expenses: [], income: [] },
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
const patchMovementMock = vi.mocked(patchMovement);
const deleteMovementMock = vi.mocked(deleteMovement);

afterEach(() => {
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders a section navigation with four buttons and shows KPIs by default", async () => {
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    render(<App />);

    // Spanish header.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Rita Dashboard",
    );
    expect(screen.getByText("Resumen de ingresos y gastos")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", {
      name: "Secciones del dashboard",
    });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "KPIs",
      "Gráficos",
      "Movimientos",
    ]);
    expect(screen.getByRole("button", { name: "KPIs" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "Principales movimientos" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows only the charts section when Gráficos is selected", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchCategoriesMock.mockResolvedValue([]);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Gráficos" }));

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
    expect(screen.getByRole("button", { name: "Gráficos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows the movement list (with its own fetch) when Movimientos is selected", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);

    render(<App />);
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

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("No hay movimientos aún.")).toBeInTheDocument(),
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

    render(<App />);

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

    render(<App />);

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

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Movimientos" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(fetchMovementsMock).toHaveBeenCalledTimes(1);
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(1);

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(firstRow.getByRole("button", { name: /eliminar/i }));
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

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Movimientos" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(firstRow.getByRole("button", { name: /editar/i }));
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
});