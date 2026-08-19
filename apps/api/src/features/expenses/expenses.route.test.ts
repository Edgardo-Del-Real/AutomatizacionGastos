import { execSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { expenseSummarySchema } from "@rita/contracts";
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

describe("expenses route", () => {
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

  it("creates an expense with the given payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: {
        amount: 1200.5,
        currency: "ARS",
        category: "food",
        note: "Mercado",
        occurredAt: "2026-08-01T12:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.amount).toBe(1200.5);
    expect(body.ownerId).toBe("owner-1");
    expect(body.currency).toBe("ARS");
    expect(body.category).toBe("food");
    expect(body.note).toBe("Mercado");
    expect(body.id).toBeTruthy();
  });

  it("rejects an invalid payload with 422 ValidationFailed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: -5, occurredAt: "2026-08-01T12:00:00.000Z" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ValidationFailed");
  });

  it("rejects a request without an owner id with 422", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/expenses",
      payload: { amount: 100, occurredAt: "2026-08-01T12:00:00.000Z" },
    });

    expect(response.statusCode).toBe(422);
  });

  it("lists expenses for an owner only", async () => {
    await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 100, occurredAt: "2026-08-01T12:00:00.000Z" },
    });
    await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 200, occurredAt: "2026-08-02T12:00:00.000Z" },
    });
    await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-2" },
      payload: { amount: 300, occurredAt: "2026-08-03T12:00:00.000Z" },
    });

    const response = await app.inject({ method: "GET", url: "/expenses?ownerId=owner-1" });

    expect(response.statusCode).toBe(200);
    const expenses = response.json();
    expect(expenses).toHaveLength(2);
  });

  it("excludes INCOME movements from the expense list", async () => {
    await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 100, occurredAt: "2026-08-01T12:00:00.000Z" },
    });
    await prisma.expense.create({
      data: {
        ownerId: "owner-1",
        amount: 99999,
        currency: "ARS",
        occurredAt: new Date("2026-08-02T12:00:00.000Z"),
        type: "INCOME",
      },
    });

    const response = await app.inject({ method: "GET", url: "/expenses?ownerId=owner-1" });

    expect(response.statusCode).toBe(200);
    const expenses = response.json();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount).toBe(100);
  });

  it("gets an expense by id for the owner", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 100, occurredAt: "2026-08-01T12:00:00.000Z" },
    });
    const expense = created.json();

    const response = await app.inject({ method: "GET", url: `/expenses/${expense.id}?ownerId=owner-1` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: expense.id, ownerId: "owner-1", amount: 100 });
  });

  it("gets 404 when the expense does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/expenses/exp_missing?ownerId=owner-1" });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NotFound");
  });

  it("gets 404 when the expense belongs to another owner", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 100, occurredAt: "2026-08-01T12:00:00.000Z" },
    });
    const expense = created.json();

    const response = await app.inject({ method: "GET", url: `/expenses/${expense.id}?ownerId=owner-2` });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NotFound");
  });

  it("rejects a get-by-id request without an ownerId query parameter with 422", async () => {
    const response = await app.inject({ method: "GET", url: "/expenses/exp_1" });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ValidationFailed");
  });

  it("deletes an expense by id for the owner and returns 204", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 100, occurredAt: "2026-08-01T12:00:00.000Z" },
    });
    const expense = created.json();

    const response = await app.inject({
      method: "DELETE",
      url: `/expenses/${expense.id}`,
      headers: { "x-owner-id": "owner-1" },
    });

    expect(response.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: `/expenses/${expense.id}?ownerId=owner-1` });
    expect(after.statusCode).toBe(404);
  });

  it("deletes 404 when the expense does not exist", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/expenses/exp_missing",
      headers: { "x-owner-id": "owner-1" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NotFound");
  });

  it("deletes 404 when the expense belongs to another owner", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 100, occurredAt: "2026-08-01T12:00:00.000Z" },
    });
    const expense = created.json();

    const response = await app.inject({
      method: "DELETE",
      url: `/expenses/${expense.id}`,
      headers: { "x-owner-id": "owner-2" },
    });

    expect(response.statusCode).toBe(404);

    const after = await app.inject({ method: "GET", url: `/expenses/${expense.id}?ownerId=owner-1` });
    expect(after.statusCode).toBe(200);
  });

  it("rejects a delete request without an x-owner-id header with 422", async () => {
    const response = await app.inject({ method: "DELETE", url: "/expenses/exp_1" });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ValidationFailed");
  });

  it("returns monthly summary buckets for the owner across months", async () => {
    const now = new Date();
    const currentMonth = monthKey(now);
    const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

    await seedExpense("owner-1", 100, dateInMonth(now, 0, 5));
    await seedExpense("owner-1", 200, dateInMonth(now, 0, 12));
    await seedExpense("owner-1", 50, dateInMonth(now, 1, 5));
    await seedExpense("owner-2", 9999, dateInMonth(now, 0, 20));

    const response = await app.inject({ method: "GET", url: "/expenses/summary?ownerId=owner-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      months: [
        { month: lastMonth, count: 1, totalAmount: 50 },
        { month: currentMonth, count: 2, totalAmount: 300 },
      ],
    });
  });

  it("summary response matches expenseSummarySchema and excludes INCOME", async () => {
    const now = new Date();
    const currentMonth = monthKey(now);

    await seedExpense("owner-1", 100, dateInMonth(now, 0, 5));
    await prisma.expense.create({
      data: {
        ownerId: "owner-1",
        amount: 99999,
        currency: "ARS",
        occurredAt: new Date(dateInMonth(now, 0, 6)),
        type: "INCOME",
      },
    });

    const response = await app.inject({ method: "GET", url: "/expenses/summary?ownerId=owner-1" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(expenseSummarySchema.safeParse(body).success).toBe(true);
    expect(body.months).toEqual([{ month: currentMonth, count: 1, totalAmount: 100 }]);
  });

  it("returns an empty months array for an owner with no expenses in the window", async () => {
    const response = await app.inject({ method: "GET", url: "/expenses/summary?ownerId=owner-empty" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ months: [] });
  });

  it("rejects a summary request without an ownerId query parameter with 422", async () => {
    const response = await app.inject({ method: "GET", url: "/expenses/summary" });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ValidationFailed");
  });

  async function seedExpense(owner: string, amount: number, occurredAt: string): Promise<void> {
    const response = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": owner },
      payload: { amount, occurredAt },
    });
    expect(response.statusCode).toBe(201);
  }

  function monthKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function dateInMonth(now: Date, monthsAgo: number, day: number): string {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day, 12, 0, 0)).toISOString();
  }
});
