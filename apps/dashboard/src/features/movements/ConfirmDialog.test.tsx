import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders a modal dialog with the title, message, and action buttons", () => {
    render(
      <ConfirmDialog
        title="Eliminar movimiento"
        message="¿Eliminar el movimiento?"
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("heading", { name: "Eliminar movimiento" }),
    ).toBeInTheDocument();
    expect(screen.getByText("¿Eliminar el movimiento?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        title="Título"
        message="Mensaje"
        confirmLabel="Sí"
        cancelLabel="No"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sí" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Título"
        message="Mensaje"
        confirmLabel="Sí"
        cancelLabel="No"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the confirm button while busy", () => {
    render(
      <ConfirmDialog
        title="Título"
        message="Mensaje"
        confirmLabel="Sí"
        cancelLabel="No"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy
      />,
    );

    expect(screen.getByRole("button", { name: "Sí" })).toBeDisabled();
  });

  it("renders an optional error with role alert", () => {
    render(
      <ConfirmDialog
        title="Título"
        message="Mensaje"
        confirmLabel="Sí"
        cancelLabel="No"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        error="No se pudo eliminar el movimiento."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no se pudo eliminar/i,
    );
  });
});