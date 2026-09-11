import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { MomChart } from "./MomChart";

const months: MovementSummary["mom"]["months"] = [
  { month: "2026-06", income: 2000, expenses: 1000, balance: 1000 },
  { month: "2026-07", income: 1000, expenses: 500, balance: 1500 },
];

describe("MomChart", () => {
  it("renders the monthly balance chart for consecutive months", () => {
    render(<MomChart months={months} />);

    expect(screen.getByText("Comparación mes a mes")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Gráfico de balance mensual" }),
    ).toBeInTheDocument();
  });

  it("renders the chart when the balance drops between months", () => {
    const dropping = [
      { month: "2026-06", income: 2000, expenses: 1000, balance: 1000 },
      { month: "2026-07", income: 0, expenses: 1500, balance: -500 },
    ];
    render(<MomChart months={dropping} />);

    expect(
      screen.getByRole("img", { name: "Gráfico de balance mensual" }),
    ).toBeInTheDocument();
  });
});