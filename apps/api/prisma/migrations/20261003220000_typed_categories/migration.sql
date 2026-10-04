-- Category compatibility types.
-- NORMAL is retained in the enum so old generated clients and rows remain readable;
-- legacy NORMAL rows are normalized to MIXED below. Rebuilding the enum keeps
-- this migration transaction-safe on PostgreSQL (new enum values cannot be
-- referenced by DML in the same transaction as ALTER TYPE ... ADD VALUE).
CREATE TYPE "CategoryType_new" AS ENUM ('NORMAL', 'MIXED', 'EXPENSE', 'INCOME', 'SAVINGS');

ALTER TABLE "Category"
  ALTER COLUMN "type" DROP DEFAULT,
  ALTER COLUMN "type" TYPE "CategoryType_new"
    USING ("type"::text::"CategoryType_new");

DROP TYPE "CategoryType";
ALTER TYPE "CategoryType_new" RENAME TO "CategoryType";

ALTER TABLE "Category" ALTER COLUMN "type" SET DEFAULT 'MIXED';

UPDATE "Category"
SET "type" = 'MIXED'::"CategoryType"
WHERE "type" = 'NORMAL'::"CategoryType";

-- These names have an unambiguous income meaning and are the legacy categories
-- most likely to be incorrectly selected for expenses.
UPDATE "Category"
SET "type" = 'INCOME'::"CategoryType"
WHERE lower(trim("name")) IN (
  'sueldo',
  'sueldos',
  'salario',
  'salarios',
  'honorario',
  'honorarios',
  'venta',
  'ventas',
  'ingreso',
  'ingresos'
)
AND "type" = 'MIXED'::"CategoryType";
