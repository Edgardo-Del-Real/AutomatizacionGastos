-- D11 (savings-rule): one hand-written migration.
-- The new MovementType value is declared but NEVER used in-migration
-- (PostgreSQL forbids using a newly added enum value in the same
-- transaction); the ahorro conversion targets CategoryType, which is
-- created above the UPDATE in this same file.
ALTER TYPE "MovementType" ADD VALUE 'SAVINGS';

-- CreateType
CREATE TYPE "CategoryType" AS ENUM ('NORMAL', 'SAVINGS');

-- AlterTable
-- Legacy categories default to NORMAL; the ahorro conversion below is the
-- one-time backfill for pre-existing "ahorro" categories.
ALTER TABLE "Category" ADD COLUMN "type" "CategoryType" NOT NULL DEFAULT 'NORMAL';

-- Legacy conversion: pre-existing "ahorro" categories become SAVINGS-typed.
-- Their movements stay untouched (no Expense write happens in this migration).
UPDATE "Category" SET "type" = 'SAVINGS'::"CategoryType" WHERE lower("name") = 'ahorro';

-- CreateTable
CREATE TABLE "SavingsRule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "percent" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavingsRule_ownerId_keyword_key" ON "SavingsRule"("ownerId", "keyword");
CREATE INDEX "SavingsRule_ownerId_idx" ON "SavingsRule"("ownerId");