import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";

loadDotEnvFromDisk();

function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL or TEST_DATABASE_URL must be set");
  const url = new URL(base);
  const database = url.pathname.replace(/\/$/, "");
  url.pathname = `${database}_test`;
  return url.toString();
}

describe("movement visibility model", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
  });

  async function readVisibility(id: string): Promise<string> {
    const rows = await prisma.$queryRaw<{ visibility: string }[]>`
      SELECT "visibility" FROM "Expense" WHERE "id" = ${id}
    `;
    return rows[0]?.visibility ?? "NO_ROW";
  }

  describe("default and backfill (spec: Movement Visibility Model)", () => {
    it("stores a movement created without an explicit visibility as INDIVIDUAL", async () => {
      const row = await prisma.expense.create({
        data: {
          ownerId: "rita",
          amount: new Prisma.Decimal(2500),
          currency: "ARS",
          category: "casa",
          note: "super",
          occurredAt: new Date("2026-09-01T12:00:00.000Z"),
          type: "EXPENSE",
        },
      });

      expect(await readVisibility(row.id)).toBe("INDIVIDUAL");
    });

    it("backfills rows inserted without the visibility column to INDIVIDUAL via the DEFAULT", async () => {
      // Simulates a pre-migration row: the column is not referenced at all, so
      // only the ADD COLUMN ... NOT NULL DEFAULT 'INDIVIDUAL' can fill it.
      await prisma.$executeRaw`
        INSERT INTO "Expense" ("id", "ownerId", "amount", "currency", "category", "note", "occurredAt", "type")
        VALUES ('backfill-1', 'rita', 1000, 'ARS', NULL, 'viejo', '2026-09-01T12:00:00.000Z'::timestamp, 'EXPENSE'::"MovementType")
      `;

      expect(await readVisibility("backfill-1")).toBe("INDIVIDUAL");
    });

    it("pins the migration contract: CREATE TYPE + ADD COLUMN NOT NULL DEFAULT 'INDIVIDUAL'", () => {
      const migration = readFileSync(
        join(process.cwd(), "prisma", "migrations", "20260921130000_movement_visibility", "migration.sql"),
        "utf8",
      );

      expect(migration).toContain('CREATE TYPE "MovementVisibility" AS ENUM');
      expect(migration).toContain('ADD COLUMN "visibility" "MovementVisibility" NOT NULL DEFAULT \'INDIVIDUAL\'');
    });
  });
});