import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { CategoryBreakdown } from "./CategoryBreakdown";

const categories: MovementSummary["categories"] = [
  { name: "food", expenseAmount: 1000, incomeAmount: 0, expensePercent: 100, incomePercent: 0 },
  { name: "sueldo", expenseAmount: 0, incomeAmount: 2000, expensePercent: 0, incomePercent: 100 },
];

describe("CategoryBreakdown", () => {
  it("renders each category with its expense and income percentages", () => {
    render(<CategoryBreakdown categories={categories} />);

    expect(screen.getByText("Desglose por categoría")).toBeInTheDocument();

    const food = screen.getByText("food");
    expect(food).toBeInTheDocument();
    expect(screen.getByText("Gastos 100%")).toBeInTheDocument();
    expect(screen.getByText("Ingresos 0%")).toBeInTheDocument();

    expect(screen.getByText("sueldo")).toBeInTheDocument();
    expect(screen.getByText("Gastos 0%")).toBeInTheDocument();
    expect(screen.getByText("Ingresos 100%")).toBeInTheDocument();
  });

  it("renders nothing when there are no categories", () => {
    render(<CategoryBreakdown categories={[]} />);

    expect(screen.getByText("Desglose por categoría")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
