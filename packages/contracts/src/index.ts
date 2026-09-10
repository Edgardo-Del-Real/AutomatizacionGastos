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

export const expenseMonthSchema = z.object({
  month: z.string(),
  count: z.number(),
  totalAmount: z.number(),
});

export type ExpenseMonth = z.infer<typeof expenseMonthSchema>;

export const expenseSummarySchema = z.object({
  months: z.array(expenseMonthSchema),
});

export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;

export const listExpensesSchema = z.array(expenseSchema);

export type ListExpenses = z.infer<typeof listExpensesSchema>;

export const movementTypeSchema = z.enum(["EXPENSE", "INCOME"]);

export type MovementType = z.infer<typeof movementTypeSchema>;

export const movementSchema = expenseSchema.extend({ type: movementTypeSchema });

export type Movement = z.infer<typeof movementSchema>;

export const listMovementsSchema = z.array(movementSchema);

export type ListMovements = z.infer<typeof listMovementsSchema>;

export const movementFiltersSchema = z.object({
  ownerId: z.string().min(1),
  type: movementTypeSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
});

export type MovementFilters = z.infer<typeof movementFiltersSchema>;

export const createMovementSchema = createExpenseSchema.extend({
  type: movementTypeSchema.optional(),
});

export type CreateMovementInput = z.infer<typeof createMovementSchema>;

export const updateMovementSchema = z
  .object({
    amount: z.number().positive().optional(),
    note: z.string().min(1).nullable().optional(),
    category: z.string().min(1).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "at least one field is required",
  });

export type UpdateMovementInput = z.infer<typeof updateMovementSchema>;

export const ownerCategorySchema = z.object({
  name: z.string(),
  keywords: z.array(z.string()),
});

export type OwnerCategory = z.infer<typeof ownerCategorySchema>;

export const categoryListSchema = z.array(ownerCategorySchema);

export type CategoryList = z.infer<typeof categoryListSchema>;

export const movementSummarySchema = z.object({
  kpis: z.object({
    income: z.number(),
    expenses: z.number(),
    balance: z.number(),
    avgPerMonth: z.number(),
    avgPerMovement: z.number(),
    maxAmount: z.number(),
    count: z.number(),
  }),
  mom: z.object({
    months: z.array(
      z.object({
        month: z.string(),
        income: z.number(),
        expenses: z.number(),
        balance: z.number(),
      }),
    ),
  }),
  daily: z.array(
    z.object({
      day: z.string(),
      income: z.number(),
      expenses: z.number(),
      balance: z.number(),
    }),
  ),
  categories: z.array(
    z.object({
      name: z.string(),
      expenseAmount: z.number(),
      incomeAmount: z.number(),
      expensePercent: z.number(),
      incomePercent: z.number(),
    }),
  ),
  top: z.object({
    expenses: z.array(movementSchema),
    income: z.array(movementSchema),
  }),
});

export type MovementSummary = z.infer<typeof movementSummarySchema>;
