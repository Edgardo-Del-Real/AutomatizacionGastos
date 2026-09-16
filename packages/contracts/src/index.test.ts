import { describe, expect, it } from "vitest";
import {
  createMovementSchema,
  expenseSchema,
  listMovementsSchema,
  movementFiltersSchema,
  movementSchema,
  movementSummarySchema,
  movementTypeSchema,
} from "./index";

const movementPayload = {
  id: "m-1",
  ownerId: "owner-1",
  amount: 50000,
  currency: "ARS",
  category: "work",
  note: "Salary",
  occurredAt: "2026-08-01T12:00:00.000Z",
  createdAt: "2026-08-01T12:05:00.000Z",
  type: "INCOME",
} as const;

describe("movementTypeSchema", () => {
  it("accepts INCOME and EXPENSE", () => {
    expect(movementTypeSchema.parse("INCOME")).toBe("INCOME");
    expect(movementTypeSchema.parse("EXPENSE")).toBe("EXPENSE");
  });
});

describe("movementSchema", () => {
  it("parses a payload with type INCOME", () => {
    const parsed = movementSchema.parse(movementPayload);
    expect(parsed.type).toBe("INCOME");
    expect(parsed.amount).toBe(50000);
  });

  it("parses a payload with type EXPENSE", () => {
    const parsed = movementSchema.parse({ ...movementPayload, type: "EXPENSE" });
    expect(parsed.type).toBe("EXPENSE");
  });

  it("rejects an unknown movement type", () => {
    const result = movementSchema.safeParse({ ...movementPayload, type: "SAVINGS" });
    expect(result.success).toBe(false);
  });

  it("requires the type field", () => {
    const { type: _type, ...withoutType } = movementPayload;
    const result = movementSchema.safeParse(withoutType);
    expect(result.success).toBe(false);
  });
});

describe("expenseSchema family (unchanged)", () => {
  it("still parses an expense-shaped payload without type", () => {
    const { type: _type, ...expensePayload } = movementPayload;
    const parsed = expenseSchema.parse(expensePayload);
    expect(parsed.note).toBe("Salary");
    expect(parsed.ownerId).toBe("owner-1");
  });
});

describe("listMovementsSchema", () => {
  it("parses an array of movements", () => {
    const parsed = listMovementsSchema.parse([
      movementPayload,
      { ...movementPayload, id: "m-2", type: "EXPENSE" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.type).toBe("EXPENSE");
  });
});

describe("movementFiltersSchema", () => {
  it("parses combined filters", () => {
    const parsed = movementFiltersSchema.parse({
      ownerId: "owner-1",
      type: "INCOME",
      from: "2026-08-01",
      to: "2026-08-31",
      category: "work",
      q: "sueldo",
    });
    expect(parsed.type).toBe("INCOME");
    expect(parsed.q).toBe("sueldo");
  });

  it("requires ownerId", () => {
    const result = movementFiltersSchema.safeParse({ type: "INCOME" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid type value", () => {
    const result = movementFiltersSchema.safeParse({ ownerId: "owner-1", type: "SAVINGS" });
    expect(result.success).toBe(false);
  });
});

const summaryPayload = {
  kpis: {
    income: 50000,
    expenses: 12500,
    balance: 37500,
    avgPerMonth: 37500,
    avgPerMovement: 25000,
    maxAmount: 50000,
    count: 2,
    countThisMonth: 1,
  },
  mom: {
    months: [{ month: "2026-07", income: 0, expenses: 5000, balance: -5000 }],
  },
  daily: [{ day: "2026-08-01", income: 50000, expenses: 12500, balance: 37500 }],
  categories: [
    {
      name: "work",
      expenseAmount: 0,
      incomeAmount: 50000,
      expensePercent: 0,
      incomePercent: 100,
    },
  ],
  top: {
    expenses: [{ ...movementPayload, type: "EXPENSE" }],
    income: [movementPayload],
  },
};

describe("movementSummarySchema", () => {
  it("parses a full summary payload", () => {
    const parsed = movementSummarySchema.parse(summaryPayload);
    expect(parsed.kpis.balance).toBe(37500);
    expect(parsed.kpis.count).toBe(2);
    expect(parsed.kpis.countThisMonth).toBe(1);
    expect(parsed.mom.months[0]?.balance).toBe(-5000);
    expect(parsed.daily[0]?.day).toBe("2026-08-01");
    expect(parsed.categories[0]?.incomePercent).toBe(100);
    expect(parsed.top.income[0]?.type).toBe("INCOME");
    expect(parsed.top.expenses[0]?.type).toBe("EXPENSE");
  });

  it("rejects a summary missing kpis", () => {
    const { kpis: _kpis, ...withoutKpis } = summaryPayload;
    const result = movementSummarySchema.safeParse(withoutKpis);
    expect(result.success).toBe(false);
  });
});

describe("createMovementSchema", () => {
  it("accepts a payload without an explicit type", () => {
    const result = createMovementSchema.safeParse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an explicit INCOME type", () => {
    const parsed = createMovementSchema.parse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "INCOME",
    });
    expect(parsed.type).toBe("INCOME");
  });

  it("rejects an invalid type value", () => {
    const result = createMovementSchema.safeParse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "SAVINGS",
    });
    expect(result.success).toBe(false);
  });
});