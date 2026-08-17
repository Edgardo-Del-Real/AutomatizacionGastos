import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Expense } from "@rita/contracts";

import { ApiError, fetchExpenses } from "../../infra/api";
import { ExpenseList } from "./ExpenseList";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchExpenses: vi.fn(),
}));

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
    id: "e2",
    ownerId: "default",
    amount: 1200,
    currency: "ARS",
    category: "transport",
    note: "taxi",
    occurredAt: new Date("2026-03-11T12:00:00Z"),
    createdAt: new Date("2026-03-11T12:00:00Z"),
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
];

const fetchExpensesMock = vi.mocked(fetchExpenses);

afterEach(() => {
  vi.clearAllMocks();
});

async function renderLoaded() {
  fetchExpensesMock.mockResolvedValue(expenses);
  render(<ExpenseList />);
  await waitFor(() =>
    expect(screen.getByRole("table")).toBeInTheDocument(),
  );
}

describe("ExpenseList", () => {
  it("shows a loading state while the list request is pending", () => {
    fetchExpensesMock.mockImplementation(
      () => new Promise<Expense[]>(() => {}),
    );

    render(<ExpenseList />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("renders one row per expense with date, amount, currency, category and note", async () => {
    await renderLoaded();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // header + 3 expenses

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Date",
      "Amount",
      "Currency",
      "Category",
      "Note",
    ]);

    const firstRow = within(rows[1]!);
    expect(firstRow.getByText("2026-03-11")).toBeInTheDocument();
    expect(firstRow.getByText("1200")).toBeInTheDocument();
    expect(firstRow.getByText("ARS")).toBeInTheDocument();
    expect(firstRow.getByText("transport")).toBeInTheDocument();
    expect(firstRow.getByText("taxi")).toBeInTheDocument();

    const thirdRow = within(rows[3]!);
    expect(thirdRow.getByText("2026-02-05")).toBeInTheDocument();
    expect(thirdRow.getByText("—")).toBeInTheDocument(); // null note fallback
  });

  it("orders rows by occurredAt descending (newest first)", async () => {
    await renderLoaded();

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("2026-03-11")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("2026-03-10")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("2026-02-05")).toBeInTheDocument();
  });

  it("shows an empty state with no rows when there are no expenses", async () => {
    fetchExpensesMock.mockResolvedValue([]);

    render(<ExpenseList />);

    expect(await screen.findByText(/no expenses found/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an error with a retry action and recovers when retried", async () => {
    const user = userEvent.setup();
    fetchExpensesMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(expenses);

    render(<ExpenseList />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load/i);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(fetchExpensesMock).toHaveBeenCalledTimes(2);
  });

  it("filters the rows by the selected month and resets to the full list", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(screen.getByLabelText("Filter by month"), "2026-03");

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 matching expenses
    expect(within(rows[1]!).getByText("2026-03-11")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("2026-03-10")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by month"), "");

    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("applies month and category together and shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(screen.getByLabelText("Filter by month"), "2026-02");
    await user.selectOptions(screen.getByLabelText("Filter by category"), "transport");

    expect(
      await screen.findByText(/no expenses match the selected filters/i),
    ).toBeInTheDocument();
    // The empty state replaces the table entirely — no rows, not even a header.
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    expect(screen.queryByRole("table")).toBeNull();

    // Reset the category to restore the February rows.
    await user.selectOptions(screen.getByLabelText("Filter by category"), "");
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + 1 February expense
  });
});