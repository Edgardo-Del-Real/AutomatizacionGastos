import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Movement, MovementSummary } from "@rita/contracts";

import { ApiError, fetchMovementSummary, fetchMovements } from "./infra/api";
import App from "./App";

vi.mock("./infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./infra/api")>()),
  fetchMovementSummary: vi.fn(),
  fetchMovements: vi.fn(),
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders every section in order with Spanish labels and es-AR amounts", async () => {
    fetchMovementSummaryMock.mockResolvedValue(summary);
    fetchMovementsMock.mockResolvedValue(movements);

    render(<App />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // Spanish header.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Rita Dashboard",
    );
    expect(screen.getByText("Resumen de ingresos y gastos")).toBeInTheDocument();

    const headings = screen
      .getAllByRole("heading")
      .map((h) => h.textContent ?? "");
    const kpi = headings.indexOf("Ingresos");
    const mom = headings.indexOf("Comparación mes a mes");
    const daily = headings.indexOf("Actividad diaria");
    const category = headings.indexOf("Desglose por categoría");
    const top = headings.indexOf("Principales movimientos");
    const list = headings.indexOf("Movimientos");

    expect(kpi).toBeGreaterThanOrEqual(0);
    expect(mom).toBeGreaterThan(kpi);
    expect(daily).toBeGreaterThan(mom);
    expect(category).toBeGreaterThan(daily);
    expect(top).toBeGreaterThan(category);
    expect(list).toBeGreaterThan(top);

    // es-AR amounts render.
    expect(screen.getAllByText("$ 1.500,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$ 3.000,00").length).toBeGreaterThan(0);
  });

  it("shows a Spanish empty state for an empty summary while the list still renders", async () => {
    fetchMovementSummaryMock.mockResolvedValue(emptySummary);
    fetchMovementsMock.mockResolvedValue(movements);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("No hay movimientos aún.")).toBeInTheDocument(),
    );
    // No partial charts, but the separate list section still renders.
    expect(screen.queryByText("Comparación mes a mes")).toBeNull();
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows a Spanish error with retry for the summary and recovers", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(summary);
    fetchMovementsMock.mockResolvedValue(movements);

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar los indicadores/i);

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() =>
      expect(screen.getByText("Comparación mes a mes")).toBeInTheDocument(),
    );
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces an error state for a malformed summary without crashing or rendering partial data", async () => {
    // A contract mismatch surfaces as a validation ApiError, not partial data.
    fetchMovementSummaryMock.mockRejectedValue(
      new ApiError("validation", { issues: [] }),
    );
    fetchMovementsMock.mockResolvedValue(movements);

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar los indicadores/i);

    // No partial KPI cards / charts render from the malformed payload.
    expect(screen.queryByText("Comparación mes a mes")).toBeNull();
    expect(screen.queryByText("$ 1.500,00")).toBeNull();

    // The independent movement list section still renders.
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
