import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Expense } from "@rita/contracts";

import { ExpenseFilters } from "./ExpenseFilters";
import type { Filters } from "./filterExpenses";

const expenses: Expense[] = [
  {
    id: "e1",
    ownerId: "default",
    amount: 500,
    currency: "ARS",
    category: "food",
    note: "lunch",
    occurredAt: new Date("2026-03-10T12:00:00Z"),
    createdAt: new Date("2026-03-10T12:00:00Z"),
  },
  {
    id: "e3",
    ownerId: "default",
    amount: 100,
    currency: "USD",
    category: "food",
    note: null,
    occurredAt: new Date("2026-02-05T12:00:00Z"),
    createdAt: new Date("2026-02-05T12:00:00Z"),
  },
  {
    id: "e4",
    ownerId: "default",
    amount: 300,
    currency: "ARS",
    category: "transport",
    note: "taxi",
    occurredAt: new Date("2026-02-20T12:00:00Z"),
    createdAt: new Date("2026-02-20T12:00:00Z"),
  },
];

function selectByName(name: string) {
  return screen.getByLabelText(name) as HTMLSelectElement;
}

describe("ExpenseFilters", () => {
  it("renders one option per distinct month (YYYY-MM, desc) and category (asc, null excluded)", () => {
    render(<ExpenseFilters expenses={expenses} value={{}} onChange={() => {}} />);

    const monthOptions = selectByName("Filter by month").querySelectorAll("option");
    expect(Array.from(monthOptions).map((o) => o.value)).toEqual([
      "",
      "2026-03",
      "2026-02",
    ]);

    const categoryOptions = selectByName("Filter by category").querySelectorAll("option");
    expect(Array.from(categoryOptions).map((o) => o.value)).toEqual([
      "",
      "food",
      "transport",
    ]);
  });

  it("shows no duplicate options when several expenses share a month or category", () => {
    render(<ExpenseFilters expenses={expenses} value={{}} onChange={() => {}} />);

    const monthValues = Array.from(
      selectByName("Filter by month").querySelectorAll("option"),
    ).map((o) => o.value);
    expect(monthValues.filter((v) => v === "2026-02")).toHaveLength(1);
    expect(monthValues.filter((v) => v === "2026-03")).toHaveLength(1);

    const categoryValues = Array.from(
      selectByName("Filter by category").querySelectorAll("option"),
    ).map((o) => o.value);
    expect(categoryValues.filter((v) => v === "food")).toHaveLength(1);
  });

  it("reports the selected month, preserving an already-set category", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ExpenseFilters
        expenses={expenses}
        value={{ category: "food" }}
        onChange={onChange}
      />,
    );

    await user.selectOptions(selectByName("Filter by month"), "2026-02");

    expect(onChange).toHaveBeenCalledWith<Filters[]>({
      month: "2026-02",
      category: "food",
    });
  });

  it("reports the selected category", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ExpenseFilters expenses={expenses} value={{}} onChange={onChange} />);

    await user.selectOptions(selectByName("Filter by category"), "transport");

    expect(onChange).toHaveBeenCalledWith<Filters[]>({ category: "transport" });
  });

  it("resets a filter to undefined when the All option is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ExpenseFilters
        expenses={expenses}
        value={{ month: "2026-02", category: "transport" }}
        onChange={onChange}
      />,
    );

    await user.selectOptions(selectByName("Filter by month"), "");

    expect(onChange).toHaveBeenCalledWith<Filters[]>({ category: "transport" });
  });
});