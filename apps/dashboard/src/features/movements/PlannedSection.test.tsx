import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createPlannedMovement,
  fetchCategories,
  markMovementPaid,
} from "../../infra/api";
import { PlannedSection } from "./PlannedSection";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchCategories: vi.fn(),
  createPlannedMovement: vi.fn(),
  markMovementPaid: vi.fn(),
}));

const fetchCategoriesMock = vi.mocked(fetchCategories);
const createPlannedMovementMock = vi.mocked(createPlannedMovement);
const markMovementPaidMock = vi.mocked(markMovementPaid);

/** A PENDING EXPENSE row as the summary's planned block ships it. */
function pendingRow(overrides: {
  id: string;
  amount: number;
  note?: string | null;
  category?: string | null;
}) {
  return {
    id: overrides.id,
    ownerId: "default",
    registrantId: "default",
    amount: overrides.amount,
    currency: "ARS",
    category: overrides.category === undefined ? "alquiler" : overrides.category,
    note: overrides.note ?? null,
    occurredAt: new Date("2026-08-13T12:00:00Z"),
    createdAt: new Date("2026-08-13T12:00:00Z"),
    type: "EXPENSE" as const,
    status: "PENDING" as const,
    visibility: "INDIVIDUAL" as const,
  };
}

beforeEach(() => {
  // The form's category dropdown loads through useCategories; default to an
  // empty list and let the creation test override with real categories.
  fetchCategoriesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlannedSection", () => {
  it("renders the outstanding pending total without a planned date", () => {
    render(<PlannedSection planned={{ total: 4000, movements: [] }} />);

    expect(
      screen.getByRole("heading", { name: "Gastos fijos previstos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Por pagar")).toBeInTheDocument();
    expect(
      screen.getByText("Pendientes — se suman al mes en que los pagues."),
    ).toBeInTheDocument();
    expect(screen.getByText("$ 4.000,00")).toBeInTheDocument();
  });

  it("renders a $0 total when there are no planned expenses", () => {
    render(<PlannedSection planned={{ total: 0, movements: [] }} />);

    expect(screen.getByText("$ 0,00")).toBeInTheDocument();
    expect(screen.getByText("No hay previstos pendientes.")).toBeInTheDocument();
  });

  // monthly-dashboard: previstos left the monthly table, so this section is
  // their only surface — including the mark-paid action that used to be on the
  // list row.
  it("lists each pending previsto with its amount, note and a mark-paid action", async () => {
    const user = userEvent.setup();
    markMovementPaidMock.mockResolvedValue(pendingRow({ id: "p1", amount: 2500 }));
    const onMutated = vi.fn();

    render(
      <PlannedSection
        planned={{
          total: 4000,
          movements: [
            pendingRow({ id: "p1", amount: 2500, note: "alquiler" }),
            pendingRow({ id: "p2", amount: 1500, category: null }),
          ],
        }}
        onMutated={onMutated}
      />,
    );

    const list = screen.getByRole("list", { name: "Previstos pendientes" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("$ 2.500,00")).toBeInTheDocument();
    expect(within(items[0]!).getByText(/alquiler/)).toBeInTheDocument();
    expect(within(items[1]!).getByText("Sin nota")).toBeInTheDocument();

    await user.click(within(items[0]!).getByRole("button", { name: "Marcar pagado" }));

    await waitFor(() =>
      expect(markMovementPaidMock).toHaveBeenCalledWith("p1", "default"),
    );
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it("surfaces a Spanish error when marking a previsto paid fails", async () => {
    const user = userEvent.setup();
    markMovementPaidMock.mockRejectedValue(new ApiError("http", { status: 409 }));

    render(
      <PlannedSection
        planned={{ total: 2500, movements: [pendingRow({ id: "p1", amount: 2500 })] }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Marcar pagado" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo marcar el previsto como pagado.",
    );
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
        planned={{ total: 0, movements: [] }}
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
        planned={{ total: 0, movements: [] }}
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

    render(<PlannedSection planned={{ total: 0, movements: [] }} />);

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

    render(<PlannedSection planned={{ total: 0, movements: [] }} />);

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

  it("submits only amount, note and category — never a visibility field", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue([]);

    render(<PlannedSection planned={{ total: 0, movements: [] }} />);

    const form = screen.getByRole("form", { name: "Agregar previsto" });
    await user.type(within(form).getByLabelText("Monto"), "2500");
    await user.type(within(form).getByLabelText("Nota"), "alquiler");
    await user.click(
      within(form).getByRole("button", { name: "Agregar previsto" }),
    );

    await waitFor(() =>
      expect(createPlannedMovementMock).toHaveBeenCalledWith("default", {
        amount: 2500,
        note: "alquiler",
        category: null,
      }),
    );
    // Planned expenses are INDIVIDUAL by design: the form never offers a
    // Compartido toggle and the payload never carries a visibility field.
    expect(screen.queryByRole("checkbox", { name: "Compartido" })).toBeNull();
  });
});
