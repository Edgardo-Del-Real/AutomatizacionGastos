import { execSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaCategoryRepository } from "../categories/categories.repository";
import { CategoryService } from "../categories/categories.service";
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

type SeedMovement = {
  ownerId: string;
  amount: number;
  currency?: string;
  category?: string | null;
  note?: string | null;
  occurredAt?: string;
  type: "EXPENSE" | "INCOME" | "SAVINGS";
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
        occurredAt: new Date(movement.occurredAt ?? "2026-09-15T12:00:00.000Z"),
        type: movement.type,
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
    const day = daily.find((bucket) => bucket.day === "2026-09-15");
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
});