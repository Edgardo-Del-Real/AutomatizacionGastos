import { execSync } from "node:child_process";
import Fastify, { type FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaCategoryRepository } from "../categories/categories.repository";
import { CategoryService } from "../categories/categories.service";
import { HouseholdService } from "../household/household.service";
import { PrismaMovementRepository } from "./movements.repository";
import { MovementService } from "./movements.service";
import { movementsRoute } from "./movements.route";

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

/** Buenos Aires wall-clock now (the summary buckets by BA, never by UTC). */
function baNow(): Date {
  return new Date(Date.now() - BA_OFFSET_MS);
}

function baMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month following the current Buenos Aires month (the `planned` target). */
function nextBaMonthKey(): string {
  const now = baNow();
  return baMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
}

/**
 * Noon on the current Buenos Aires day — always inside the mom months window
 * (current month) and the 30-day daily window (today), on any calendar day.
 * A fixed day-of-month anchor (e.g. the 5th) lands outside the daily window
 * whenever the suite runs on the 1st–4th of the month.
 */
function thisMonthNoonIso(): string {
  const now = baNow();
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
  status?: "PENDING" | "PAID";
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
        status: movement.status ?? "PAID",
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
        status: movement.status ?? "PAID",
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
        savings: 0,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 0,
        count: 0,
        countThisMonth: 0,
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

    it("counts current-month movements separately from the all-time total", async () => {
      // Relative to now (Buenos Aires) so the test never goes stale.
      const baNow = new Date(Date.now() - BA_OFFSET_MS);
      const thisMonthNoon = new Date(
        Date.UTC(baNow.getUTCFullYear(), baNow.getUTCMonth(), 5, 12, 0, 0),
      ).toISOString();
      const lastMonthNoon = new Date(
        Date.UTC(baNow.getUTCFullYear(), baNow.getUTCMonth() - 1, 5, 12, 0, 0),
      ).toISOString();

      await seed({
        ownerId: "owner-1",
        amount: 100,
        currency: "ARS",
        category: "food",
        occurredAt: thisMonthNoon,
        type: "EXPENSE",
      });
      await seed({
        ownerId: "owner-1",
        amount: 200,
        currency: "ARS",
        category: "food",
        occurredAt: lastMonthNoon,
        type: "EXPENSE",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.kpis.count).toBe(2);
      expect(summary.kpis.countThisMonth).toBe(1);
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

  describe("GET /movements visibility filter (household duo)", () => {
    let duoApp: FastifyInstance;

    beforeAll(async () => {
      const categoryService = new CategoryService(new PrismaCategoryRepository(prisma));
      const movementService = new MovementService(new PrismaMovementRepository(prisma), categoryService);
      duoApp = Fastify();
      void duoApp.register(movementsRoute, {
        movementService,
        categoryService,
        householdService: new HouseholdService([
          { ownerId: "rita", name: "Rita", chatId: 111 },
          { ownerId: "edgardo", name: "Edgardo", chatId: 222 },
        ]),
      });
      await duoApp.ready();
    });

    afterAll(async () => {
      await duoApp.close();
    });

    async function seedDuo(): Promise<void> {
      const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const rows = [
        { ownerId: "rita", amount: 100, note: "privado rita", visibility: "INDIVIDUAL" as const },
        { ownerId: "rita", amount: 200, note: "compartido rita", visibility: "SHARED" as const },
        { ownerId: "edgardo", amount: 300, note: "privado edgardo", visibility: "INDIVIDUAL" as const },
        { ownerId: "edgardo", amount: 400, note: "compartido edgardo", visibility: "SHARED" as const },
      ];
      for (const row of rows) {
        await prisma.expense.create({
          data: {
            ownerId: row.ownerId,
            amount: row.amount,
            currency: "ARS",
            category: "casa",
            note: row.note,
            occurredAt: now,
            type: "EXPENSE",
            visibility: row.visibility,
          },
        });
      }
    }

    it("rejects an invalid visibility value with 422 on both endpoints", async () => {
      const list = await duoApp.inject({ method: "GET", url: "/movements?ownerId=rita&visibility=foo" });
      expect(list.statusCode).toBe(422);
      expect(list.json().code).toBe("ValidationFailed");

      const summary = await duoApp.inject({
        method: "GET",
        url: "/movements/summary?ownerId=rita&visibility=foo",
      });
      expect(summary.statusCode).toBe(422);
      expect(summary.json().code).toBe("ValidationFailed");
    });

    it("visibility=mine returns only the viewer's own movements", async () => {
      await seedDuo();

      const response = await duoApp.inject({
        method: "GET",
        url: "/movements?ownerId=rita&visibility=mine",
      });

      expect(response.statusCode).toBe(200);
      const notes = (response.json() as { note: string | null }[]).map((m) => m.note).sort();
      expect(notes).toEqual(["compartido rita", "privado rita"]);
    });

    it("visibility=shared returns only SHARED movements visible to the viewer", async () => {
      await seedDuo();

      const response = await duoApp.inject({
        method: "GET",
        url: "/movements?ownerId=rita&visibility=shared",
      });

      expect(response.statusCode).toBe(200);
      const notes = (response.json() as { note: string | null }[]).map((m) => m.note).sort();
      expect(notes).toEqual(["compartido edgardo", "compartido rita"]);
    });

    it("defaults to all: own movements plus the partner's SHARED ones", async () => {
      await seedDuo();

      const response = await duoApp.inject({ method: "GET", url: "/movements?ownerId=rita" });

      expect(response.statusCode).toBe(200);
      const notes = (response.json() as { note: string | null }[]).map((m) => m.note).sort();
      expect(notes).toEqual(["compartido edgardo", "compartido rita", "privado rita"]);
      expect(notes).not.toContain("privado edgardo");
    });

    it("scopes the summary by visibility (mine excludes the partner's SHARED)", async () => {
      await seedDuo();

      const response = await duoApp.inject({
        method: "GET",
        url: "/movements/summary?ownerId=rita&visibility=mine",
      });

      expect(response.statusCode).toBe(200);
      const summary = response.json() as { kpis: { expenses: number; count: number } };
      expect(summary.kpis.expenses).toBe(300);
      expect(summary.kpis.count).toBe(2);
    });
  });

  describe("planned expenses (PENDING exclusion + planned summary)", () => {
    it("excludes PENDING from kpis: income/expenses/balance/count/maxAmount", async () => {
      const noon = thisMonthNoonIso();
      await seed({
        ownerId: "owner-1",
        amount: 900,
        category: "salary",
        note: "sueldo",
        occurredAt: noon,
        type: "INCOME",
      });
      await seed({
        ownerId: "owner-1",
        amount: 300,
        category: "food",
        note: "mercado",
        occurredAt: noon,
        type: "EXPENSE",
      });
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.kpis.income).toBe(900);
      expect(summary.kpis.expenses).toBe(300);
      expect(summary.kpis.balance).toBe(600);
      expect(summary.kpis.count).toBe(2);
      expect(summary.kpis.maxAmount).toBe(900);
    });

    it("excludes PENDING from the month and day buckets", async () => {
      const noon = thisMonthNoonIso();
      const monthKey = baMonthKey(baNow());
      await seed({
        ownerId: "owner-1",
        amount: 300,
        category: "food",
        note: "mercado",
        occurredAt: noon,
        type: "EXPENSE",
      });
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      const month = summary.mom.months.find((m: { month: string }) => m.month === monthKey);
      expect(month).toBeTruthy();
      expect(month.expenses).toBe(300);
      const day = summary.daily.find((d: { day: string }) => d.day === noon.slice(0, 10));
      expect(day).toBeTruthy();
      expect(day.expenses).toBe(300);
    });

    it("excludes PENDING from the category breakdown", async () => {
      const noon = thisMonthNoonIso();
      await seed({
        ownerId: "owner-1",
        amount: 300,
        category: "food",
        note: "mercado",
        occurredAt: noon,
        type: "EXPENSE",
      });
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "food",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      const food = summary.categories.find((c: { name: string }) => c.name === "food");
      expect(food).toBeTruthy();
      expect(food.expenseAmount).toBe(300);
      expect(food.expensePercent).toBe(100);
    });

    it("excludes PENDING from the top expense list", async () => {
      const noon = thisMonthNoonIso();
      await seed({
        ownerId: "owner-1",
        amount: 300,
        category: "food",
        note: "mercado",
        occurredAt: noon,
        type: "EXPENSE",
      });
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.top.expenses).toHaveLength(1);
      expect(summary.top.expenses[0].amount).toBe(300);
      expect(summary.top.expenses[0].note).toBe("mercado");
    });

    it("keeps the mom SAVINGS column while PENDING is excluded (savings 100, planned 2500)", async () => {
      const noon = thisMonthNoonIso();
      const monthKey = baMonthKey(baNow());
      await seed({
        ownerId: "owner-1",
        amount: 100,
        category: "ahorro",
        note: "ahorro mensual",
        occurredAt: noon,
        type: "SAVINGS",
      });
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      const month = summary.mom.months.find((m: { month: string }) => m.month === monthKey);
      expect(month).toBeTruthy();
      expect(month.savings).toBe(100);
      expect(month.expenses).toBe(0);
      expect(summary.planned).toEqual({ month: nextBaMonthKey(), total: 2500 });
    });

    it("reports the planned total for the next Buenos Aires month", async () => {
      const noon = thisMonthNoonIso();
      const nextKey = nextBaMonthKey();
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });
      await seed({
        ownerId: "owner-1",
        amount: 1500,
        category: "services",
        note: "luz",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.planned).toEqual({ month: nextKey, total: 4000 });
    });

    it("reports planned even when from/to exclude the row's month (planned ignores filters)", async () => {
      const now = baNow();
      const lastKey = baMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
      const noon = thisMonthNoonIso();
      const nextKey = nextBaMonthKey();
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({
        method: "GET",
        url: `/movements/summary?ownerId=owner-1&from=${lastKey}-01&to=${lastKey}-28`,
      });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      // The PENDING row lives in the current month, outside the filtered range,
      // yet planned still reports the next-month total (filters are ignored).
      expect(summary.planned).toEqual({ month: nextKey, total: 2500 });
    });

    it("reports a zero planned total when no PENDING expense targets next month", async () => {
      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-empty" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.planned).toEqual({ month: nextBaMonthKey(), total: 0 });
    });

    it("derives the planned month in Buenos Aires (next-month 02:59Z lands in the current month BA)", async () => {
      const nextKey = nextBaMonthKey();
      // next-month-01T02:59:00Z == last day of the current month 23:59 in Buenos
      // Aires: the load month is the CURRENT month, so the derived month is next
      // month. A naive UTC derivation would derive the month AFTER next and the
      // row would not be counted.
      const boundaryIso = `${nextKey}-01T02:59:00.000Z`;
      await seed({
        ownerId: "owner-1",
        amount: 500,
        category: "rent",
        note: "alquiler",
        occurredAt: boundaryIso,
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.planned).toEqual({ month: nextKey, total: 500 });
    });

    it("excludes PENDING rows whose derived month is not next month (2026-08-01T02:59Z → 2026-08)", async () => {
      // Spec boundary: 2026-08-01T02:59:00Z == 2026-07-31 23:59 BA → load month
      // July → derived August. August is never the next month, so planned stays 0.
      await seed({
        ownerId: "owner-1",
        amount: 777,
        category: "rent",
        note: "alquiler",
        occurredAt: "2026-08-01T02:59:00.000Z",
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.planned).toEqual({ month: nextBaMonthKey(), total: 0 });
    });

    it("returns PENDING rows in the movement list, newest first, with their status", async () => {
      await seed({
        ownerId: "owner-1",
        amount: 300,
        category: "food",
        note: "mercado",
        occurredAt: "2026-08-10T12:00:00.000Z",
        type: "EXPENSE",
      });
      await seed({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: "2026-08-15T12:00:00.000Z",
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({ method: "GET", url: "/movements?ownerId=owner-1" });

      expect(response.statusCode).toBe(200);
      const movements = response.json();
      expect(movements).toHaveLength(2);
      expect(movements[0].status).toBe("PENDING");
      expect(movements[0].amount).toBe(2500);
      expect(movements[1].status).toBe("PAID");
    });
  });

  describe("POST /movements/:id/paid (mark paid)", () => {
    it("marks a PENDING EXPENSE as paid: status PAID, occurredAt≈now, enters KPIs", async () => {
      const noon = thisMonthNoonIso();
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        occurredAt: noon,
        type: "EXPENSE",
        status: "PENDING",
      });

      const beforeSummary = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });
      expect(beforeSummary.json().kpis.expenses).toBe(0);
      expect(beforeSummary.json().planned.total).toBe(2500);

      const start = Date.now();
      const response = await app.inject({
        method: "POST",
        url: `/movements/${movement.id}/paid`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(200);
      const paid = response.json();
      expect(paid.status).toBe("PAID");
      const paidAt = new Date(paid.occurredAt).getTime();
      expect(paidAt).toBeGreaterThanOrEqual(start - 1000);
      expect(paidAt).toBeLessThanOrEqual(Date.now() + 1000);

      const row = await prisma.expense.findFirst({ where: { id: movement.id } });
      expect(row?.status).toBe("PAID");

      const afterSummary = await app.inject({ method: "GET", url: "/movements/summary?ownerId=owner-1" });
      expect(afterSummary.json().kpis.expenses).toBe(2500);
      expect(afterSummary.json().planned.total).toBe(0);
    });

    it("rejects marking an already-PAID movement with 409 and leaves it unchanged", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        type: "EXPENSE",
      });

      const response = await app.inject({
        method: "POST",
        url: `/movements/${movement.id}/paid`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(409);
      const row = await prisma.expense.findFirst({ where: { id: movement.id } });
      expect(row?.status).toBe("PAID");
    });

    it("rejects marking an INCOME movement with 409", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 3000,
        category: "salary",
        note: "sueldo",
        type: "INCOME",
      });

      const response = await app.inject({
        method: "POST",
        url: `/movements/${movement.id}/paid`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(409);
    });

    it("returns 404 for a missing movement", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/movements/does-not-exist/paid",
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 404 for another owner's PENDING movement and leaves it PENDING", async () => {
      const movement = await createMovement({
        ownerId: "owner-2",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({
        method: "POST",
        url: `/movements/${movement.id}/paid`,
        headers: { "x-owner-id": "owner-1" },
      });

      expect(response.statusCode).toBe(404);
      const row = await prisma.expense.findFirst({ where: { id: movement.id } });
      expect(row?.status).toBe("PENDING");
    });

    it("returns 409 on a second mark-paid call after success", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        type: "EXPENSE",
        status: "PENDING",
      });

      const first = await app.inject({
        method: "POST",
        url: `/movements/${movement.id}/paid`,
        headers: { "x-owner-id": "owner-1" },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: `/movements/${movement.id}/paid`,
        headers: { "x-owner-id": "owner-1" },
      });
      expect(second.statusCode).toBe(409);
    });
  });

  describe("PATCH /movements/:id on a PENDING row", () => {
    it("edits a PENDING expense amount while keeping it PENDING", async () => {
      const movement = await createMovement({
        ownerId: "owner-1",
        amount: 2500,
        category: "rent",
        note: "alquiler",
        type: "EXPENSE",
        status: "PENDING",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/movements/${movement.id}`,
        headers: { "x-owner-id": "owner-1" },
        payload: { amount: 2600 },
      });

      expect(response.statusCode).toBe(200);
      const updated = response.json();
      expect(updated.amount).toBe(2600);
      expect(updated.status).toBe("PENDING");
    });
  });

  describe("POST /expenses (planned creation channel)", () => {
    it("persists a PENDING status created through the registration endpoint", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/expenses",
        headers: { "x-owner-id": "owner-1" },
        payload: {
          amount: 2500,
          currency: "ARS",
          category: "rent",
          note: "alquiler",
          occurredAt: new Date().toISOString(),
          type: "EXPENSE",
          status: "PENDING",
        },
      });

      expect(response.statusCode).toBe(201);
      const list = await app.inject({ method: "GET", url: "/movements?ownerId=owner-1" });
      const movements = list.json();
      expect(movements).toHaveLength(1);
      expect(movements[0].status).toBe("PENDING");
      expect(movements[0].amount).toBe(2500);
    });

    it("ignores a visibility key and persists a planned expense as INDIVIDUAL", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/expenses",
        headers: { "x-owner-id": "owner-1" },
        payload: {
          amount: 2500,
          currency: "ARS",
          category: "rent",
          note: "alquiler",
          occurredAt: new Date().toISOString(),
          type: "EXPENSE",
          status: "PENDING",
          // A stale client may still send visibility; the endpoint never
          // persists it (AD7) — planned expenses are INDIVIDUAL by design.
          visibility: "SHARED",
        },
      });

      expect(response.statusCode).toBe(201);
      const list = await app.inject({ method: "GET", url: "/movements?ownerId=owner-1" });
      const movements = list.json();
      expect(movements).toHaveLength(1);
      expect(movements[0].visibility).toBe("INDIVIDUAL");
    });
  });
});
