import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { DailyChart } from "./DailyChart";

const daily: MovementSummary["daily"] = [
  { day: "2026-07-01", income: 100, expenses: 50, balance: 50 },
  { day: "2026-07-02", income: 0, expenses: 0, balance: 150 },
  { day: "2026-07-03", income: 0, expenses: 100, balance: -100 },
];

describe("DailyChart", () => {
  it("shows the last-30-days chart heading and the es-AR daily average", () => {
    render(<DailyChart daily={daily} />);

    expect(screen.getByText("Actividad diaria")).toBeInTheDocument();
    // Average of (50, 150, -100) = 100 / 3 = 33.33 -> es-AR "$ 33,33".
    expect(screen.getByText(/Promedio diario/)).toBeInTheDocument();
    expect(screen.getByText("$ 33,33")).toBeInTheDocument();
  });

  it("shows a zero daily average for an empty series", () => {
    render(<DailyChart daily={[]} />);

    expect(screen.getByText("$ 0,00")).toBeInTheDocument();
  });
});
