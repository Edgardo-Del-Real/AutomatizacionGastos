import { z } from "zod";

export const createExpenseSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1).default("ARS"),
  category: z.string().min(1).nullable().optional(),
  note: z.string().min(1).nullable().optional(),
  occurredAt: z.coerce.date(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const expenseSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  amount: z.number(),
  currency: z.string(),
  category: z.string().nullable(),
  note: z.string().nullable(),
  occurredAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export type Expense = z.infer<typeof expenseSchema>;

export const expenseSummarySchema = z.object({
  months: z.array(
    z.object({
      month: z.string(),
      count: z.number(),
      totalAmount: z.number(),
    }),
  ),
});

export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;
