import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MonthSelector } from "./MonthSelector";

describe("MonthSelector", () => {
  it("announces the selected month in Spanish", () => {
    render(<MonthSelector month="2026-10" onChange={vi.fn()} />);

    const input = screen.getByLabelText(/Mes seleccionado: octubre de 2026/);
    expect(input).toHaveValue("2026-10");
  });

  it("moves one month back, crossing the year boundary", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MonthSelector month="2026-01" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Mes anterior" }));

    expect(onChange).toHaveBeenCalledWith("2025-12");
  });

  it("moves one month forward, crossing the year boundary", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MonthSelector month="2026-12" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Mes siguiente" }));

    expect(onChange).toHaveBeenCalledWith("2027-01");
  });

  it("reports a directly picked month", () => {
    const onChange = vi.fn();
    render(<MonthSelector month="2026-10" onChange={onChange} />);

    // jsdom cannot drive a month picker, so set the value the way the browser
    // does: a change event with the selected key.
    fireEvent.change(screen.getByLabelText(/Mes seleccionado/), {
      target: { value: "2026-08" },
    });

    expect(onChange).toHaveBeenCalledWith("2026-08");
  });
});
