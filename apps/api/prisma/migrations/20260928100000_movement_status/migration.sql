-- CreateType
CREATE TYPE "MovementStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable
-- Postgres backfills existing rows atomically via the NOT NULL DEFAULT (spec:
-- every existing row becomes PAID; no explicit UPDATE needed).
ALTER TABLE "Expense" ADD COLUMN "status" "MovementStatus" NOT NULL DEFAULT 'PAID';