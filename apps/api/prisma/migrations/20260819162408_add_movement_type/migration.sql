-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('EXPENSE', 'INCOME');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "type" "MovementType" NOT NULL DEFAULT 'EXPENSE';

-- CreateIndex
CREATE INDEX "Expense_ownerId_occurredAt_idx" ON "Expense"("ownerId", "occurredAt");
