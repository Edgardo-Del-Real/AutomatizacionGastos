import type { CreateExpenseInput, Expense, ExpenseSummary } from "@rita/contracts";

export type { CreateExpenseInput, Expense, ExpenseSummary };

export type NewExpense = CreateExpenseInput & { ownerId: string };

export type ExpenseMonthlySummary = ExpenseSummary["months"][number];
