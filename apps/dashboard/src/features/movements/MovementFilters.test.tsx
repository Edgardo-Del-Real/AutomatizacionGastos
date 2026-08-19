import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MovementListFilters } from "../../infra/api";
import { MovementFilters } from "./MovementFilters";

function FiltersHarness() {
  const [value, setValue] = useState<MovementListFilters>({});
  return <MovementFilters value={value} onChange={setValue} />;
}

describe("MovementFilters", () => {
  it("renders the type, date range, category, note, and reset controls in Spanish", () => {
    render(<MovementFilters value={{}} onChange={() => {}} />);

    expect(screen.getByLabelText("Tipo")).toBeInTheDocument();
    expect(screen.getByLabelText("Desde")).toBeInTheDocument();
    expect(screen.getByLabelText("Hasta")).toBeInTheDocument();
    expect(screen.getByLabelText("Categoría")).toBeInTheDocument();
    expect(screen.getByLabelText("Texto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /limpiar/i })).toBeInTheDocument();
  });

  it("combines type, date range, category, and note text into one filter state", async () => {
    const user = userEvent.setup();
    render(<FiltersHarness />);

    await user.selectOptions(screen.getByLabelText("Tipo"), "INCOME");
    // jsdom cannot type into date inputs, so set their value via change events.
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "2026-08-31" },
    });
    await user.type(screen.getByLabelText("Categoría"), "sueldo");
    await user.type(screen.getByLabelText("Texto"), "venta");

    // All filters are held together in the controlled state, reflected by inputs.
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe(
      "INCOME",
    );
    expect((screen.getByLabelText("Desde") as HTMLInputElement).value).toBe(
      "2026-08-01",
    );
    expect((screen.getByLabelText("Hasta") as HTMLInputElement).value).toBe(
      "2026-08-31",
    );
    expect((screen.getByLabelText("Categoría") as HTMLInputElement).value).toBe(
      "sueldo",
    );
    expect((screen.getByLabelText("Texto") as HTMLInputElement).value).toBe(
      "venta",
    );
  });

  it("reset clears all active filters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MovementFilters
        value={{ type: "EXPENSE", q: "taxi" }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /limpiar/i }));

    expect(onChange).toHaveBeenCalledWith({});
  });
});
