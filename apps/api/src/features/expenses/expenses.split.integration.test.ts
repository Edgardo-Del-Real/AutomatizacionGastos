import { execSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaExpenseRepository } from "./expenses.repository";

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

describe("PrismaExpenseRepository.createIncomeWithSavings (integration)", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;
  let repository: PrismaExpenseRepository;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    repository = new PrismaExpenseRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
    await prisma.categoryKeyword.deleteMany();
    await prisma.category.deleteMany();
    await prisma.savingsRule.deleteMany();
  });

  it("persists the net INCOME keeping netCategory and the SAVINGS in savingsCategory with the rounding invariant", async () => {
    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 10,
      percent: 33,
      note: "sueldo",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(result.net?.amount).toBe(6.7);
    expect(result.net?.category).toBe("Sueldo");
    expect(result.savings?.amount).toBe(3.3);
    expect(result.savings?.category).toBe("ahorro");

    const rows = await prisma.expense.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.type).sort()).toEqual(["INCOME", "SAVINGS"]);
    expect(result.net!.amount + result.savings!.amount).toBe(10);
  });

  it("pct=100 persists only the SAVINGS movement", async () => {
    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 1000,
      percent: 100,
      note: "todo",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(result.net).toBeNull();
    expect(result.savings?.amount).toBe(1000);
    expect(result.savings?.category).toBe("ahorro");
    const rows = await prisma.expense.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("SAVINGS");
  });

  it("rounds savings to zero for a negligible percent and persists the whole INCOME", async () => {
    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 0.01,
      percent: 1,
      note: "minimo",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(result.net?.amount).toBe(0.01);
    expect(result.net?.category).toBe("Sueldo");
    expect(result.savings).toBeNull();
    const rows = await prisma.expense.findMany({ where: { ownerId: "owner-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("INCOME");
  });
});

/**
 * shared-expense-split (Phase 3, task 3.4): the two-row SHARED registration on
 * the real DB — exact-sum invariant, identical facts, sender/partner owners,
 * and `sharedTotal` persisted on both rows.
 */
describe("PrismaExpenseRepository.createSharedSplit (integration)", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;
  let repository: PrismaExpenseRepository;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    repository = new PrismaExpenseRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
    await prisma.categoryKeyword.deleteMany();
    await prisma.category.deleteMany();
    await prisma.savingsRule.deleteMany();
  });

  it("persists sender + partner SHARED EXPENSE rows summing exactly to the total", async () => {
    const result = await repository.createSharedSplit({
      ownerId: "owner-1",
      partnerId: "owner-2",
      total: 10,
      percent: 33,
      note: "super",
      occurredAt: new Date("2026-10-01T12:00:00.000Z"),
      category: "Super",
    });

    expect(result).toEqual({ sender: 3.3, partner: 6.7 });

    const rows = await prisma.expense.findMany({ orderBy: { ownerId: "asc" } });
    expect(rows).toHaveLength(2);
    const sender = rows[0]?.ownerId === "owner-1" ? rows[0]! : rows[1]!;
    const partner = sender.ownerId === "owner-1" ? rows[1]! : rows[0]!;

    for (const row of [sender, partner]) {
      expect(row.type).toBe("EXPENSE");
      expect(row.visibility).toBe("SHARED");
      expect(row.status).toBe("PAID");
      expect(row.currency).toBe("ARS");
      expect(row.category).toBe("Super");
      expect(row.note).toBe("super");
      expect(row.occurredAt).toEqual(new Date("2026-10-01T12:00:00.000Z"));
      expect(row.sharedTotal?.toNumber()).toBe(10);
    }
    expect(sender.ownerId).toBe("owner-1");
    expect(sender.amount.toNumber()).toBe(3.3);
    expect(partner.ownerId).toBe("owner-2");
    expect(partner.amount.toNumber()).toBe(6.7);
    // Shares reconcile to the total exactly (Decimal invariant).
    expect(sender.amount.toNumber() + partner.amount.toNumber()).toBe(10);
  });

  it("persists an even 50/50 split with both rows under their owners", async () => {
    const result = await repository.createSharedSplit({
      ownerId: "owner-1",
      partnerId: "owner-2",
      total: 2000,
      percent: 50,
      note: "super",
      occurredAt: new Date("2026-10-01T12:00:00.000Z"),
      category: "Super",
    });

    expect(result).toEqual({ sender: 1000, partner: 1000 });

    const rows = await prisma.expense.findMany({ orderBy: { ownerId: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ownerId).sort()).toEqual(["owner-1", "owner-2"]);
    expect(rows[0]!.amount.toNumber() + rows[1]!.amount.toNumber()).toBe(2000);
  });

  it("rolls the whole split back when the partner create fails", async () => {
    // The REAL $transaction runs, but the tx client's partner create throws:
    // the interactive transaction aborts and the sender row must NOT persist.
    const originalTransaction = prisma.$transaction.bind(prisma);
    const repositoryWithFaultyTx = new PrismaExpenseRepository({
      ...prisma,
      $transaction: (async (runner: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        originalTransaction(async (tx: Prisma.TransactionClient) => {
          const faultTx = new Proxy(tx, {
            get(target, prop) {
              if (prop === "expense") {
                return new Proxy(target.expense, {
                  get(expenseTarget, expenseProp) {
                    if (expenseProp === "create") {
                      return async (args: { data: { ownerId: string } }) => {
                        if (args.data.ownerId === "owner-2") {
                          throw new Error("simulated partner create failure");
                        }
                        return expenseTarget.create(args as never);
                      };
                    }
                    return Reflect.get(expenseTarget, expenseProp);
                  },
                });
              }
              return Reflect.get(target, prop);
            },
          });
          return runner(faultTx);
        })) as unknown as typeof prisma.$transaction,
    } as unknown as PrismaClient);

    await expect(
      repositoryWithFaultyTx.createSharedSplit({
        ownerId: "owner-1",
        partnerId: "owner-2",
        total: 2000,
        percent: 50,
        note: "super",
        occurredAt: new Date("2026-10-01T12:00:00.000Z"),
        category: "Super",
      }),
    ).rejects.toThrow("simulated partner create failure");

    expect(await prisma.expense.count()).toBe(0);
  });
});