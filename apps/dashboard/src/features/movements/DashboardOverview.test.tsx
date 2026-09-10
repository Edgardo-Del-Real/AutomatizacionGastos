import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { ApiError, fetchMovementSummary } from "../../infra/api";
import { DashboardOverview } from "./DashboardOverview";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchMovementSummary: vi.fn(),
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
    { name: "food", expenseAmount: 1000, incomeAmount: 0, expensePercent: 100, incomePercent: 0 },
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

const fetchMovementSummaryMock = vi.mocked(fetchMovementSummary);

afterEach(() => {
  vi.clearAllMocks();
});

describe("DashboardOverview", () => {
  it("shows a Spanish loading state while the summary is pending", () => {
    fetchMovementSummaryMock.mockImplementation(
      () => new Promise<MovementSummary>(() => {}),
    );

    render(<DashboardOverview />);

    expect(screen.getByRole("status")).toHaveTextContent(/cargando/i);
  });

  it("renders every section in order with Spanish labels and es-AR amounts", async () => {
    fetchMovementSummaryMock.mockResolvedValue(summary);

    render(<DashboardOverview />);

    await waitFor(() =>
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0),
    );

    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    const kpiIndex = headings.indexOf("Ingresos");
    const momIndex = headings.indexOf("Comparación mes a mes");
    const dailyIndex = headings.indexOf("Actividad diaria");
    const categoryIndex = headings.indexOf("Desglose por categoría");
    const topIndex = headings.indexOf("Principales movimientos");

    expect(kpiIndex).toBeGreaterThanOrEqual(0);
    expect(momIndex).toBeGreaterThan(kpiIndex);
    expect(dailyIndex).toBeGreaterThan(momIndex);
    expect(categoryIndex).toBeGreaterThan(dailyIndex);
    expect(topIndex).toBeGreaterThan(categoryIndex);

    expect(screen.getAllByText("$ 1.500,00").length).toBeGreaterThan(0);
    expect(screen.getByText("$ 3.000,00")).toBeInTheDocument();
  });

  it("shows a Spanish empty state instead of charts when the summary is empty", async () => {
    fetchMovementSummaryMock.mockResolvedValue(emptySummary);

    render(<DashboardOverview />);

    await waitFor(() =>
      expect(screen.getByText(/no hay movimientos/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Comparación mes a mes")).toBeNull();
  });

  it("shows an error with a retry action and recovers when retried", async () => {
    const user = userEvent.setup();
    fetchMovementSummaryMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(summary);

    render(<DashboardOverview />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar/i);

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() =>
      expect(screen.getByText("Comparación mes a mes")).toBeInTheDocument(),
    );
    expect(fetchMovementSummaryMock).toHaveBeenCalledTimes(2);
  });
});
