import { execSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaCategoryRepository } from "../categories/categories.repository";
import { CategoryService } from "../categories/categories.service";
import { PrismaExpenseRepository } from "../expenses/expenses.repository";
import { PrismaMovementRepository } from "./movements.repository";
import { MovementService } from "./movements.service";
import type { ViewerScope } from "./movements.types";

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

const BA_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Current month key in the Buenos Aires timezone (matches the service). */
function currentBaMonthKey(): string {
  const now = new Date(Date.now() - BA_OFFSET_MS);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function priorBaMonthKey(): string {
  const now = new Date(Date.now() - BA_OFFSET_MS);
  const prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Day key of the current Buenos Aires day (matches the service's daily buckets). */
function currentBaDayKey(): string {
  const now = new Date(Date.now() - BA_OFFSET_MS);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Noon on the current Buenos Aires day — always inside the current-month bucket
 * and the 30-day daily window, on any calendar day. A fixed calendar date (e.g.
 * "2026-09-15") drifts out of the current-month bucket and the daily window.
 */
function currentBaDayNoonIso(): string {
  const now = new Date(Date.now() - BA_OFFSET_MS);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0),
  ).toISOString();
}

type SeedMovement = {
  ownerId: string;
  amount: number;
  currency?: string;
  category?: string | null;
  note?: string | null;
  occurredAt?: string;
  type: "EXPENSE" | "INCOME" | "SAVINGS";
  savingsOrigin?: "AUTO_SPLIT" | "MANUAL";
};

const OWNER = "owner-1";

describe("movements savings exclusion (D1–D3)", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let repository: PrismaMovementRepository;
  let service: MovementService;
  const scope: ViewerScope = { viewerId: OWNER, partnerId: null, visibility: "all" };

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    repository = new PrismaMovementRepository(prisma);
    const categoryService = new CategoryService(new PrismaCategoryRepository(prisma));
    service = new MovementService(repository, categoryService);
    app = buildApp({ prisma });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
    await prisma.categoryKeyword.deleteMany();
    await prisma.category.deleteMany();
    await prisma.savingsRule.deleteMany();
  });

  async function seed(movement: SeedMovement): Promise<void> {
    await prisma.expense.create({
      data: {
        ownerId: movement.ownerId,
        amount: movement.amount,
        currency: movement.currency ?? "ARS",
        category: movement.category ?? null,
        note: movement.note ?? null,
        occurredAt: new Date(movement.occurredAt ?? currentBaDayNoonIso()),
        type: movement.type,
        savingsOrigin: movement.savingsOrigin,
      },
    });
  }

  async function seedExclusionFixture(): Promise<void> {
    await seed({ ownerId: OWNER, amount: 900, type: "INCOME", note: "sueldo", category: "work" });
    await seed({ ownerId: OWNER, amount: 100, type: "SAVINGS", note: "sueldo", category: "ahorro" });
    await seed({ ownerId: OWNER, amount: 300, type: "EXPENSE", note: "mercado", category: "food" });
  }

  it("summaryKpis excludes SAVINGS from income and expenses", async () => {
    await seedExclusionFixture();
    const kpis = await repository.summaryKpis(scope, {});
    expect(kpis.income).toBe(900);
    expect(kpis.expenses).toBe(300);
  });

  it("summaryMonths excludes SAVINGS from income/expenses and reports the month savings", async () => {
    await seedExclusionFixture();
    const months = await repository.summaryMonths(scope);
    const current = months.find((month) => month.month === currentBaMonthKey());
    expect(current?.income).toBe(900);
    expect(current?.expenses).toBe(300);
    expect(current?.savings).toBe(100);
  });

  it("summaryDaily excludes SAVINGS from the day buckets", async () => {
    await seedExclusionFixture();
    const daily = await repository.summaryDaily(scope);
    const day = daily.find((bucket) => bucket.day === currentBaDayKey());
    expect(day?.income).toBe(900);
    expect(day?.expenses).toBe(300);
  });

  it("summaryCategories excludes the ahorro SAVINGS row entirely", async () => {
    await seedExclusionFixture();
    const categories = await repository.summaryCategories(scope, {});
    const names = categories.map((category) => category.name);
    expect(names).toContain("work");
    expect(names).toContain("food");
    expect(names).not.toContain("ahorro");
  });

  it("topByType never returns SAVINGS movements", async () => {
    await seedExclusionFixture();
    const topExpenses = await repository.topByType(scope, "EXPENSE", 5, {});
    const topIncome = await repository.topByType(scope, "INCOME", 5, {});
    expect(topExpenses.map((movement) => movement.type)).toEqual(["EXPENSE"]);
    expect(topIncome.map((movement) => movement.type)).toEqual(["INCOME"]);
  });

  it("reports kpis.savings month-scoped: 150 current month, prior month excluded", async () => {
    await seed({ ownerId: OWNER, amount: 100, type: "SAVINGS", note: "a", category: "ahorro" });
    await seed({ ownerId: OWNER, amount: 50, type: "SAVINGS", note: "b", category: "ahorro" });
    await seed({
      ownerId: OWNER,
      amount: 200,
      type: "SAVINGS",
      note: "prior",
      category: "ahorro",
      occurredAt: `${priorBaMonthKey()}-15T12:00:00.000Z`,
    });
    const summary = await service.getSummary(scope);
    expect(summary.kpis.savings).toBe(150);
  });

  it("reports mom.months[].savings per month", async () => {
    await seed({ ownerId: OWNER, amount: 150, type: "SAVINGS", note: "a", category: "ahorro" });
    await seed({
      ownerId: OWNER,
      amount: 200,
      type: "SAVINGS",
      note: "prior",
      category: "ahorro",
      occurredAt: `${priorBaMonthKey()}-15T12:00:00.000Z`,
    });
    const summary = await service.getSummary(scope);
    const current = summary.mom.months.find((month) => month.month === currentBaMonthKey());
    const prior = summary.mom.months.find((month) => month.month === priorBaMonthKey());
    expect(current?.savings).toBe(150);
    expect(prior?.savings).toBe(200);
  });

  it("GET /movements?type=SAVINGS returns only SAVINGS movements", async () => {
    await seedExclusionFixture();
    const response = await app.inject({
      method: "GET",
      url: `/movements?ownerId=${OWNER}&type=SAVINGS`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { type: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.type).toBe("SAVINGS");
  });

  it("GET /movements/summary computes balance = income − expenses with SAVINGS excluded", async () => {
    await seedExclusionFixture();
    const response = await app.inject({
      method: "GET",
      url: `/movements/summary?ownerId=${OWNER}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      kpis: { income: number; expenses: number; balance: number; savings: number };
      mom: { months: { month: string; savings: number }[] };
    };
    expect(body.kpis.income).toBe(900);
    expect(body.kpis.expenses).toBe(300);
    expect(body.kpis.balance).toBe(600);
    expect(body.kpis.savings).toBe(100);
    const current = body.mom.months.find((month) => month.month === currentBaMonthKey());
    expect(current?.savings).toBe(100);
  });

  it("GET /movements/summary with no SAVINGS reports kpis.savings 0", async () => {
    await seed({ ownerId: OWNER, amount: 500, type: "INCOME", note: "venta" });
    const response = await app.inject({
      method: "GET",
      url: `/movements/summary?ownerId=${OWNER}`,
    });
    const body = response.json() as { kpis: { savings: number } };
    expect(body.kpis.savings).toBe(0);
  });

  // manual-savings (D1, required scenario "Auto-split stamps AUTO_SPLIT"):
  // createIncomeWithSavings is the ONLY producer of AUTO_SPLIT rows — the
  // SAVINGS row it creates must carry the origin while the net INCOME row
  // stays origin-less (NULL), so legacy behavior is untouched.
  it("createIncomeWithSavings stamps AUTO_SPLIT on its SAVINGS row and leaves the INCOME row origin-less", async () => {
    const expenseRepository = new PrismaExpenseRepository(prisma);
    await expenseRepository.createIncomeWithSavings({
      ownerId: OWNER,
      gross: 1000,
      percent: 10,
      note: "sueldo",
      occurredAt: new Date(currentBaDayNoonIso()),
      netCategory: "work",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    const rows = await prisma.expense.findMany({ where: { ownerId: OWNER } });
    expect(rows).toHaveLength(2);
    const savingsRow = rows.find((row) => row.type === "SAVINGS");
    const incomeRow = rows.find((row) => row.type === "INCOME");
    expect(savingsRow?.savingsOrigin).toBe("AUTO_SPLIT");
    expect(incomeRow?.savingsOrigin).toBeNull();
  });

  // manual-savings (D2/D3): a MANUAL SAVINGS row deducts from the balance and
  // is exposed as kpis.manualSavings — the REQUESTED-period sum, separate from
  // the current-month kpis.savings.
  it("deducts MANUAL savings from the balance and exposes kpis.manualSavings", async () => {
    await seed({ ownerId: OWNER, amount: 900, type: "INCOME", note: "sueldo", category: "work" });
    await seed({
      ownerId: OWNER,
      amount: 50,
      type: "SAVINGS",
      note: "fondo",
      category: "ahorro",
      savingsOrigin: "MANUAL",
    });
    await seed({ ownerId: OWNER, amount: 300, type: "EXPENSE", note: "mercado", category: "food" });

    const summary = await service.getSummary(scope);

    expect(summary.kpis.income).toBe(900);
    expect(summary.kpis.expenses).toBe(300);
    expect(summary.kpis.manualSavings).toBe(50);
    expect(summary.kpis.savings).toBe(50);
    expect(summary.kpis.balance).toBe(550);
  });

  it("splits AUTO_SPLIT and MANUAL savings between kpis.savings and kpis.manualSavings in a mixed month", async () => {
    await seed({ ownerId: OWNER, amount: 900, type: "INCOME", note: "sueldo", category: "work" });
    await seed({
      ownerId: OWNER,
      amount: 100,
      type: "SAVINGS",
      note: "auto",
      category: "ahorro",
      savingsOrigin: "AUTO_SPLIT",
    });
    await seed({
      ownerId: OWNER,
      amount: 50,
      type: "SAVINGS",
      note: "manual",
      category: "ahorro",
      savingsOrigin: "MANUAL",
    });
    await seed({ ownerId: OWNER, amount: 300, type: "EXPENSE", note: "mercado", category: "food" });

    const summary = await service.getSummary(scope);

    expect(summary.kpis.savings).toBe(150);
    expect(summary.kpis.manualSavings).toBe(50);
    expect(summary.kpis.balance).toBe(550);
  });

  it("deducts MANUAL savings within the requested period only (prior-month rows excluded)", async () => {
    await seed({ ownerId: OWNER, amount: 900, type: "INCOME", note: "sueldo", category: "work" });
    await seed({
      ownerId: OWNER,
      amount: 50,
      type: "SAVINGS",
      note: "fondo",
      category: "ahorro",
      savingsOrigin: "MANUAL",
    });
    await seed({
      ownerId: OWNER,
      amount: 30,
      type: "SAVINGS",
      note: "prior fondo",
      category: "ahorro",
      savingsOrigin: "MANUAL",
      occurredAt: `${priorBaMonthKey()}-15T12:00:00.000Z`,
    });
    await seed({ ownerId: OWNER, amount: 300, type: "EXPENSE", note: "mercado", category: "food" });

    const currentKey = currentBaMonthKey();
    const period = { from: `${currentKey}-01`, to: `${currentKey}-31` };
    const summary = await service.getSummary(scope, period.from, period.to);

    expect(summary.kpis.manualSavings).toBe(50);
    expect(summary.kpis.balance).toBe(550);
  });

  it("keeps legacy NULL-origin SAVINGS rows outside kpis.manualSavings (history identical)", async () => {
    await seedExclusionFixture();

    const summary = await service.getSummary(scope);

    expect(summary.kpis.manualSavings).toBe(0);
    expect(summary.kpis.balance).toBe(600);
    expect(summary.kpis.savings).toBe(100);
  });

  it("returns the money to the balance when a MANUAL savings movement is deleted", async () => {
    await seed({ ownerId: OWNER, amount: 900, type: "INCOME", note: "sueldo", category: "work" });
    await seed({ ownerId: OWNER, amount: 300, type: "EXPENSE", note: "mercado", category: "food" });
    await seed({
      ownerId: OWNER,
      amount: 50,
      type: "SAVINGS",
      note: "fondo",
      category: "ahorro",
      savingsOrigin: "MANUAL",
    });
    const rows = await prisma.expense.findMany({
      where: { ownerId: OWNER, type: "SAVINGS" },
    });
    expect(rows).toHaveLength(1);
    await service.deleteMovement(OWNER, rows[0]!.id);

    const summary = await service.getSummary(scope);

    expect(summary.kpis.manualSavings).toBe(0);
    expect(summary.kpis.balance).toBe(600);
  });
});