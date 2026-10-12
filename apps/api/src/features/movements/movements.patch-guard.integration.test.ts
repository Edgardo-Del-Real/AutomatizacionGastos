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

describe("PATCH /movements/:id savings-category guard (D9)", () => {
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
    await prisma.savingsRule.deleteMany();
  });

  async function seedAhorro(): Promise<void> {
    await prisma.category.upsert({
      where: { ownerId_name: { ownerId: "owner-1", name: "ahorro" } },
      update: {},
      create: { ownerId: "owner-1", name: "ahorro", type: "SAVINGS" },
    });
  }

  async function seedCategory(name: string, type: "NORMAL" | "SAVINGS"): Promise<void> {
    await prisma.category.upsert({
      where: { ownerId_name: { ownerId: "owner-1", name } },
      update: {},
      create: { ownerId: "owner-1", name, type },
    });
  }

  async function seedMovement(
    type: "EXPENSE" | "INCOME" | "SAVINGS",
    savingsOrigin?: "AUTO_SPLIT" | "MANUAL",
  ): Promise<string> {
    const row = await prisma.expense.create({
      data: {
        ownerId: "owner-1",
        amount: 500,
        currency: "ARS",
        category: type === "SAVINGS" ? "ahorro" : null,
        note: "mov",
        occurredAt: new Date("2026-09-15T12:00:00.000Z"),
        type,
        savingsOrigin,
      },
    });
    return row.id;
  }

  it("rejects assigning ahorro to an EXPENSE movement with 422 and leaves it unchanged", async () => {
    await seedAhorro();
    const id = await seedMovement("EXPENSE");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { category: "ahorro" },
    });

    expect(response.statusCode).toBe(422);
    const row = await prisma.expense.findUnique({ where: { id } });
    expect(row?.category).toBeNull();
  });

  it("rejects assigning ahorro to an INCOME movement with 422", async () => {
    await seedAhorro();
    const id = await seedMovement("INCOME");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { category: "ahorro" },
    });

    expect(response.statusCode).toBe(422);
  });

  it("allows assigning ahorro to a SAVINGS movement", async () => {
    await seedAhorro();
    const id = await seedMovement("SAVINGS");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { note: "ahorro del mes" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("still rejects a category that is not the owner's on any movement type", async () => {
    const id = await seedMovement("SAVINGS");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { category: "nope" },
    });

    expect(response.statusCode).toBe(422);
  });

  // manual-savings PATCH pin: a MANUAL row is pinned to the ahorro category —
  // drifting it to another category OR clearing it with null is rejected (422),
  // the row stays untouched, while amount/note edits keep working and
  // AUTO_SPLIT/NULL-origin rows keep their existing category freedom.
  it("rejects drifting the category of a MANUAL savings movement with 422 and leaves it unchanged", async () => {
    await seedAhorro();
    await seedCategory("bolsillo", "NORMAL");
    const id = await seedMovement("SAVINGS", "MANUAL");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { category: "bolsillo" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ValidationFailed");
    const row = await prisma.expense.findUnique({ where: { id } });
    expect(row?.category).toBe("ahorro");
  });

  it("rejects clearing the category of a MANUAL savings movement with 422", async () => {
    await seedAhorro();
    const id = await seedMovement("SAVINGS", "MANUAL");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { category: null },
    });

    expect(response.statusCode).toBe(422);
    const row = await prisma.expense.findUnique({ where: { id } });
    expect(row?.category).toBe("ahorro");
  });

  it("still allows editing the amount of a MANUAL savings movement and the balance recomputes", async () => {
    await seedAhorro();
    await prisma.expense.create({
      data: {
        ownerId: "owner-1",
        amount: 900,
        currency: "ARS",
        category: "work",
        note: "sueldo",
        occurredAt: new Date("2026-09-15T12:00:00.000Z"),
        type: "INCOME",
      },
    });
    const id = await seedMovement("SAVINGS", "MANUAL");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { amount: 80 },
    });

    expect(response.statusCode).toBe(200);
    const row = await prisma.expense.findUnique({ where: { id } });
    expect(row?.amount.toNumber()).toBe(80);

    const summary = await app.inject({
      method: "GET",
      url: `/movements/summary?ownerId=owner-1&from=2026-09-01&to=2026-09-30`,
    });
    const body = summary.json() as { kpis: { income: number; expenses: number; balance: number; manualSavings: number } };
    expect(body.kpis.manualSavings).toBe(80);
    expect(body.kpis.balance).toBe(820);
  });

  it("keeps category freedom on AUTO_SPLIT savings movements", async () => {
    await seedAhorro();
    await seedCategory("bolsillo", "NORMAL");
    const id = await seedMovement("SAVINGS", "AUTO_SPLIT");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { category: "bolsillo" },
    });

    expect(response.statusCode).toBe(200);
    const row = await prisma.expense.findUnique({ where: { id } });
    expect(row?.category).toBe("bolsillo");
  });

  it("keeps category freedom on legacy NULL-origin savings movements", async () => {
    await seedAhorro();
    await seedCategory("bolsillo", "NORMAL");
    const id = await seedMovement("SAVINGS");

    const response = await app.inject({
      method: "PATCH",
      url: `/movements/${id}`,
      headers: { "x-owner-id": "owner-1" },
      payload: { category: "bolsillo" },
    });

    expect(response.statusCode).toBe(200);
    const row = await prisma.expense.findUnique({ where: { id } });
    expect(row?.category).toBe("bolsillo");
  });
});