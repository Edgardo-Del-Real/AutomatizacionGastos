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
 * Finds the hand-written movement-status migration SQL (D1): the newest migration
 * whose body mentions MovementStatus. The static pins below keep the migration
 * honest (enum created, status column added with a NOT NULL DEFAULT, no explicit
 * UPDATE/DELETE on Expense — Postgres backfills atomically via the default).
 */
function movementStatusMigrationSql(): string {
  const migrationsDir = join(__dirname, "..", "..", "..", "prisma", "migrations");
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    const sql = readFileSync(join(migrationsDir, dirs[i]!, "migration.sql"), "utf8");
    if (sql.includes("MovementStatus")) {
      return sql;
    }
  }
  throw new Error("No migration contains MovementStatus");
}

describe("movement status migration (D1)", () => {
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
    await prisma.$executeRawUnsafe(`DELETE FROM "Expense"`);
  });

  describe("static pins", () => {
    it("creates the MovementStatus enum with PENDING and PAID", () => {
      expect(movementStatusMigrationSql()).toContain(
        `CREATE TYPE "MovementStatus" AS ENUM ('PENDING', 'PAID')`,
      );
    });

    it("adds the status column defaulting to PAID", () => {
      const sql = movementStatusMigrationSql();
      expect(sql).toContain(`ADD COLUMN "status" "MovementStatus" NOT NULL DEFAULT 'PAID'`);
    });

    it("never touches existing movement rows (no UPDATE/DELETE on Expense)", () => {
      const sql = movementStatusMigrationSql();
      expect(sql.toLowerCase()).not.toContain(`update "expense"`);
      expect(sql.toLowerCase()).not.toContain(`delete from "expense"`);
    });
  });

  describe("database pins", () => {
    it("exposes PENDING and PAID in the MovementStatus enum", async () => {
      const rows = await prisma.$queryRaw<{ value: string }[]>`
        SELECT unnest(enum_range(NULL::"MovementStatus")) AS "value"
      `;
      const values = rows.map((row) => row.value);
      expect(values).toEqual(["PENDING", "PAID"]);
    });

    it("defaults a new movement to PAID", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Expense" ("id", "ownerId", "amount", "occurredAt") VALUES ('${randomUUID()}', 'owner-1', 1000, '2026-09-01T12:00:00.000Z')`,
      );
      const row = await prisma.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "Expense" WHERE "ownerId" = 'owner-1'
      `;
      expect(row[0]?.status).toBe("PAID");
    });

    it("stores a PENDING status", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Expense" ("id", "ownerId", "amount", "occurredAt", "status") VALUES ('${randomUUID()}', 'owner-1', 2500, '2026-09-01T12:00:00.000Z', 'PENDING'::"MovementStatus")`,
      );
      const row = await prisma.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "Expense" WHERE "ownerId" = 'owner-1'
      `;
      expect(row[0]?.status).toBe("PENDING");
    });

    it("preserves existing rows as PAID after the migration", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Expense" ("id", "ownerId", "amount", "occurredAt") VALUES ('${randomUUID()}', 'owner-1', 1000, '2026-09-01T12:00:00.000Z')`,
      );
      execSync("npx --no-install prisma migrate deploy", {
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: "pipe",
      });
      const row = await prisma.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "Expense" WHERE "ownerId" = 'owner-1'
      `;
      expect(row[0]?.status).toBe("PAID");
    });
  });
});