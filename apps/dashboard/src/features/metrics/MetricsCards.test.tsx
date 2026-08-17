import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ExpenseMonth } from "@rita/contracts";

import { MetricsCards } from "./MetricsCards";

const months: ExpenseMonth[] = [
  { month: "2026-01", count: 2, totalAmount: 1000 },
  { month: "2026-02", count: 3, totalAmount: 1500 },
  { month: "2026-03", count: 5, totalAmount: 2750 },
  { month: "2026-04", count: 1, totalAmount: 450 },
  { month: "2026-05", count: 4, totalAmount: 2200 },
  { month: "2026-06", count: 7, totalAmount: 4200 },
];

describe("MetricsCards", () => {
  it("renders one card per month with count and total amount", () => {
    render(<MetricsCards months={months} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(6);
    expect(cards[0]).toHaveTextContent("2026-01");
    expect(cards[0]).toHaveTextContent("2 expenses");
    expect(cards[0]).toHaveTextContent("Total: 1000");
    expect(cards[2]).toHaveTextContent("2026-03");
    expect(cards[2]).toHaveTextContent("Total: 2750");
    expect(cards[5]).toHaveTextContent("2026-06");
    expect(cards[5]).toHaveTextContent("7 expenses");
    expect(cards[5]).toHaveTextContent("Total: 4200");
  });

  it("orders months ascending even when the API returns them unordered", () => {
    const unordered = [
      months[3]!,
      months[0]!,
      months[5]!,
      months[1]!,
      months[4]!,
      months[2]!,
    ];

    render(<MetricsCards months={unordered} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(6);
    expect(cards[0]).toHaveTextContent("2026-01");
    expect(cards[1]).toHaveTextContent("2026-02");
    expect(cards[2]).toHaveTextContent("2026-03");
    expect(cards[3]).toHaveTextContent("2026-04");
    expect(cards[4]).toHaveTextContent("2026-05");
    expect(cards[5]).toHaveTextContent("2026-06");
  });
});