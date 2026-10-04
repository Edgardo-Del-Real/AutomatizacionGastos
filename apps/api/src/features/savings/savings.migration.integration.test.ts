import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
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

/**
 * Finds the hand-written savings-rule migration SQL (D11) by its stable prefix.
 */
function savingsMigrationSql(): string {
  const migrationsDir = join(__dirname, "..", "..", "..", "prisma", "migrations");
  const directory = readdirSync(migrationsDir, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && entry.name.startsWith("20260927090000_savings_rule"),
  );
  if (directory !== undefined) {
    return readFileSync(join(migrationsDir, directory.name, "migration.sql"), "utf8");
  }
  throw new Error("Savings-rule migration not found");
}

describe("savings-rule migration (D11)", () => {
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
    await prisma.$executeRawUnsafe(`DELETE FROM "SavingsRule"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CategoryKeyword"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Category"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Expense"`);
  });

  describe("static pins", () => {
    it("adds the SAVINGS value to MovementType", () => {
      expect(savingsMigrationSql()).toContain(`ADD VALUE 'SAVINGS'`);
    });

    it("creates the CategoryType enum and the Category.type column defaulting to NORMAL", () => {
      const sql = savingsMigrationSql();
      expect(sql).toContain(`CREATE TYPE "CategoryType"`);
      expect(sql).toContain(`ALTER TABLE "Category" ADD COLUMN "type" "CategoryType" NOT NULL DEFAULT 'NORMAL'`);
    });

    it("converts the legacy ahorro category to SAVINGS", () => {
      const sql = savingsMigrationSql();
      expect(sql.toLowerCase()).toContain(`update "category"`);
      expect(sql.toLowerCase()).toContain(`lower("name") = 'ahorro'`);
      expect(sql.toLowerCase()).toContain(`'savings'`);
    });

    it("creates the SavingsRule table with a Decimal(12,2) percent and a unique [ownerId, keyword]", () => {
      const sql = savingsMigrationSql();
      expect(sql).toContain(`CREATE TABLE "SavingsRule"`);
      expect(sql).toContain(`DECIMAL(12,2)`);
      expect(sql).toContain(`"percent" DECIMAL(12,2) NOT NULL`);
      expect(sql).toContain(`SavingsRule_ownerId_keyword_key`);
    });

    it("never touches existing movement rows (no UPDATE/DELETE on Expense)", () => {
      const sql = savingsMigrationSql();
      expect(sql.toLowerCase()).not.toContain(`update "expense"`);
      expect(sql.toLowerCase()).not.toContain(`delete from "expense"`);
    });
  });

  describe("database pins", () => {
    it("exposes SAVINGS in the MovementType enum", async () => {
      const rows = await prisma.$queryRaw<{ value: string }[]>`
        SELECT unnest(enum_range(NULL::"MovementType")) AS "value"
      `;
      const values = rows.map((row) => row.value);
      expect(values).toContain("SAVINGS");
    });

    it("defaults a new category to MIXED", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Category" ("id", "ownerId", "name") VALUES ('${randomUUID()}', 'owner-1', 'Salud')`,
      );
      const row = await prisma.$queryRaw<{ type: string }[]>`
        SELECT "type" FROM "Category" WHERE "ownerId" = 'owner-1'
      `;
      expect(row[0]?.type).toBe("MIXED");
    });

    it("stores a SAVINGS-typed ahorro category", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Category" ("id", "ownerId", "name", "type") VALUES ('${randomUUID()}', 'owner-1', 'ahorro', 'SAVINGS'::"CategoryType")`,
      );
      const row = await prisma.$queryRaw<{ type: string }[]>`
        SELECT "type" FROM "Category" WHERE "ownerId" = 'owner-1'
      `;
      expect(row[0]?.type).toBe("SAVINGS");
    });

    it("stores a savings rule with a Decimal percent scoped to the owner", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "SavingsRule" ("id", "ownerId", "keyword", "percent") VALUES ('${randomUUID()}', 'owner-1', 'entrenuts', 10.0)`,
      );
      const row = await prisma.$queryRaw<{ ownerId: string; keyword: string; percent: string }[]>`
        SELECT "ownerId", "keyword", "percent"::text AS "percent" FROM "SavingsRule" WHERE "ownerId" = 'owner-1'
      `;
      expect(row[0]?.ownerId).toBe("owner-1");
      expect(row[0]?.keyword).toBe("entrenuts");
      expect(row[0]?.percent).toBe("10.00");
    });

    it("enforces the unique [ownerId, keyword] constraint", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "SavingsRule" ("id", "ownerId", "keyword", "percent") VALUES ('${randomUUID()}', 'owner-1', 'entrenuts', 10.0)`,
      );
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "SavingsRule" ("id", "ownerId", "keyword", "percent") VALUES ('${randomUUID()}', 'owner-1', 'entrenuts', 15.0)`,
        ),
      ).rejects.toThrow();
    });

    it("preserves existing movements as EXPENSE after the migration", async () => {
      await prisma.expense.create({
        data: {
          ownerId: "owner-1",
          amount: 1000,
          currency: "ARS",
          note: "legacy",
          occurredAt: new Date("2026-09-01T12:00:00.000Z"),
          type: "EXPENSE",
        },
      });
      execSync("npx --no-install prisma migrate deploy", {
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: "pipe",
      });
      const row = await prisma.expense.findFirst({ where: { ownerId: "owner-1" } });
      expect(row?.type).toBe("EXPENSE");
    });
  });
});