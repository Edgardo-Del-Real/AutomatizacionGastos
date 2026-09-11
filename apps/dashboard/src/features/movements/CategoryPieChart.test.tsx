import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MovementSummary } from "@rita/contracts";

import { categoryPieSlices } from "./calculations";
import { CategoryPieChart } from "./CategoryPieChart";

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

const categories: MovementSummary["categories"] = [
  {
    name: "comida",
    expenseAmount: 900,
    incomeAmount: 0,
    expensePercent: 60,
    incomePercent: 0,
  },
  {
    name: "transporte",
    expenseAmount: 600,
    incomeAmount: 0,
    expensePercent: 40,
    incomePercent: 0,
  },
  {
    name: "sin gastos",
    expenseAmount: 0,
    incomeAmount: 0,
    expensePercent: 0,
    incomePercent: 0,
  },
];

describe("categoryPieSlices", () => {
  it("keeps one slice per spending category plus Disponible, summing to income", () => {
    const slices = categoryPieSlices(kpis, categories);

    expect(slices.map((slice) => slice.name)).toEqual([
      "comida",
      "transporte",
      "Disponible",
    ]);
    expect(slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(kpis.income);
  });

  it("drops categories without spending", () => {
    const slices = categoryPieSlices(kpis, categories);

    expect(slices.some((slice) => slice.name === "sin gastos")).toBe(false);
  });

  it("omits the Disponible slice when the balance is not positive", () => {
    const slices = categoryPieSlices({ income: 1500, balance: 0 }, categories);

    expect(slices.map((slice) => slice.name)).toEqual(["comida", "transporte"]);
  });

  it("returns no slices when there is no income", () => {
    expect(categoryPieSlices({ income: 0, balance: 0 }, [])).toEqual([]);
  });
});

describe("CategoryPieChart", () => {
  it("shows the title, subtitle and one legend entry per slice including Disponible", () => {
    render(<CategoryPieChart kpis={kpis} categories={categories} />);

    expect(
      screen.getByRole("heading", { name: "¿Dónde está tu dinero?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Gastos por categoría y dinero disponible"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Gráfico de torta por categorías" }),
    ).toBeInTheDocument();

    const legend = screen.getByRole("list", { name: "Leyenda de categorías" });
    expect(within(legend).getByText("comida")).toBeInTheDocument();
    expect(within(legend).getByText("transporte")).toBeInTheDocument();
    expect(within(legend).getByText("Disponible")).toBeInTheDocument();
    expect(within(legend).queryByText("sin gastos")).toBeNull();
  });

  it("omits the Disponible legend entry when the balance is not positive", () => {
    render(
      <CategoryPieChart kpis={{ ...kpis, balance: -500 }} categories={categories} />,
    );

    expect(screen.queryByText("Disponible")).toBeNull();
  });

  it("shows an empty state when there are no income", () => {
    render(
      <CategoryPieChart kpis={{ ...kpis, income: 0, balance: 0 }} categories={[]} />,
    );

    expect(screen.getByText("Sin datos.")).toBeInTheDocument();
  });

  it("renders legend entries whose amounts add up to the total income", () => {
    render(<CategoryPieChart kpis={kpis} categories={categories} />);

    const items = screen.getAllByTestId("pie-legend-item");
    const total = items.reduce(
      (sum, item) => sum + Number(item.getAttribute("data-value")),
      0,
    );
    expect(total).toBe(kpis.income);
  });
});