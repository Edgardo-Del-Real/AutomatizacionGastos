import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { ValidationFailedError } from "../../infra/errors";
import { CategoryService } from "./categories.service";
import { PrismaCategoryRepository } from "./categories.repository";
import { ReservedCategoryError } from "./reserved";

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

describe("categories savings guards (D9)", () => {
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

  it('creates "ahorro" as a SAVINGS category, never NORMAL', async () => {
    const created = await service.createCategory("owner-1", "ahorro");
    expect(created.name).toBe("ahorro");
    const row = await prisma.category.findUnique({ where: { id: created.id } });
    expect(row?.type).toBe("SAVINGS");
  });

  it("routes a differently-cased ahorro through the same SAVINGS upsert (never NORMAL, never duplicate)", async () => {
    const first = await service.createCategory("owner-1", "Ahorro");
    const second = await service.createCategory("owner-1", "ahorro");
    expect(first.name).toBe("ahorro");
    expect(second.id).toBe(first.id);
    const rows = await prisma.category.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("SAVINGS");
  });

  it("keeps normal categories NORMAL", async () => {
    const created = await service.createCategory("owner-1", "Salud");
    const row = await prisma.category.findUnique({ where: { id: created.id } });
    expect(row?.type).toBe("NORMAL");
  });

  it("ensureAhorro creates the SAVINGS ahorro category and is idempotent", async () => {
    const created = await service.ensureAhorro("owner-1");
    expect(created.name).toBe("ahorro");
    const row = await prisma.category.findUnique({ where: { id: created.id } });
    expect(row?.type).toBe("SAVINGS");

    const again = await service.ensureAhorro("owner-1");
    expect(again.id).toBe(created.id);
  });

  it("rejects deleting the SAVINGS ahorro category", async () => {
    await service.ensureAhorro("owner-1");
    await expect(service.deleteCategory("owner-1", "ahorro")).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it("rejects renaming the SAVINGS ahorro category", async () => {
    await service.ensureAhorro("owner-1");
    await expect(service.renameCategory("owner-1", "ahorro", "savings")).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it("rejects renaming a normal category TO ahorro", async () => {
    await service.createCategory("owner-1", "Otros ingresos");
    await expect(service.renameCategory("owner-1", "Otros ingresos", "ahorro")).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("assertOwnerCategory passes for a SAVINGS category without a movement type", async () => {
    await service.ensureAhorro("owner-1");
    await expect(service.assertOwnerCategory("owner-1", "ahorro")).resolves.toBeUndefined();
  });

  it("assertOwnerCategory rejects the SAVINGS category on an EXPENSE movement", async () => {
    await service.ensureAhorro("owner-1");
    await expect(service.assertOwnerCategory("owner-1", "ahorro", "EXPENSE")).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("assertOwnerCategory rejects the SAVINGS category on an INCOME movement", async () => {
    await service.ensureAhorro("owner-1");
    await expect(service.assertOwnerCategory("owner-1", "ahorro", "INCOME")).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("assertOwnerCategory allows the SAVINGS category on a SAVINGS movement", async () => {
    await service.ensureAhorro("owner-1");
    await expect(service.assertOwnerCategory("owner-1", "ahorro", "SAVINGS")).resolves.toBeUndefined();
  });

  it("assertOwnerCategory still rejects a category that is not the owner's", async () => {
    await expect(service.assertOwnerCategory("owner-1", "nope")).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it("rejects ahorros with a reserved error: no category, no SAVINGS upsert, no NORMAL", async () => {
    await expect(service.createCategory("owner-1", "ahorros")).rejects.toBeInstanceOf(ReservedCategoryError);
    await expect(service.createCategory("owner-1", "ahorros")).rejects.toMatchObject({ concept: "ahorro" });
    expect(await prisma.category.count({ where: { ownerId: "owner-1" } })).toBe(0);
  });

  it("rejects renaming a category TO ahorros (folded reserved), leaving the name unchanged", async () => {
    await service.createCategory("owner-1", "Guardado");

    await expect(service.renameCategory("owner-1", "Guardado", "ahorros")).rejects.toBeInstanceOf(
      ReservedCategoryError,
    );
    const list = await service.listCategories("owner-1");
    expect(list.map((category) => category.name)).toEqual(["Guardado"]);
  });

  it("keeps exact ahorro routed to the SAVINGS upsert alongside the ahorros rejection", async () => {
    await expect(service.createCategory("owner-1", "ahorros")).rejects.toBeInstanceOf(ReservedCategoryError);
    const savings = await service.createCategory("owner-1", "ahorro");
    expect(savings.name).toBe("ahorro");
    const rows = await prisma.category.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("SAVINGS");
  });
});