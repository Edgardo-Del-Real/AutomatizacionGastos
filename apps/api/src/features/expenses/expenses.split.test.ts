import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
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

/**
 * shared-expense-split (Phase 3, task 3.1): unit contract of the 2-row
 * `createSharedSplit` transaction — Decimal invariant split, both rows
 * SHARED·EXPENSE·PAID·ARS with identical facts and sharedTotal=total; the
 * sender row lands under the sender ownerId and the partner row under the
 * partner ownerId. Same transaction shim as the savings split (≤3 mocks).
 */
describe("createSharedSplit two-row transaction", () => {
  type CreatedRow = {
    type: string;
    visibility: string;
    status: string;
    amount: Prisma.Decimal;
    category: string | null;
    note: string | null;
    ownerId: string;
    sharedTotal: Prisma.Decimal;
  };

  function makeSharedShim() {
    const created: CreatedRow[] = [];
    const tx = {
      expense: {
        create: vi.fn(async (args: { data: CreatedRow }) => {
          created.push(args.data);
          return {
            id: `id-${created.length}`,
            ownerId: args.data.ownerId,
            amount: args.data.amount,
            currency: "ARS",
            category: args.data.category,
            note: args.data.note,
            occurredAt: new Date("2026-10-01T12:00:00.000Z"),
            createdAt: new Date(),
            type: args.data.type,
            visibility: args.data.visibility,
            status: args.data.status,
            sharedTotal: args.data.sharedTotal,
          };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
    } as unknown as PrismaClient;
    return { prisma, tx, created };
  }

  function splitArgs(overrides?: Partial<Parameters<PrismaExpenseRepository["createSharedSplit"]>[0]>) {
    return {
      ownerId: "owner-1",
      partnerId: "owner-2",
      total: 10,
      percent: 33,
      note: "super",
      occurredAt: new Date("2026-10-01T12:00:00.000Z"),
      category: "Super",
      ...overrides,
    };
  }

  it("splits 10.00@33% into 3.30/6.70 with an exact sum, both rows carrying sharedTotal", async () => {
    const { prisma, tx, created } = makeSharedShim();
    const repository = new PrismaExpenseRepository(prisma);

    const result = await repository.createSharedSplit(splitArgs());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.expense.create).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
    // Sender row first, partner row second; both SHARED EXPENSE PAID ARS.
    for (const row of created) {
      expect(row.type).toBe("EXPENSE");
      expect(row.visibility).toBe("SHARED");
      expect(row.status).toBe("PAID");
      expect(row.category).toBe("Super");
      expect(row.note).toBe("super");
    }
    expect(created[0]?.ownerId).toBe("owner-1");
    expect(created[1]?.ownerId).toBe("owner-2");
    // Decimal(12,2): senderPart round2(10*33/100)=3.30, partner 6.70; decimal.js
    // does not pad the trailing zero in toString, so assert the numeric value.
    expect(created[0]?.amount?.toNumber()).toBe(3.3);
    expect(created[1]?.amount?.toNumber()).toBe(6.7);
    expect(created[0]?.sharedTotal?.toNumber()).toBe(10);
    expect(created[1]?.sharedTotal?.toNumber()).toBe(10);
    expect(result).toEqual({ sender: 3.3, partner: 6.7 });
    // Exact-sum invariant: sender + partner === total.
    expect(result!.sender + result!.partner).toBe(10);
  });

  it("splits 40000@50% into 20000/20000 (even half)", async () => {
    const { prisma, created } = makeSharedShim();
    const repository = new PrismaExpenseRepository(prisma);

    const result = await repository.createSharedSplit(
      splitArgs({ total: 40000, percent: 50, note: "alquiler", category: "Alquiler" }),
    );

    expect(created[0]?.amount?.toNumber()).toBe(20000);
    expect(created[1]?.amount?.toNumber()).toBe(20000);
    expect(result).toEqual({ sender: 20000, partner: 20000 });
  });
});