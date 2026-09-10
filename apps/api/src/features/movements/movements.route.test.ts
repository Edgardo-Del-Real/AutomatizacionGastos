import { execSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
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

type SeedMovement = {
  ownerId: string;
  amount: number;
  currency: string;
  category?: string | null;
  note?: string | null;
  occurredAt: string;
  type: "EXPENSE" | "INCOME";
};

describe("movements route", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    app = buildApp({ prisma });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
  });

  async function seed(movement: SeedMovement): Promise<void> {
    await prisma.expense.create({
      data: {
        ownerId: movement.ownerId,
        amount: movement.amount,
        currency: movement.currency,
        category: movement.category ?? null,
        note: movement.note ?? null,
        occurredAt: new Date(movement.occurredAt),
        type: movement.type,
      },
    });
  }

  describe("GET /movements", () => {
    it("returns matching movements for combined filters, newest first", async () => {
      await seed({
        ownerId: "owner-1",
        amount: 1000,
        currency: "ARS",
        category: "sales",
        note: "venta online",
        occurredAt: "2026-08-10T12:00:00.000Z",
        type: "INCOME",
      });
      await seed({
        ownerId: "owner-1",
        amount: 2000,
        currency: "ARS",
        category: "sales",
        note: "venta mayor",
        occurredAt: "2026-08-15T12:00:00.000Z",
        type: "INCOME",
      });
      await seed({
        ownerId: "owner-1",
        amount: 500,
        currency: "ARS",
        category: "food",
        note: "mercado",
        occurredAt: "2026-08-12T12:00:00.000Z",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "GET",
        url: "/movements?ownerId=owner-1&type=INCOME&from=2026-08-01&to=2026-08-31&q=venta",
      });

      expect(response.statusCode).toBe(200);
      const movements = response.json();
      expect(movements).toHaveLength(2);
      expect(movements[0].amount).toBe(2000);
      expect(movements[1].amount).toBe(1000);
      expect(movements.every((m: { type: string }) => m.type === "INCOME")).toBe(true);
    });

    it("returns an empty array when filters match nothing", async () => {
      await seed({
        ownerId: "owner-1",
        amount: 100,
        currency: "ARS",
        category: "food",
        note: "mercado",
        occurredAt: "2026-08-10T12:00:00.000Z",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "GET",
        url: "/movements?ownerId=owner-1&type=INCOME&category=salary",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it("rejects invalid filters with 422", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/movements?ownerId=owner-1&from=not-a-date",
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("ValidationFailed");
    });
  });

  describe("GET /movements/summary", () => {
    it("totals only ARS movements", async () => {
      await seed({
        ownerId: "owner-1",
        amount: 1000,
        currency: "ARS",
        category: "salary",
        occurredAt: "2026-08-10T12:00:00.000Z",
        type: "INCOME",
      });
      await seed({
        ownerId: "owner-1",
        amount: 500,
        currency: "USD",
        category: "food",
        occurredAt: "2026-08-10T12:00:00.000Z",
        type: "EXPENSE",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.kpis.income).toBe(1000);
      expect(summary.kpis.expenses).toBe(0);
      expect(summary.kpis.balance).toBe(1000);
      expect(summary.kpis.count).toBe(1);
      expect(summary.kpis.maxAmount).toBe(1000);
    });

    it("buckets movements to the Buenos Aires month", async () => {
      // 2026-08-01T02:59:00Z == 2026-07-31 23:59 in Buenos Aires -> July bucket.
      await seed({
        ownerId: "owner-1",
        amount: 777,
        currency: "ARS",
        category: "food",
        occurredAt: "2026-08-01T02:59:00.000Z",
        type: "EXPENSE",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      const july = summary.mom.months.find((m: { month: string }) => m.month === "2026-07");
      const august = summary.mom.months.find((m: { month: string }) => m.month === "2026-08");
      expect(july).toBeTruthy();
      expect(july.expenses).toBe(777);
      expect(august?.expenses ?? 0).toBe(0);
    });

    it("returns zero-filled kpis/daily and empty categories for no data", async () => {
      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-empty" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.kpis).toEqual({
        income: 0,
        expenses: 0,
        balance: 0,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 0,
        count: 0,
      });
      expect(summary.mom.months).toHaveLength(6);
      expect(summary.daily).toHaveLength(30);
      expect(
        summary.daily.every(
          (d: { income: number; expenses: number; balance: number }) =>
            d.income === 0 && d.expenses === 0 && d.balance === 0,
        ),
      ).toBe(true);
      expect(summary.categories).toEqual([]);
    });

    it("returns month-over-month income, expenses and balance", async () => {
      await seed({
        ownerId: "owner-1",
        amount: 100,
        currency: "ARS",
        category: "salary",
        occurredAt: "2026-06-15T12:00:00.000Z",
        type: "INCOME",
      });
      await seed({
        ownerId: "owner-1",
        amount: 50,
        currency: "ARS",
        category: "food",
        occurredAt: "2026-07-15T12:00:00.000Z",
        type: "EXPENSE",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      const june = summary.mom.months.find((m: { month: string }) => m.month === "2026-06");
      const july = summary.mom.months.find((m: { month: string }) => m.month === "2026-07");
      expect(june.income).toBe(100);
      expect(june.balance).toBe(100);
      expect(july.expenses).toBe(50);
      expect(july.balance).toBe(-50);
    });
  });
});
