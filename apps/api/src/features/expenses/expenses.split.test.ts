import { describe, expect, it, vi } from "vitest";
import { PrismaExpenseRepository } from "./expenses.repository";
import type { PrismaClient } from "@prisma/client";

/**
 * Unit test for the createIncomeWithSavings transaction structure: the
 * repository must issue BOTH creates inside a single prisma.$transaction
 * callback so a failing SAVINGS create rolls back the net INCOME too.
 * The prisma client is mocked with a transaction shim (≤3 mocks).
 */
describe("createIncomeWithSavings atomicity", () => {
  type CreatedRow = { type: string; amount: unknown; category: string; ownerId: string };

  function makePrismaShim(failSavings: boolean) {
    const created: CreatedRow[] = [];
    const tx = {
      expense: {
        create: vi.fn(async (args: { data: CreatedRow }) => {
          if (failSavings && args.data.type === "SAVINGS") {
            throw new Error("simulated savings create failure");
          }
          created.push(args.data);
          return {
            id: `id-${created.length}`,
            ownerId: args.data.ownerId,
            amount: args.data.amount,
            currency: "ARS",
            category: args.data.category,
            note: null,
            occurredAt: new Date(),
            createdAt: new Date(),
          };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
    } as unknown as PrismaClient;
    return { prisma, tx, created };
  }

  it("creates the net INCOME and the SAVINGS movement inside ONE transaction", async () => {
    const { prisma, tx, created } = makePrismaShim(false);
    const repository = new PrismaExpenseRepository(prisma);

    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 1000,
      percent: 10,
      note: "sueldo",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.expense.create).toHaveBeenCalledTimes(2);
    expect(created.map((row) => row.type)).toEqual(["INCOME", "SAVINGS"]);
    expect(created[0]?.amount?.toString()).toBe("900");
    expect(created[0]?.category).toBe("Sueldo");
    expect(created[1]?.amount?.toString()).toBe("100");
    expect(created[1]?.category).toBe("ahorro");
    expect(result.net?.amount).toBe(900);
    expect(result.savings?.amount).toBe(100);
  });

  it("rolls back everything when the SAVINGS create fails: the error propagates and nothing is returned", async () => {
    const { prisma } = makePrismaShim(true);
    const repository = new PrismaExpenseRepository(prisma);

    await expect(
      repository.createIncomeWithSavings({
        ownerId: "owner-1",
        gross: 1000,
        percent: 10,
        note: "sueldo",
        occurredAt: new Date("2026-09-15T12:00:00.000Z"),
        netCategory: "Sueldo",
        savingsCategory: "ahorro",
        visibility: "INDIVIDUAL",
      }),
    ).rejects.toThrow("simulated savings create failure");
  });

  it("pct=100 creates ONLY the SAVINGS movement (net is zero)", async () => {
    const { prisma, created } = makePrismaShim(false);
    const repository = new PrismaExpenseRepository(prisma);

    const result = await repository.createIncomeWithSavings({
      ownerId: "owner-1",
      gross: 1000,
      percent: 100,
      note: "todo a ahorro",
      occurredAt: new Date("2026-09-15T12:00:00.000Z"),
      netCategory: "Sueldo",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
    });

    expect(created.map((row) => row.type)).toEqual(["SAVINGS"]);
    expect(created[0]?.category).toBe("ahorro");
    expect(result.net).toBeNull();
    expect(result.savings?.amount).toBe(1000);
  });

  it("a percent that rounds savings to zero creates ONLY the net INCOME (whole)", async () => {
    const { prisma, created } = makePrismaShim(false);
    const repository = new PrismaExpenseRepository(prisma);

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

    expect(created.map((row) => row.type)).toEqual(["INCOME"]);
    expect(created[0]?.category).toBe("Sueldo");
    expect(result.net?.amount).toBe(0.01);
    expect(result.savings).toBeNull();
  });
});