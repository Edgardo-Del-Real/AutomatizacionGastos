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

  async function seedMovement(type: "EXPENSE" | "INCOME" | "SAVINGS"): Promise<string> {
    const row = await prisma.expense.create({
      data: {
        ownerId: "owner-1",
        amount: 500,
        currency: "ARS",
        category: type === "SAVINGS" ? "ahorro" : null,
        note: "mov",
        occurredAt: new Date("2026-09-15T12:00:00.000Z"),
        type,
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
});