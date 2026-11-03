-- manual-savings: origin discriminator on SAVINGS movements. Plain-SQL, no
-- backfill: legacy SAVINGS rows keep NULL and are inert (only 'MANUAL' is
-- ever deducted); AUTO_SPLIT rows are produced exclusively by
-- createIncomeWithSavings going forward (sharedTotal migration precedent).
CREATE TYPE "MovementSavingsOrigin" AS ENUM ('AUTO_SPLIT', 'MANUAL');
ALTER TABLE "Expense" ADD COLUMN "savingsOrigin" "MovementSavingsOrigin" NULL;