import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaSavingsRuleRepository } from "./savings.repository";

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

describe("PrismaSavingsRuleRepository (integration)", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;
  let repository: PrismaSavingsRuleRepository;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    repository = new PrismaSavingsRuleRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.savingsRule.deleteMany();
  });

  it("upserts a rule and stores the Decimal percent", async () => {
    const created = await repository.upsert("owner-1", "entrenuts", 10);
    expect(created.ownerId).toBe("owner-1");
    expect(created.keyword).toBe("entrenuts");
    expect(created.percent).toBe(10);

    const rows = await prisma.savingsRule.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
  });

  it("upsert replaces the percent and never creates a duplicate", async () => {
    await repository.upsert("owner-1", "entrenuts", 10);
    const updated = await repository.upsert("owner-1", "entrenuts", 15);
    expect(updated.percent).toBe(15);

    const rows = await prisma.savingsRule.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.percent.toNumber()).toBe(15);
  });

  it("lists rules oldest-first per owner only", async () => {
    await repository.upsert("owner-1", "sueldo", 5);
    await repository.upsert("owner-1", "entrenuts", 10);
    await repository.upsert("owner-2", "entrenuts", 20);

    const rules = await repository.listByOwner("owner-1");
    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.keyword)).toEqual(["sueldo", "entrenuts"]);
  });
});