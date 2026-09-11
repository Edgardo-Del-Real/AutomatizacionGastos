import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Movement } from "@rita/contracts";

import {
  ApiError,
  deleteMovement,
  fetchCategories,
  fetchMovements,
  patchMovement,
} from "../../infra/api";
import { MovementList } from "./MovementList";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchMovements: vi.fn(),
  fetchCategories: vi.fn(),
  patchMovement: vi.fn(),
  deleteMovement: vi.fn(),
}));

const movements: Movement[] = [
  {
    id: "i1",
    ownerId: "default",
    amount: 3000,
    currency: "ARS",
    type: "INCOME",
    category: "sueldo",
    note: "sueldo",
    occurredAt: new Date("2026-08-10T12:00:00Z"),
    createdAt: new Date("2026-08-10T12:00:00Z"),
  },
  {
    id: "e1",
    ownerId: "default",
    amount: 1200,
    currency: "ARS",
    type: "EXPENSE",
    category: "alquiler",
    note: null,
    occurredAt: new Date("2026-08-09T12:00:00Z"),
    createdAt: new Date("2026-08-09T12:00:00Z"),
  },
];

const fetchMovementsMock = vi.mocked(fetchMovements);
const fetchCategoriesMock = vi.mocked(fetchCategories);
const patchMovementMock = vi.mocked(patchMovement);
const deleteMovementMock = vi.mocked(deleteMovement);

afterEach(() => {
  vi.clearAllMocks();
});

describe("MovementList", () => {
  it("shows a Spanish loading state while the request is pending", () => {
    fetchMovementsMock.mockImplementation(
      () => new Promise<Movement[]>(() => {}),
    );

    render(<MovementList />);

    expect(screen.getByRole("status")).toHaveTextContent(/cargando/i);
  });

  it("renders the table with Spanish headers, type column, and es-AR amounts", async () => {
    fetchMovementsMock.mockResolvedValue(movements);

    render(<MovementList />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByText("Movimientos")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Fecha")).toBeInTheDocument();
    expect(table.getByText("Tipo")).toBeInTheDocument();
    expect(table.getByText("Monto")).toBeInTheDocument();
    expect(table.getByText("Moneda")).toBeInTheDocument();
    expect(table.getByText("Categoría")).toBeInTheDocument();
    expect(table.getByText("Nota")).toBeInTheDocument();

    expect(table.getAllByRole("row")).toHaveLength(3); // header + 2 rows
    expect(table.getByText("Ingreso")).toBeInTheDocument();
    expect(table.getByText("Gasto")).toBeInTheDocument();
    expect(table.getByText("$ 3.000,00")).toBeInTheDocument();
    expect(table.getByText("$ 1.200,00")).toBeInTheDocument();
  });

  it("shows a Spanish empty state when there are no movements", async () => {
    fetchMovementsMock.mockResolvedValue([]);

    render(<MovementList />);

    await waitFor(() =>
      expect(screen.getByText(/no hay movimientos/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an error with a retry action and recovers when retried", async () => {
    const user = userEvent.setup();
    fetchMovementsMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(movements);

    render(<MovementList />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no se pudieron cargar/i);

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(fetchMovementsMock).toHaveBeenCalledTimes(2);
  });

  it("re-queries with the selected filters and resets to the full list", async () => {
    const user = userEvent.setup();
    fetchMovementsMock.mockResolvedValue(movements);

    render(<MovementList />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Tipo"), "EXPENSE");

    await waitFor(() =>
      expect(fetchMovementsMock).toHaveBeenLastCalledWith("default", {
        type: "EXPENSE",
      }),
    );

    await user.click(screen.getByRole("button", { name: /limpiar/i }));

    await waitFor(() =>
      expect(fetchMovementsMock).toHaveBeenLastCalledWith("default", {}),
    );
  });

  it("exposes edit and delete actions on every movement row", async () => {
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([]);

    render(<MovementList />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 movement rows
    expect(
      within(rows[1]!).getByRole("button", { name: /editar/i }),
    ).toBeInTheDocument();
    expect(
      within(rows[1]!).getByRole("button", { name: /eliminar/i }),
    ).toBeInTheDocument();
    expect(
      within(rows[2]!).getByRole("button", { name: /editar/i }),
    ).toBeInTheDocument();
    expect(
      within(rows[2]!).getByRole("button", { name: /eliminar/i }),
    ).toBeInTheDocument();
  });

  it("edits a movement from the row and bumps refresh on success", async () => {
    const user = userEvent.setup();
    fetchMovementsMock.mockResolvedValue(movements);
    fetchCategoriesMock.mockResolvedValue([
      { name: "sueldo", keywords: [] },
      { name: "alquiler", keywords: [] },
    ]);
    patchMovementMock.mockResolvedValue(movements[0]!);
    const onMutated = vi.fn();

    render(<MovementList onMutated={onMutated} refreshToken={0} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(firstRow.getByRole("button", { name: /editar/i }));

    const form = await screen.findByRole("form", { name: "Editar movimiento" });
    await user.clear(within(form).getByLabelText("Nota"));
    await user.type(within(form).getByLabelText("Nota"), "sueldo agosto");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(patchMovementMock).toHaveBeenCalledWith("i1", "default", {
        note: "sueldo agosto",
      }),
    );
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it("confirms deletion through a dialog, calls deleteMovement, and bumps refresh", async () => {
    const user = userEvent.setup();
    fetchMovementsMock.mockResolvedValue(movements);
    deleteMovementMock.mockResolvedValue(undefined);
    const onMutated = vi.fn();

    render(<MovementList onMutated={onMutated} refreshToken={0} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(firstRow.getByRole("button", { name: /eliminar/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await user.click(
      within(dialog).getByRole("button", { name: /eliminar/i }),
    );

    await waitFor(() =>
      expect(deleteMovementMock).toHaveBeenCalledWith("i1", "default"),
    );
    await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancelling the delete dialog does nothing", async () => {
    const user = userEvent.setup();
    fetchMovementsMock.mockResolvedValue(movements);
    const onMutated = vi.fn();

    render(<MovementList onMutated={onMutated} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(firstRow.getByRole("button", { name: /eliminar/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /cancelar/i,
      }),
    );

    expect(deleteMovementMock).not.toHaveBeenCalled();
    expect(onMutated).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("shows a Spanish error and keeps the row when deletion fails", async () => {
    const user = userEvent.setup();
    fetchMovementsMock.mockResolvedValue(movements);
    deleteMovementMock.mockRejectedValue(new ApiError("http", { status: 500 }));
    const onMutated = vi.fn();

    render(<MovementList onMutated={onMutated} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const firstRow = within(screen.getAllByRole("row")[1]!);
    await user.click(firstRow.getByRole("button", { name: /eliminar/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /eliminar/i,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no se pudo eliminar/i,
    );
    expect(onMutated).not.toHaveBeenCalled();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
