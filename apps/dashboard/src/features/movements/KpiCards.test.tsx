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
};

describe("KpiCards", () => {
  it("renders all seven Spanish KPI labels with es-AR amounts", () => {
    render(<KpiCards kpis={kpis} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);

    expect(screen.getByText("Ingresos")).toBeInTheDocument();
    expect(screen.getByText("Gastos")).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("Promedio mes")).toBeInTheDocument();
    expect(screen.getByText("Promedio por movimiento")).toBeInTheDocument();
    expect(screen.getByText("Máximo")).toBeInTheDocument();
    expect(screen.getByText("Cantidad")).toBeInTheDocument();

    expect(screen.getByText("$ 3.000,00")).toBeInTheDocument();
    // Gastos and Balance are both $ 1.500,00 in the fixture.
    expect(screen.getAllByText("$ 1.500,00")).toHaveLength(2);
    expect(screen.getByText("$ 750,00")).toBeInTheDocument();
    expect(screen.getByText("$ 500,00")).toBeInTheDocument();
    expect(screen.getByText("$ 1.200,00")).toBeInTheDocument();
  });

  it("renders the count as a plain number, not a currency", () => {
    render(<KpiCards kpis={kpis} />);

    expect(screen.getByText("6")).toBeInTheDocument();
  });
});
