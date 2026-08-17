import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExpenseSummary } from "@rita/contracts";

import { ApiError, fetchSummary } from "../../infra/api";
import { MetricsOverview } from "./MetricsOverview";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchSummary: vi.fn(),
}));

const summary: ExpenseSummary = {
  months: [
    { month: "2026-02", count: 3, totalAmount: 1500 },
    { month: "2026-03", count: 5, totalAmount: 2750 },
  ],
};

const fetchSummaryMock = vi.mocked(fetchSummary);

afterEach(() => {
  vi.clearAllMocks();
});

describe("MetricsOverview", () => {
  it("shows a loading state while the summary request is pending", () => {
    fetchSummaryMock.mockImplementation(
      () => new Promise<ExpenseSummary>(() => {}),
    );

    render(<MetricsOverview />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("renders summary cards and a bar chart once the data arrives", async () => {
    fetchSummaryMock.mockResolvedValue(summary);

    const { container } = render(<MetricsOverview />);

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("2026-02");
    expect(cards[0]).toHaveTextContent("Total: 1500");
    expect(cards[1]).toHaveTextContent("2026-03");
    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    expect(fetchSummaryMock).toHaveBeenCalledWith("default");
  });

  it("shows an empty state instead of cards or chart when there is no data", async () => {
    fetchSummaryMock.mockResolvedValue({ months: [] });

    const { container } = render(<MetricsOverview />);

    await waitFor(() =>
      expect(screen.getByText(/no expense data/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(container.querySelector(".recharts-surface")).toBeNull();
  });

  it("shows an error with a retry action and recovers when retried", async () => {
    const user = userEvent.setup();
    fetchSummaryMock
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValueOnce(summary);

    render(<MetricsOverview />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load/i);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
    expect(fetchSummaryMock).toHaveBeenCalledTimes(2);
  });
});