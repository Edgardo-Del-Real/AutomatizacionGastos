import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { KpiCards } from "./KpiCards";

const kpis: MovementSummary["kpis"] = {
  income: 3000,
  expenses: 1500,
  balance: 1500,
  avgPerMonth: 750,
  avgPerMovement: 500,
  maxAmount: 1200,
  count: 6,
  countThisMonth: 2,
};

describe("KpiCards", () => {
  it("renders the four Spanish KPI cards with es-AR amounts", () => {
    render(<KpiCards kpis={kpis} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);

    expect(screen.getByText("Ingresos")).toBeInTheDocument();
    expect(screen.getByText("Gastos")).toBeInTheDocument();
    expect(screen.getByText("Dinero restante")).toBeInTheDocument();
    expect(screen.getByText("Movimientos del mes")).toBeInTheDocument();

    expect(screen.getByText("$ 3.000,00")).toBeInTheDocument();
    // Gastos and Dinero restante are both $ 1.500,00 in the fixture.
    expect(screen.getAllByText("$ 1.500,00")).toHaveLength(2);
  });

  it("omits the averages and the max card", () => {
    render(<KpiCards kpis={kpis} />);

    expect(screen.queryByText("Promedio mes")).toBeNull();
    expect(screen.queryByText("Promedio por movimiento")).toBeNull();
    expect(screen.queryByText("Máximo")).toBeNull();
    expect(screen.queryByText("Cantidad")).toBeNull();
    expect(screen.queryByText("$ 750,00")).toBeNull();
    expect(screen.queryByText("$ 500,00")).toBeNull();
    expect(screen.queryByText("$ 1.200,00")).toBeNull();
  });

  it("renders the current-month count as a plain number, not a currency", () => {
    render(<KpiCards kpis={kpis} />);

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("$ 2,00")).toBeNull();
  });
});