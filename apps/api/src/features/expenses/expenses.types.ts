import type { CreateMovementInput, Expense, ExpenseSummary } from "@rita/contracts";

export type { CreateMovementInput, Expense, ExpenseSummary };

export type NewExpense = CreateMovementInput & { ownerId: string };

export type ExpenseMonthlySummary = ExpenseSummary["months"][number];
