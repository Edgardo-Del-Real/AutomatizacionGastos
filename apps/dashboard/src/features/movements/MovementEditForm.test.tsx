import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Movement, OwnerCategory } from "@rita/contracts";

import { ApiError, fetchCategories, patchMovement } from "../../infra/api";
import { MovementEditForm } from "./MovementEditForm";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchCategories: vi.fn(),
  patchMovement: vi.fn(),
}));

const movement: Movement = {
  id: "m1",
  ownerId: "default",
  amount: 1200,
  currency: "ARS",
  type: "EXPENSE",
  category: "comida",
  note: "cena",
  occurredAt: new Date("2026-08-09T12:00:00Z"),
  createdAt: new Date("2026-08-09T12:00:00Z"),
};

const categories: OwnerCategory[] = [
  { name: "comida", keywords: ["comida"] },
  { name: "transporte", keywords: ["bondi"] },
];

const fetchCategoriesMock = vi.mocked(fetchCategories);
const patchMovementMock = vi.mocked(patchMovement);

afterEach(() => {
  vi.clearAllMocks();
});

describe("MovementEditForm", () => {
  it("lists the owner categories in the dropdown when it opens", async () => {
    fetchCategoriesMock.mockResolvedValue(categories);

    render(
      <MovementEditForm
        movement={movement}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const select = await screen.findByLabelText("Categoría");
    await waitFor(() => {
      const options = within(select)
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(options).toEqual(["Sin categoría", "comida", "transporte"]);
    });
    expect(select).toHaveValue("comida");
  });

  it("PATCHes only the changed fields when the owner edits amount and note", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue(categories);
    patchMovementMock.mockResolvedValue(movement);
    const onSaved = vi.fn();

    render(
      <MovementEditForm
        movement={movement}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByLabelText("Categoría");

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "2500");
    await user.clear(screen.getByLabelText("Nota"));
    await user.type(screen.getByLabelText("Nota"), "cena familiar");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(patchMovementMock).toHaveBeenCalledWith("m1", "default", {
      amount: 2500,
      note: "cena familiar",
    });
  });

  it("clearing the category dropdown sends category null", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue(categories);
    patchMovementMock.mockResolvedValue({ ...movement, category: null });

    render(
      <MovementEditForm
        movement={movement}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByLabelText("Categoría");

    await user.selectOptions(screen.getByLabelText("Categoría"), "");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(patchMovementMock).toHaveBeenCalledWith("m1", "default", {
        category: null,
      }),
    );
  });

  it("clearing the note sends note null instead of an empty string", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue(categories);
    patchMovementMock.mockResolvedValue({ ...movement, note: null });

    render(
      <MovementEditForm
        movement={movement}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByLabelText("Categoría");

    await user.clear(screen.getByLabelText("Nota"));

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(patchMovementMock).toHaveBeenCalledWith("m1", "default", {
        note: null,
      }),
    );
  });

  it("blocks a non-positive amount with a Spanish error and does not call the API", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue(categories);
    const onSaved = vi.fn();

    render(
      <MovementEditForm
        movement={movement}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByLabelText("Categoría");

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "-5");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/monto/i);
    expect(patchMovementMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows a Spanish error when the patch fails and keeps the form open", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue(categories);
    patchMovementMock.mockRejectedValue(new ApiError("http", { status: 422 }));

    render(
      <MovementEditForm
        movement={movement}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByLabelText("Categoría");

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "999");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no se pudo/i);
    expect(screen.getByLabelText("Monto")).toBeInTheDocument();
  });

  it("calls onCancel when the owner cancels", async () => {
    const user = userEvent.setup();
    fetchCategoriesMock.mockResolvedValue(categories);
    const onCancel = vi.fn();

    render(
      <MovementEditForm
        movement={movement}
        onSaved={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await screen.findByLabelText("Categoría");

    await user.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});