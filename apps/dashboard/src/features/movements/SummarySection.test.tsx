import { render, screen, waitFor } from "@testing-library/react";
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

// PENDING-only owner: PENDING is excluded from the mom/daily aggregates by
// design, so an owner whose ONLY movements are planned expenses has empty
// mom/daily but a non-zero planned total.
const plannedOnlySummary: MovementSummary = {
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
  planned: { total: 2500, movements: [] },
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

  it("renders the section content with the loaded summary", async () => {
    renderSection({ status: "success", data: summary });

    expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument();
    // The KPI value animates from 0, so the final figure lands on a later frame.
    await waitFor(() => expect(screen.getByText("$ 3.000,00")).toBeInTheDocument());
  });

  it("shows a Spanish empty state instead of content when the summary is empty", () => {
    renderSection({ status: "success", data: emptySummary });

    expect(screen.getByText(/no hay movimientos/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ingresos" })).toBeNull();
  });

  it("does not show the empty state when only planned expenses exist", () => {
    // mom/daily are empty (PENDING excluded from those aggregates) but
    // planned.total > 0: the gate must NOT lie about the owner being empty.
    renderSection({ status: "success", data: plannedOnlySummary });

    expect(screen.queryByText(/no hay movimientos/i)).toBeNull();
    expect(screen.getByRole("heading", { name: "Ingresos" })).toBeInTheDocument();
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
