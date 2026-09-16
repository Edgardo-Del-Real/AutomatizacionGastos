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
];

const allCategories: OwnerCategory[] = [
  { name: "carnicería", keywords: [] },
  { name: "verdulería", keywords: [] },
  { name: "farmacia", keywords: [] },
];

function mockSuccess(ownerCategories: OwnerCategory[]) {
  useCategoriesMock.mockReturnValue({
    status: "success",
    data: ownerCategories,
    retry: vi.fn(),
  });
}

describe("CategoryCards", () => {
  it("renders a card for every created category, merging the summary spend", () => {
    mockSuccess(allCategories);

    render(<CategoryCards categories={summaryCategories} />);

    expect(
      screen.getByRole("heading", { name: "Gastos por categoría" }),
    ).toBeInTheDocument();

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);

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
  });

  it("renders no cards when the owner has no created categories", () => {
    mockSuccess([]);

    render(<CategoryCards categories={summaryCategories} />);

    expect(
      screen.getByRole("heading", { name: "Gastos por categoría" }),
    ).toBeInTheDocument();
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