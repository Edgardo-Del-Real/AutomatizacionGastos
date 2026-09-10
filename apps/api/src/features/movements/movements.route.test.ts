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
  currency?: string;
  category?: string | null;
  note?: string | null;
  occurredAt?: string;
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
    await prisma.categoryKeyword.deleteMany();
    await prisma.category.deleteMany();
  });

  async function seed(movement: SeedMovement): Promise<void> {
    await prisma.expense.create({
      data: {
        ownerId: movement.ownerId,
        amount: movement.amount,
        currency: movement.currency ?? "ARS",
        category: movement.category ?? null,
        note: movement.note ?? null,
        occurredAt: new Date(movement.occurredAt ?? "2026-08-10T12:00:00.000Z"),
        type: movement.type,
      },
    });
  }

  async function createMovement(movement: SeedMovement): Promise<{ id: string }> {
    return prisma.expense.create({
      data: {
        ownerId: movement.ownerId,
        amount: movement.amount,
        currency: movement.currency ?? "ARS",
        category: movement.category ?? null,
        note: movement.note ?? null,
        occurredAt: new Date(movement.occurredAt ?? "2026-08-10T12:00:00.000Z"),
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

  describe("PATCH /movements/:id", () => {
    it("updates the note only, leaving amount and category unchanged", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 1000,
        category: "food",
        note: "mercado",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: { note: "cena" },
      });

      expect(response.statusCode).toBe(200);
      const updated = response.json();
      expect(updated.note).toBe("cena");
      expect(updated.amount).toBe(1000);
      expect(updated.category).toBe("food");
    });

    it("clears the category with category: null", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 1000,
        category: "food",
        note: "mercado",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: { category: null },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().category).toBeNull();
    });

    it("sets a category that belongs to the owner", async () => {
      await prisma.category.create({ data: { ownerId: "owner-1", name: "Cafe" } });
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 2500,
        category: null,
        note: "cafe",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: { category: "Cafe" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().category).toBe("Cafe");
    });

    it("rejects a category that is not the owner's with 422", async () => {
      await prisma.category.create({ data: { ownerId: "owner-1", name: "Cafe" } });
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 2500,
        category: null,
        note: "cafe",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: { category: "NoExiste" },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("ValidationFailed");
    });

    it("updates an INCOME movement", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 3000,
        category: "salary",
        note: "sueldo",
        type: "INCOME",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: { amount: 5000 },
      });

      expect(response.statusCode).toBe(200);
      const updated = response.json();
      expect(updated.type).toBe("INCOME");
      expect(updated.amount).toBe(5000);
    });

    it("rejects an empty patch with 422", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 1000,
        category: null,
        note: null,
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("ValidationFailed");
    });

    it("returns 404 for a missing movement", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/movements/does-not-exist",
        headers: { "x-owner-id": "owner-1" },
        payload: { note: "cena" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 404 for another owner's movement", async () => {
      const movement = await createMovement({
        ownerId: "owner-2",
        amount: 1000,
        category: null,
        note: "privado",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: { note: "cena" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /movements/:id", () => {
    it("deletes an EXPENSE movement", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 1000,
        category: null,
        note: "mercado",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(204);
      expect(await prisma.expense.count({ where: { id: movement.id } })).toBe(0);
    });

    it("deletes an INCOME movement", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 3000,
        category: "salary",
        note: "sueldo",
        type: "INCOME",
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(204);
      expect(await prisma.expense.count({ where: { id: movement.id } })).toBe(0);
    });

    it("returns 404 for a missing movement", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/movements/does-not-exist",
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 404 for another owner's movement", async () => {
      const movement = await createMovement({
        ownerId: "owner-2",
        amount: 1000,
        category: null,
        note: "privado",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(404);
      expect(await prisma.expense.count({ where: { id: movement.id } })).toBe(1);
    });
  });

  describe("GET /movements/categories", () => {
    it("returns the owner's categories with their keyword rules", async () => {
      const category = await prisma.category.create({ data: { ownerId: "owner-1", name: "Cafe" } });
      await prisma.categoryKeyword.create({
        data: { ownerId: "owner-1", categoryId: category.id, keyword: "cafe" },
      });

      const response = await app.inject({
        method: "GET",
        url: "/movements/categories?ownerId=owner-1",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([{ name: "Cafe", keywords: ["cafe"] }]);
    });

    it("returns an empty list for an owner without categories", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/movements/categories?ownerId=owner-empty",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  describe("DELETE /expenses/:id (legacy endpoint untouched)", () => {
    it("still deletes an expense via the legacy route", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 1000,
        category: "food",
        note: "mercado",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/expenses/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(204);
      expect(await prisma.expense.count({ where: { id: movement.id } })).toBe(0);
    });
  });
});
