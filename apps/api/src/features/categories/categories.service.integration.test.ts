import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import { CategoryService } from "./categories.service";
import { PrismaCategoryRepository } from "./categories.repository";

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

describe("categories service (integration)", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;
  let service: CategoryService;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    service = new CategoryService(new PrismaCategoryRepository(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
    await prisma.categoryKeyword.deleteMany();
    await prisma.category.deleteMany();
  });

  it("creates a category scoped to the owner and lists it", async () => {
    const created = await service.createCategory("owner-1", "Cafe");

    expect(created.ownerId).toBe("owner-1");
    expect(created.name).toBe("Cafe");

    const list = await service.listCategories("owner-1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Cafe", keywords: [] });
  });

  it("rejects a duplicate exact name with 422", async () => {
    await service.createCategory("owner-1", "Food");

    await expect(service.createCategory("owner-1", "Food")).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("rejects a normalized duplicate name (accent-fold) with 422", async () => {
    await service.createCategory("owner-1", "Cafe");

    await expect(service.createCategory("owner-1", "café")).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("renames a category and cascades to movements in a transaction", async () => {
    const cafe = await service.createCategory("owner-1", "Cafe");
    await service.associateKeyword("owner-1", "cafe", "Cafe");
    await prisma.expense.createMany({
      data: [
        {
          ownerId: "owner-1",
          amount: 1000,
          currency: "ARS",
          category: "Cafe",
          note: "desayuno",
          occurredAt: new Date("2026-09-01T12:00:00.000Z"),
          type: "EXPENSE",
        },
        {
          ownerId: "owner-1",
          amount: 500,
          currency: "ARS",
          category: "Cafe",
          note: "merienda",
          occurredAt: new Date("2026-09-02T12:00:00.000Z"),
          type: "EXPENSE",
        },
      ],
    });

    const renamed = await service.renameCategory("owner-1", "Cafe", "Cafeteria");

    expect(renamed?.name).toBe("Cafeteria");
    const movements = await prisma.expense.findMany({ where: { ownerId: "owner-1" } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.category === "Cafeteria")).toBe(true);

    const list = await service.listCategories("owner-1");
    expect(list[0]).toMatchObject({ name: "Cafeteria", keywords: ["cafe"] });
    expect(cafe.id).toBe(renamed?.id);
  });

  it("associating the same keyword twice stores no duplicate rule", async () => {
    await service.createCategory("owner-1", "Transporte");
    await service.associateKeyword("owner-1", "uber", "Transporte");
    await service.associateKeyword("owner-1", "uber", "Transporte");

    const rules = await prisma.categoryKeyword.findMany({ where: { ownerId: "owner-1" } });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.keyword).toBe("uber");
  });

  it("stores the keyword normalized", async () => {
    await service.createCategory("owner-1", "Transporte");
    await service.associateKeyword("owner-1", "Uber", "Transporte");

    const rules = await prisma.categoryKeyword.findMany({ where: { ownerId: "owner-1" } });
    expect(rules[0]?.keyword).toBe("uber");
  });

  it("creates the 'otro' fallback once per owner", async () => {
    const primero = await service.ensureOtro("owner-1");
    const segundo = await service.ensureOtro("owner-1");

    expect(primero.name).toBe("otro");
    expect(segundo.id).toBe(primero.id);
    const count = await prisma.category.count({ where: { ownerId: "owner-1" } });
    expect(count).toBe(1);
  });

  it("keeps categories invisible across owners", async () => {
    await service.createCategory("owner-2", "Food");

    const list = await service.listCategories("owner-1");
    expect(list).toHaveLength(0);
  });

  it("does not rename another owner's category", async () => {
    await service.createCategory("owner-2", "Food");

    const renamed = await service.renameCategory("owner-1", "Food", "Comida");

    expect(renamed).toBeNull();
  });

  it("rejects associating a keyword to another owner's category", async () => {
    await service.createCategory("owner-2", "Food");

    await expect(service.associateKeyword("owner-1", "pan", "Food")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("asserts a category belongs to the owner, else 422", async () => {
    await service.createCategory("owner-1", "Cafe");

    await expect(service.assertOwnerCategory("owner-1", "Cafe")).resolves.toBeUndefined();
    await expect(service.assertOwnerCategory("owner-1", "Food")).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("matches a note against learned keyword rules via the service", async () => {
    await service.createCategory("owner-1", "Transporte");
    await service.associateKeyword("owner-1", "uber", "Transporte");
    await service.ensureOtro("owner-1");

    expect(await service.matchNote("owner-1", "pague $1200 en uber viaje")).toBe("Transporte");
    expect(await service.matchNote("owner-1", "pague $300 en la farmacia")).toBeNull();
  });
});