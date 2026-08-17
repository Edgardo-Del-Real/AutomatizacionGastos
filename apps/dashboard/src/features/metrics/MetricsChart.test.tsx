import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ExpenseMonth } from "@rita/contracts";

import { MetricsChart } from "./MetricsChart";

const months: ExpenseMonth[] = [
  { month: "2026-01", count: 2, totalAmount: 1000 },
  { month: "2026-02", count: 3, totalAmount: 1500 },
  { month: "2026-03", count: 5, totalAmount: 2750 },
  { month: "2026-04", count: 1, totalAmount: 450 },
  { month: "2026-05", count: 4, totalAmount: 2200 },
  { month: "2026-06", count: 7, totalAmount: 4200 },
];

describe("MetricsChart", () => {
  it("renders a bar chart with one bar per month for count and totalAmount", () => {
    const { container } = render(<MetricsChart months={months} />);

    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    // Two bars per month: count and totalAmount.
    expect(container.querySelectorAll(".recharts-rectangle")).toHaveLength(12);
  });

  it("labels the x-axis with months in ascending order", () => {
    const unordered = [
      months[3]!,
      months[0]!,
      months[5]!,
      months[1]!,
      months[4]!,
      months[2]!,
    ];

    const { container } = render(<MetricsChart months={unordered} />);

    const tickLabels = Array.from(
      container.querySelectorAll(
        ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
      ),
    ).map((el) => el.textContent);

    expect(tickLabels).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("exposes an accessible label describing the chart", () => {
    render(<MetricsChart months={months} />);

    expect(screen.getByLabelText(/monthly expense/i)).toBeInTheDocument();
  });
});