import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Expense, ExpenseSummary } from "@rita/contracts";

import { ApiError, fetchExpenses, fetchSummary } from "./infra/api";
import App from "./App";

vi.mock("./infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./infra/api")>()),
  fetchSummary: vi.fn(),
  fetchExpenses: vi.fn(),
}));

const summary: ExpenseSummary = {
  months: [
    { month: "2026-02", count: 3, totalAmount: 1500 },
    { month: "2026-03", count: 5, totalAmount: 2750 },
  ],
};

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

const fetchSummaryMock = vi.mocked(fetchSummary);
const fetchExpensesMock = vi.mocked(fetchExpenses);

afterEach(() => {
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders both the metrics overview and the expense list from the mocked api", async () => {
    fetchSummaryMock.mockResolvedValue(summary);
    fetchExpensesMock.mockResolvedValue(expenses);

    render(<App />);

    // Metrics section: summary cards + chart.
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
    expect(screen.getByText("Total: 1500")).toBeInTheDocument();
    expect(screen.getByText("Total: 2750")).toBeInTheDocument();

    // Expense section: full table with header + 3 rows.
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("2026-03-11")).toBeInTheDocument();

    // Both requests use the configured owner.
    expect(fetchSummaryMock).toHaveBeenCalledWith("default");
    expect(fetchExpensesMock).toHaveBeenCalledWith("default");
  });

  it("updates the expense rows when a filter is selected and resets to the full list", async () => {
    const user = userEvent.setup();
    fetchSummaryMock.mockResolvedValue(summary);
    fetchExpensesMock.mockResolvedValue(expenses);

    render(<App />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getAllByRole("row")).toHaveLength(4);

    await user.selectOptions(screen.getByLabelText("Filter by month"), "2026-03");

    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 March rows
    expect(screen.queryByText("2026-02-05")).toBeNull();

    await user.selectOptions(screen.getByLabelText("Filter by month"), "");

    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("keeps the metrics section working when the expense request fails", async () => {
    fetchSummaryMock.mockResolvedValue(summary);
    fetchExpensesMock.mockRejectedValue(new ApiError("network"));

    render(<App />);

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load expenses/i);
    expect(screen.getByText("Total: 1500")).toBeInTheDocument();
  });
});