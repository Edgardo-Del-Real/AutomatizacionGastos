import type { CreateMovementInput, Expense, ExpenseSummary, MovementVisibility } from "@rita/contracts";

export type { CreateMovementInput, Expense, ExpenseSummary };

export type NewExpense = CreateMovementInput & { ownerId: string; visibility?: MovementVisibility };

export type ExpenseMonthlySummary = ExpenseSummary["months"][number];
