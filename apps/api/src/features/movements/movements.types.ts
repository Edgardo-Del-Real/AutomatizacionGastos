import type { Movement, MovementStatus, MovementType, VisibilityFilter } from "@rita/contracts";

export type { Movement, MovementType };

/**
 * Viewer identity for every movement read (AD3): who is reading, who is their
 * partner (null in single-user/degraded mode), and the visibility filter
 * (`mine` | `shared` | `all`, default `all`). The repository composes ONE
 * central predicate from this and applies it to every raw SELECT.
 */
export type ViewerScope = {
  viewerId: string;
  partnerId: string | null;
  visibility: VisibilityFilter;
};

export type MovementListFilters = {
  type?: MovementType;
  /**
   * monthly-dashboard: the ONE period concept on the wire. The service resolves
   * it to `from`/`to` before the repository sees it, so calendar math never
   * leaks into routes or clients.
   */
  month?: string;
  /** Resolved day range (derived from `month` by the service). */
  from?: string;
  to?: string;
  /** Status narrowing; the HTTP monthly list always asks for PAID. */
  status?: MovementStatus;
  category?: string;
  q?: string;
};

export type SummaryPeriod = {
  from?: string;
  to?: string;
};

export type KpiTotals = {
  income: number;
  expenses: number;
  count: number;
  maxAmount: number;
  monthsWithData: number;
};

export type DayBucket = {
  day: string;
  income: number;
  expenses: number;
};

export type CategoryBucket = {
  name: string;
  expenseAmount: number;
  incomeAmount: number;
};
