import type { Movement, MovementType } from "@rita/contracts";

export type { Movement, MovementType };

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
