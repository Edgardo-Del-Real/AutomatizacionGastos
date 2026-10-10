-- shared-expense-split: nullable gross column on Expense.
-- Plain-SQL, no backfill: existing rows keep a NULL sharedTotal and behave
-- exactly as before (design "Migration / Rollout").
ALTER TABLE "Expense" ADD COLUMN "sharedTotal" DECIMAL(12,2) NULL;