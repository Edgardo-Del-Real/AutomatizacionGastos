import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaExpenseRepository } from "./expenses.repository";

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

describe("PrismaExpenseRepository.createIncomeWithSavings (integration)", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;
  let repository: PrismaExpenseRepository;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    repository = new PrismaExpenseRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
    await prisma.categoryKeyword.deleteMany();
    await prisma.category.deleteMany();
    await prisma.savingsRule.deleteMany();
  });

  it("persists the net INCOME keeping netCategory and the SAVINGS in savingsCategory with the rounding invariant", async () => {
    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 10,
      percent: 33,
      note: "sueldo",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(result.net?.amount).toBe(6.7);
    expect(result.net?.category).toBe("Sueldo");
    expect(result.savings?.amount).toBe(3.3);
    expect(result.savings?.category).toBe("ahorro");

    const rows = await prisma.expense.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.type).sort()).toEqual(["INCOME", "SAVINGS"]);
    expect(result.net!.amount + result.savings!.amount).toBe(10);
  });

  it("pct=100 persists only the SAVINGS movement", async () => {
    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 1000,
      percent: 100,
      note: "todo",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(result.net).toBeNull();
    expect(result.savings?.amount).toBe(1000);
    expect(result.savings?.category).toBe("ahorro");
    const rows = await prisma.expense.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("SAVINGS");
  });

  it("rounds savings to zero for a negligible percent and persists the whole INCOME", async () => {
    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 0.01,
      percent: 1,
      note: "minimo",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(result.net?.amount).toBe(0.01);
    expect(result.net?.category).toBe("Sueldo");
    expect(result.savings).toBeNull();
    const rows = await prisma.expense.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("INCOME");
  });
});