import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { TopMovements } from "./TopMovements";

const top: MovementSummary["top"] = {
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
  income: [
    {
      id: "i1",
      ownerId: "default",
      amount: 3000,
      currency: "ARS",
      type: "INCOME",
      category: "sueldo",
      note: "sueldo",
      occurredAt: new Date("2026-07-05T12:00:00Z"),
      createdAt: new Date("2026-07-05T12:00:00Z"),
    },
  ],
};

describe("TopMovements", () => {
  it("renders top expenses and top income with es-AR amounts", () => {
    render(<TopMovements top={top} />);

    expect(screen.getByText("Principales movimientos")).toBeInTheDocument();
    expect(screen.getByText("Top gastos")).toBeInTheDocument();
    expect(screen.getByText("Top ingresos")).toBeInTheDocument();

    expect(screen.getByText("alquiler")).toBeInTheDocument();
    expect(screen.getByText("$ 1.200,00")).toBeInTheDocument();
    expect(screen.getByText("$ 3.000,00")).toBeInTheDocument();
  });

  it("renders empty lists without rows when there is no data", () => {
    render(<TopMovements top={{ expenses: [], income: [] }} />);

    expect(screen.getByText("Principales movimientos")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
