import type {
  CreateMovementInput,
  Expense,
  ExpenseSummary,
  MovementSavingsOrigin,
  MovementVisibility,
} from "@rita/contracts";

export type { CreateMovementInput, Expense, ExpenseSummary };

/**
 * shared-expense-split (D8): `sharedTotal` rides the create input so the
 * repository can persist the split gross on a row; the contract `Expense`
 * (expenseSchema) stays untouched — the field is only exposed via
 * `movementSchema` on the movements read path.
 */
export type NewExpense = CreateMovementInput & {
  ownerId: string;
  visibility?: MovementVisibility;
  sharedTotal?: number;
  // manual-savings (D5): origin rides the create input so create() can persist
  // it on a SAVINGS row; the frozen expenseSchema never carries it — only
  // movementSchema exposes it on the movements read path.
  savingsOrigin?: MovementSavingsOrigin;
};

export type ExpenseMonthlySummary = ExpenseSummary["months"][number];
