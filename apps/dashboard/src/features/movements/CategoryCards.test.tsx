import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MovementSummary, OwnerCategory } from "@rita/contracts";

import { ApiError } from "../../infra/api";
import { CategoryCards } from "./CategoryCards";
import { useCategories } from "./useCategories";

vi.mock("./useCategories");

const useCategoriesMock = vi.mocked(useCategories);

const summaryCategories: MovementSummary["categories"] = [
  {
    name: "carnicería",
    expenseAmount: 1200,
    incomeAmount: 0,
    expensePercent: 100,
    incomePercent: 0,
  },
  {
    name: "verdulería",
    expenseAmount: 0,
    incomeAmount: 0,
    expensePercent: 0,
    incomePercent: 0,
  },
  {
    name: "Sueldos",
    expenseAmount: 0,
    incomeAmount: 137700,
    expensePercent: 0,
    incomePercent: 100,
  },
];

const allCategories: OwnerCategory[] = [
  { name: "carnicería", keywords: [], type: "EXPENSE" },
  { name: "verdulería", keywords: [], type: "MIXED" },
  { name: "farmacia", keywords: [], type: "MIXED" },
  { name: "Sueldos", keywords: [], type: "INCOME" },
];

function mockSuccess(ownerCategories: OwnerCategory[]) {
  useCategoriesMock.mockReturnValue({
    status: "success",
    data: ownerCategories,
    retry: vi.fn(),
  });
}

describe("CategoryCards", () => {
  it("renders cards for created non-savings categories, merging the summary", () => {
    mockSuccess(allCategories);

    render(<CategoryCards categories={summaryCategories} />);

    expect(
      screen.getByRole("heading", { name: "Movimientos por categoría" }),
    ).toBeInTheDocument();

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(4);

    expect(
      within(cards[0]!).getByRole("heading", { name: "carnicería" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$ 1.200,00")).toBeInTheDocument();

    // A created category with no movements still renders with $ 0,00.
    expect(
      within(cards[2]!).getByRole("heading", { name: "farmacia" }),
    ).toBeInTheDocument();
    // verdulería and farmacia both show $ 0,00.
    expect(screen.getAllByText("$ 0,00")).toHaveLength(2);
    expect(within(cards[3]!).getByText("$ 137.700,00")).toBeInTheDocument();
  });

  it("renders no cards when the owner has no created categories", () => {
    mockSuccess([]);

    render(<CategoryCards categories={summaryCategories} />);

    expect(
      screen.getByRole("heading", { name: "Movimientos por categoría" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("does not duplicate the reserved savings KPI as a category card", () => {
    mockSuccess([{ name: "ahorro", keywords: [], type: "SAVINGS" }]);

    render(<CategoryCards categories={[]} />);

    expect(screen.queryByText("$ 15.300,00")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows a Spanish loading state while categories are pending", () => {
    useCategoriesMock.mockReturnValue({ status: "loading", retry: vi.fn() });

    render(<CategoryCards categories={summaryCategories} />);

    expect(screen.getByRole("status")).toHaveTextContent(/cargando categorías/i);
  });

  it("shows an error with a retry action that re-fetches categories", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    useCategoriesMock.mockReturnValue({
      status: "error",
      error: new ApiError("network"),
      retry,
    });

    render(<CategoryCards categories={summaryCategories} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar las categorías/i);

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});