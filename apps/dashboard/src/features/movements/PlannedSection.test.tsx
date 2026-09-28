import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createPlannedMovement,
  fetchCategories,
} from "../../infra/api";
import { PlannedSection } from "./PlannedSection";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchCategories: vi.fn(),
  createPlannedMovement: vi.fn(),
}));

const fetchCategoriesMock = vi.mocked(fetchCategories);
const createPlannedMovementMock = vi.mocked(createPlannedMovement);

beforeEach(() => {
  // The form's category dropdown loads through useCategories; default to an
  // empty list and let the creation test override with real categories.
  fetchCategoriesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlannedSection", () => {
  it("renders the planned month label and the es-AR next-month total", () => {
    render(<PlannedSection planned={{ month: "2026-09", total: 4000 }} />);

    expect(
      screen.getByRole("heading", { name: "Gastos fijos previstos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("septiembre de 2026")).toBeInTheDocument();
    expect(screen.getByText("$ 4.000,00")).toBeInTheDocument();
  });

  it("renders a $0 total when there are no planned expenses", () => {
    render(<PlannedSection planned={{ month: "2026-09", total: 0 }} />);

    expect(screen.getByText("$ 0,00")).toBeInTheDocument();
  });

  it("creates a planned expense through the form and bumps refresh on success", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue([
      { name: "alquiler", keywords: [] },
      { name: "expensas", keywords: [] },
    ]);
    createPlannedMovementMock.mockResolvedValue({
      id: "p1",
      ownerId: "default",
      amount: 2500,
      currency: "ARS",
      category: "alquiler",
      note: "alquiler",
      occurredAt: new Date("2026-08-10T12:00:00Z"),
      createdAt: new Date("2026-08-10T12:00:00Z"),
    });
    const onMutated = vi.fn();

    render(
      <PlannedSection
        planned={{ month: "2026-09", total: 0 }}
        onMutated={onMutated}
      />,
    );

    const form = screen.getByRole("form", { name: "Agregar previsto" });
    await user.type(within(form).getByLabelText("Monto"), "2500");
    await user.type(within(form).getByLabelText("Nota"), "alquiler");
    await screen.findByRole("option", { name: "alquiler" });
    await user.selectOptions(
      within(form).getByLabelText("Categoría"),
      "alquiler",
    );
    await user.click(
      within(form).getByRole("button", { name: "Agregar previsto" }),
    );

    await waitFor(() =>
      expect(createPlannedMovementMock).toHaveBeenCalledWith("default", {
        amount: 2500,
        note: "alquiler",
        category: "alquiler",
      }),
    );
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it("blocks a non-positive amount with a Spanish error and does not call the API", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue([]);
    const onMutated = vi.fn();

    render(
      <PlannedSection
        planned={{ month: "2026-09", total: 0 }}
        onMutated={onMutated}
      />,
    );

    const form = screen.getByRole("form", { name: "Agregar previsto" });
    await user.type(within(form).getByLabelText("Monto"), "0");
    await user.click(
      within(form).getByRole("button", { name: "Agregar previsto" }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("El monto debe ser un número positivo.");
    expect(createPlannedMovementMock).not.toHaveBeenCalled();
    expect(onMutated).not.toHaveBeenCalled();
  });

  it("blocks a negative amount with the same Spanish error and no API call", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue([]);

    render(<PlannedSection planned={{ month: "2026-09", total: 0 }} />);

    const form = screen.getByRole("form", { name: "Agregar previsto" });
    await user.type(within(form).getByLabelText("Monto"), "-5");
    await user.click(
      within(form).getByRole("button", { name: "Agregar previsto" }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("El monto debe ser un número positivo.");
    expect(createPlannedMovementMock).not.toHaveBeenCalled();
  });

  it("surfaces a Spanish error when the planned creation fails", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue([]);
    createPlannedMovementMock.mockRejectedValue(
      new ApiError("http", { status: 422 }),
    );

    render(<PlannedSection planned={{ month: "2026-09", total: 0 }} />);

    const form = screen.getByRole("form", { name: "Agregar previsto" });
    await user.type(within(form).getByLabelText("Monto"), "2500");
    await user.click(
      within(form).getByRole("button", { name: "Agregar previsto" }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("No se pudo crear el gasto previsto.");
    expect(createPlannedMovementMock).toHaveBeenCalledTimes(1);
  });
});