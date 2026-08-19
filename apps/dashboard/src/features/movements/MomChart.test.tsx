import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { MomChart } from "./MomChart";

const months: MovementSummary["mom"]["months"] = [
  { month: "2026-06", income: 2000, expenses: 1000, balance: 1000 },
  { month: "2026-07", income: 1000, expenses: 500, balance: 1500 },
];

describe("MomChart", () => {
  it("shows the percentage change between consecutive months in Spanish", () => {
    render(<MomChart months={months} />);

    expect(screen.getByText("Comparación mes a mes")).toBeInTheDocument();
    // From June (1000) to July (1500) is a +50% balance change.
    expect(screen.getByText(/\+50\.0%/)).toBeInTheDocument();
  });

  it("shows a negative delta when the balance drops", () => {
    const dropping = [
      { month: "2026-06", income: 2000, expenses: 1000, balance: 1000 },
      { month: "2026-07", income: 0, expenses: 1500, balance: -500 },
    ];
    render(<MomChart months={dropping} />);

    // From 1000 to -500 is a -150% change.
    expect(screen.getByText(/-150\.0%/)).toBeInTheDocument();
  });
});
