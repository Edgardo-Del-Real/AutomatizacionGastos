-- CreateType
CREATE TYPE "MovementVisibility" AS ENUM ('INDIVIDUAL', 'SHARED');

-- AlterTable
-- Postgres backfills existing rows atomically via the NOT NULL DEFAULT (spec:
-- every existing row becomes INDIVIDUAL).
ALTER TABLE "Expense" ADD COLUMN "visibility" "MovementVisibility" NOT NULL DEFAULT 'INDIVIDUAL';