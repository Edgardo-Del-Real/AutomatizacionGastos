import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { ApiError } from "../../infra/api";
import type { AsyncState } from "./asyncState";
import { KpiCards } from "./KpiCards";
import { SummarySection } from "./SummarySection";

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

function renderSection(state: AsyncState<MovementSummary>) {
  return render(
    <SummarySection state={{ ...state, retry: vi.fn() }}>
      {(data) => <KpiCards kpis={data.kpis} />}
    </SummarySection>,
  );
}

describe("SummarySection", () => {
  it("shows a Spanish loading state while the summary is pending", () => {
    renderSection({ status: "loading" });

    expect(screen.getByRole("status")).toHaveTextContent(/cargando/i);
  });

  it("renders the section content with the loaded summary", () => {
    renderSection({ status: "success", data: summary });

    expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument();
    expect(screen.getByText("$ 3.000,00")).toBeInTheDocument();
  });

  it("shows a Spanish empty state instead of content when the summary is empty", () => {
    renderSection({ status: "success", data: emptySummary });

    expect(screen.getByText(/no hay movimientos/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ingresos" })).toBeNull();
  });

  it("shows an error with a retry action that invokes retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <SummarySection
        state={{ status: "error", error: new ApiError("network"), retry }}
      >
        {(data) => <KpiCards kpis={data.kpis} />}
      </SummarySection>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar los indicadores/i);

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});