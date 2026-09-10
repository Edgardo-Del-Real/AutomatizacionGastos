import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Movement } from "@rita/contracts";

import { ApiError, fetchMovements } from "../../infra/api";
import { MovementList } from "./MovementList";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchMovements: vi.fn(),
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
});
