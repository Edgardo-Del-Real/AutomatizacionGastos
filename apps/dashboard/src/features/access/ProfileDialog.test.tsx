import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, changePassword, fetchAccessHistory } from "../../infra/api";
import { ProfileDialog } from "./ProfileDialog";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  changePassword: vi.fn(),
  fetchAccessHistory: vi.fn(),
}));

const changePasswordMock = vi.mocked(changePassword);
const fetchAccessHistoryMock = vi.mocked(fetchAccessHistory);

beforeEach(() => {
  fetchAccessHistoryMock.mockResolvedValue([
    {
      requesterId: "rita",
      createdAt: "2026-11-03T20:00:00.000Z",
      expiresAt: "2026-11-03T20:30:00.000Z",
      revokedAt: "2026-11-03T20:10:00.000Z",
    },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderDialog() {
  return render(
    <ProfileDialog
      userName="Edgardo"
      ownerId="default"
      nameOf={(ownerId) => (ownerId === "rita" ? "Rita" : ownerId)}
      onClose={vi.fn()}
    />,
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, repeat: string) {
  await user.type(screen.getByLabelText("Contraseña actual"), current);
  await user.type(screen.getByLabelText("Nueva"), next);
  await user.type(screen.getByLabelText("Repetir nueva"), repeat);
}

describe("ProfileDialog", () => {
  it("shows who saw the dashboard and when", async () => {
    renderDialog();

    expect(await screen.findByRole("list", { name: "Historial de accesos" })).toBeInTheDocument();
    expect(screen.getByText(/Rita · .* lo cortaste/)).toBeInTheDocument();
  });

  it("blocks a mismatch without calling the API", async () => {
    const user = userEvent.setup();
    renderDialog();

    await fill(user, "actual-1", "nueva-clave", "otra-clave");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no coinciden/i);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("blocks a short password without calling the API", async () => {
    const user = userEvent.setup();
    renderDialog();

    await fill(user, "actual-1", "corta", "corta");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/8 caracteres/i);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("changes the password and clears the fields", async () => {
    const user = userEvent.setup();
    changePasswordMock.mockResolvedValue(undefined);
    renderDialog();

    await fill(user, "actual-1", "nueva-clave-1", "nueva-clave-1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(changePasswordMock).toHaveBeenCalledWith("actual-1", "nueva-clave-1"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/contraseña actualizada/i);
    expect(screen.getByLabelText("Contraseña actual")).toHaveValue("");
  });

  it("reports a wrong current password", async () => {
    const user = userEvent.setup();
    changePasswordMock.mockRejectedValue(new ApiError("http", { status: 401 }));
    renderDialog();

    await fill(user, "mala", "nueva-clave-1", "nueva-clave-1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/actual no es correcta/i);
  });
});
