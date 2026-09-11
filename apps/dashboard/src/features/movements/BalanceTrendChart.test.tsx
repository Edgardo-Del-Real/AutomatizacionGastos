import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { accumulateBalances } from "./calculations";
import { BalanceTrendChart } from "./BalanceTrendChart";

const daily: MovementSummary["daily"] = [
  { day: "2026-07-01", income: 100, expenses: 50, balance: 50 },
  { day: "2026-07-02", income: 0, expenses: 0, balance: 150 },
  { day: "2026-07-03", income: 0, expenses: 100, balance: -100 },
];

describe("accumulateBalances", () => {
  it("builds the progressive sum of the daily balances", () => {
    expect(accumulateBalances(daily)).toEqual([
      { day: "2026-07-01", accumulated: 50 },
      { day: "2026-07-02", accumulated: 200 },
      { day: "2026-07-03", accumulated: 100 },
    ]);
  });

  it("ends on the total sum of the series", () => {
    const points = accumulateBalances(daily);
    const total = daily.reduce((sum, point) => sum + point.balance, 0);

    expect(points[points.length - 1]!.accumulated).toBe(total);
  });

  it("returns an empty series for an empty daily list", () => {
    expect(accumulateBalances([])).toEqual([]);
  });
});

describe("BalanceTrendChart", () => {
  it("shows the accumulated balance chart with an honest subtitle", () => {
    render(<BalanceTrendChart daily={daily} />);

    expect(
      screen.getByRole("heading", {
        name: "Evolución del saldo acumulado",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Acumulado de los últimos 30 días"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Gráfico del saldo acumulado" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there is no daily data", () => {
    render(<BalanceTrendChart daily={[]} />);

    expect(screen.getByText("Sin datos.")).toBeInTheDocument();
  });
});