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

const OWNER = "owner-1";

describe("manual savings creation guard (D5/D8)", () => {
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

  async function postExpense(payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await app.inject({
      method: "POST",
      url: "/expenses",
      headers: { "x-owner-id": OWNER },
      payload,
    });
    return { status: response.statusCode, body: response.json() as Record<string, unknown> };
  }

  async function rowById(id: string) {
    return prisma.expense.findUnique({ where: { id } });
  }

  it("creates a SAVINGS movement via the API as MANUAL·ahorro·PAID·INDIVIDUAL·ARS", async () => {
    const { status, body } = await postExpense({
      type: "SAVINGS",
      amount: 50,
      note: "fondo vacaciones",
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    const row = await rowById(body.id as string);
    expect(row?.type).toBe("SAVINGS");
    expect(row?.savingsOrigin).toBe("MANUAL");
    expect(row?.category).toBe("ahorro");
    expect(row?.status).toBe("PAID");
    expect(row?.visibility).toBe("INDIVIDUAL");
    expect(row?.currency).toBe("ARS");
  });

  it("exposes the MANUAL origin on GET /movements (origin observable)", async () => {
    await postExpense({
      type: "SAVINGS",
      amount: 50,
      note: "fondo vacaciones",
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    const response = await app.inject({ method: "GET", url: `/movements?ownerId=${OWNER}` });

    expect(response.statusCode).toBe(200);
    const movements = response.json() as { type: string; savingsOrigin: string | null }[];
    const savings = movements.find((movement) => movement.type === "SAVINGS");
    expect(savings?.savingsOrigin).toBe("MANUAL");
  });

  it("rejects a SAVINGS create with a non-ahorro category with 422 and stores nothing", async () => {
    const { status } = await postExpense({
      type: "SAVINGS",
      amount: 50,
      category: "bolsillo",
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    expect(status).toBe(422);
    expect(await prisma.expense.count()).toBe(0);
  });

  it("rejects a SAVINGS create with a null category with 422 and stores nothing", async () => {
    const { status } = await postExpense({
      type: "SAVINGS",
      amount: 50,
      category: null,
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    expect(status).toBe(422);
    expect(await prisma.expense.count()).toBe(0);
  });

  it("defaults an absent category to ahorro and upserts it for the owner", async () => {
    const { status, body } = await postExpense({
      type: "SAVINGS",
      amount: 50,
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    expect(status).toBe(201);
    const row = await rowById(body.id as string);
    expect(row?.category).toBe("ahorro");
    const ahorro = await prisma.category.findUnique({
      where: { ownerId_name: { ownerId: OWNER, name: "ahorro" } },
    });
    expect(ahorro?.type).toBe("SAVINGS");
  });

  it("rejects a SAVINGS create carrying savingsOrigin AUTO_SPLIT with 422 (internal-only)", async () => {
    const { status } = await postExpense({
      type: "SAVINGS",
      amount: 50,
      savingsOrigin: "AUTO_SPLIT",
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    expect(status).toBe(422);
    expect(await prisma.expense.count()).toBe(0);
  });

  it("rejects an amount of 0 on a SAVINGS create with 422", async () => {
    const { status } = await postExpense({
      type: "SAVINGS",
      amount: 0,
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    expect(status).toBe(422);
    expect(await prisma.expense.count()).toBe(0);
  });

  it("rejects savingsOrigin on a non-SAVINGS create with 422 (D8)", async () => {
    const { status } = await postExpense({
      type: "EXPENSE",
      amount: 50,
      savingsOrigin: "MANUAL",
      occurredAt: "2026-10-05T12:00:00.000Z",
    });

    expect(status).toBe(422);
    expect(await prisma.expense.count()).toBe(0);
  });
});