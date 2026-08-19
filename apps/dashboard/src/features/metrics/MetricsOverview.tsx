import { OWNER_ID } from "../../infra/env";
import { MetricsCards } from "./MetricsCards";
import { MetricsChart } from "./MetricsChart";
import { useMetrics } from "./useMetrics";

export function MetricsOverview() {
  const state = useMetrics(OWNER_ID);

  if (state.status === "error") {
    return (
      <section
        aria-label="Metrics error"
        className="rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <p role="alert" className="text-sm font-medium text-danger">
          Couldn't load metrics: {state.error.message}
        </p>
        <button
          type="button"
          onClick={state.retry}
          className="mt-4 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Retry
        </button>
      </section>
    );
  }

  if (state.status === "success") {
    if (state.data.months.length === 0) {
      return (
        <p className="rounded-card border border-dashed border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card">
          No expense data for the last 6 months.
        </p>
      );
    }
    return (
      <section aria-label="Metrics overview" className="space-y-6">
        <MetricsCards months={state.data.months} />
        <MetricsChart months={state.data.months} />
      </section>
    );
  }

  // idle or loading: the request is pending
  return (
    <p
      role="status"
      className="rounded-card border border-border bg-surface p-10 text-center text-sm text-ink-soft shadow-card"
    >
      Loading metrics…
    </p>
  );
}