import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProfileMenu } from "./ProfileMenu";

const baseProps = {
  userName: "Edgardo",
  viewingName: null,
  partnerName: "Rita",
  grantExpiresAt: null,
  waiting: false,
  onRequestAccess: vi.fn(),
  onRevoke: vi.fn(),
  onOpenProfile: vi.fn(),
  onLogout: vi.fn(),
};

describe("ProfileMenu", () => {
  it("keeps the menu closed until the person opens it", () => {
    render(<ProfileMenu {...baseProps} />);

    expect(screen.getByRole("button", { name: /Edgardo/ })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers access, profile and logout when opened", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /Edgardo/ }));

    expect(screen.getByRole("menuitem", { name: "Ver el dashboard de Rita" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Administrar perfil/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Salir" })).toBeInTheDocument();
  });

  it("calls onRequestAccess from the menu", async () => {
    const user = userEvent.setup();
    const onRequestAccess = vi.fn();
    render(<ProfileMenu {...baseProps} onRequestAccess={onRequestAccess} />);

    await user.click(screen.getByRole("button", { name: /Edgardo/ }));
    await user.click(screen.getByRole("menuitem", { name: "Ver el dashboard de Rita" }));

    expect(onRequestAccess).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables the request while waiting for the other person", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu {...baseProps} waiting />);

    await user.click(screen.getByRole("button", { name: /Edgardo/ }));

    expect(
      screen.getByRole("menuitem", { name: /Esperando que Rita responda/ }),
    ).toBeDisabled();
  });

  it("shows the granted view with its expiry and the way back", async () => {
    const user = userEvent.setup();
    const onRevoke = vi.fn();
    render(
      <ProfileMenu
        {...baseProps}
        viewingName="Rita"
        grantExpiresAt="2026-11-03T23:15:00.000Z"
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByRole("button", { name: /Edgardo · viendo a Rita/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edgardo · viendo a Rita/ }));
    expect(screen.getByText(/Estás viendo el dashboard de Rita/)).toBeInTheDocument();
    expect(screen.getByText(/Se cierra a las/)).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Volver a mi dashboard" }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /Edgardo/ }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
