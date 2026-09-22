import type { Movement, MovementType, VisibilityFilter } from "@rita/contracts";

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
  from?: string;
  to?: string;
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

export type MonthBucket = {
  month: string;
  income: number;
  expenses: number;
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
