import { OWNER_ID } from "../../infra/env";
import { MetricsCards } from "./MetricsCards";
import { MetricsChart } from "./MetricsChart";
import { useMetrics } from "./useMetrics";

export function MetricsOverview() {
  const state = useMetrics(OWNER_ID);

  if (state.status === "error") {
    return (
      <section aria-label="Metrics error">
        <p role="alert">Couldn't load metrics: {state.error.message}</p>
        <button type="button" onClick={state.retry}>
          Retry
        </button>
      </section>
    );
  }

  if (state.status === "success") {
    if (state.data.months.length === 0) {
      return <p>No expense data for the last 6 months.</p>;
    }
    return (
      <section aria-label="Metrics overview">
        <MetricsCards months={state.data.months} />
        <MetricsChart months={state.data.months} />
      </section>
    );
  }

  // idle or loading: the request is pending
  return <p role="status">Loading metrics…</p>;
}