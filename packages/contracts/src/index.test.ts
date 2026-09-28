import { describe, expect, it } from "vitest";
import {
  createMovementSchema,
  expenseSchema,
  householdMemberSchema,
  householdMembersSchema,
  listMovementsSchema,
  movementFiltersSchema,
  movementSchema,
  movementStatusSchema,
  movementSummarySchema,
  movementTypeSchema,
  movementVisibilitySchema,
  savingsRuleSchema,
  updateMovementSchema,
  visibilityFilterSchema,
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
  it("accepts INCOME, EXPENSE and SAVINGS", () => {
    expect(movementTypeSchema.parse("INCOME")).toBe("INCOME");
    expect(movementTypeSchema.parse("EXPENSE")).toBe("EXPENSE");
    expect(movementTypeSchema.parse("SAVINGS")).toBe("SAVINGS");
  });
});

describe("movementStatusSchema", () => {
  it("accepts PAID and PENDING", () => {
    expect(movementStatusSchema.parse("PAID")).toBe("PAID");
    expect(movementStatusSchema.parse("PENDING")).toBe("PENDING");
  });

  it("rejects an unknown status value", () => {
    const result = movementStatusSchema.safeParse("PARTIAL");
    expect(result.success).toBe(false);
  });
});

describe("movementVisibilitySchema", () => {
  it("accepts INDIVIDUAL and SHARED", () => {
    expect(movementVisibilitySchema.parse("INDIVIDUAL")).toBe("INDIVIDUAL");
    expect(movementVisibilitySchema.parse("SHARED")).toBe("SHARED");
  });

  it("rejects an unknown visibility value", () => {
    const result = movementVisibilitySchema.safeParse("foo");
    expect(result.success).toBe(false);
  });
});

describe("visibilityFilterSchema", () => {
  it("accepts mine, shared and all", () => {
    expect(visibilityFilterSchema.parse("mine")).toBe("mine");
    expect(visibilityFilterSchema.parse("shared")).toBe("shared");
    expect(visibilityFilterSchema.parse("all")).toBe("all");
  });

  it("rejects an unknown visibility filter", () => {
    const result = visibilityFilterSchema.safeParse("foo");
    expect(result.success).toBe(false);
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

  it("parses a payload with type SAVINGS", () => {
    const parsed = movementSchema.parse({ ...movementPayload, type: "SAVINGS" });
    expect(parsed.type).toBe("SAVINGS");
  });

  it("rejects an unknown movement type", () => {
    const result = movementSchema.safeParse({ ...movementPayload, type: "REFUND" });
    expect(result.success).toBe(false);
  });

  it("requires the type field", () => {
    const withoutType: Record<string, unknown> = { ...movementPayload };
    delete withoutType.type;
    const result = movementSchema.safeParse(withoutType);
    expect(result.success).toBe(false);
  });

  it("carries visibility and registrantId when present", () => {
    const parsed = movementSchema.parse({
      ...movementPayload,
      visibility: "SHARED",
      registrantId: "owner-1",
    });
    expect(parsed.visibility).toBe("SHARED");
    expect(parsed.registrantId).toBe("owner-1");
  });

  it("parses an optional status field when present", () => {
    const parsed = movementSchema.parse({ ...movementPayload, status: "PENDING" });
    expect(parsed.status).toBe("PENDING");
  });

  it("parses without a status field (optional)", () => {
    const parsed = movementSchema.parse(movementPayload);
    expect(parsed.status).toBeUndefined();
  });

  it("rejects an unknown status value", () => {
    const result = movementSchema.safeParse({ ...movementPayload, status: "PARTIAL" });
    expect(result.success).toBe(false);
  });
});

describe("householdMemberSchema", () => {
  it("parses an ownerId and name pair", () => {
    const parsed = householdMemberSchema.parse({ ownerId: "rita", name: "Rita" });
    expect(parsed.ownerId).toBe("rita");
    expect(parsed.name).toBe("Rita");
  });

  it("rejects a member without a name", () => {
    const result = householdMemberSchema.safeParse({ ownerId: "rita" });
    expect(result.success).toBe(false);
  });

  it("rejects a member carrying a chatId", () => {
    const result = householdMemberSchema.safeParse({ ownerId: "rita", name: "Rita", chatId: 111 });
    expect(result.success).toBe(false);
  });
});

describe("householdMembersSchema", () => {
  it("parses a member list", () => {
    const parsed = householdMembersSchema.parse([
      { ownerId: "rita", name: "Rita" },
      { ownerId: "edgardo", name: "Edgardo" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.ownerId).toBe("edgardo");
  });

  it("rejects an empty member list", () => {
    const result = householdMembersSchema.safeParse([]);
    expect(result.success).toBe(false);
  });
});

describe("expenseSchema family (unchanged)", () => {
  it("still parses an expense-shaped payload without type", () => {
    const expensePayload: Record<string, unknown> = { ...movementPayload };
    delete expensePayload.type;
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

  it("accepts SAVINGS in the type filter", () => {
    const parsed = movementFiltersSchema.parse({ ownerId: "owner-1", type: "SAVINGS" });
    expect(parsed.type).toBe("SAVINGS");
  });

  it("rejects an invalid type value", () => {
    const result = movementFiltersSchema.safeParse({ ownerId: "owner-1", type: "REFUND" });
    expect(result.success).toBe(false);
  });

  it("parses an optional visibility filter", () => {
    const parsed = movementFiltersSchema.parse({ ownerId: "owner-1", visibility: "shared" });
    expect(parsed.visibility).toBe("shared");
  });

  it("rejects an invalid visibility filter value", () => {
    const result = movementFiltersSchema.safeParse({ ownerId: "owner-1", visibility: "foo" });
    expect(result.success).toBe(false);
  });
});

const summaryPayload = {
  kpis: {
    income: 50000,
    expenses: 12500,
    balance: 37500,
    savings: 10000,
    avgPerMonth: 37500,
    avgPerMovement: 25000,
    maxAmount: 50000,
    count: 2,
    countThisMonth: 1,
  },
  mom: {
    months: [{ month: "2026-07", income: 0, expenses: 5000, balance: -5000, savings: 500 }],
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
  planned: { month: "2026-09", total: 2500 },
};

describe("movementSummarySchema", () => {
  it("parses a full summary payload", () => {
    const parsed = movementSummarySchema.parse(summaryPayload);
    expect(parsed.kpis.balance).toBe(37500);
    expect(parsed.kpis.savings).toBe(10000);
    expect(parsed.kpis.count).toBe(2);
    expect(parsed.kpis.countThisMonth).toBe(1);
    expect(parsed.mom.months[0]?.balance).toBe(-5000);
    expect(parsed.mom.months[0]?.savings).toBe(500);
    expect(parsed.daily[0]?.day).toBe("2026-08-01");
    expect(parsed.categories[0]?.incomePercent).toBe(100);
    expect(parsed.top.income[0]?.type).toBe("INCOME");
    expect(parsed.top.expenses[0]?.type).toBe("EXPENSE");
  });

  it("parses the planned block with month and total", () => {
    const parsed = movementSummarySchema.parse(summaryPayload);
    expect(parsed.planned.month).toBe("2026-09");
    expect(parsed.planned.total).toBe(2500);
  });

  it("parses a summary without the planned block (additive — required once the producer lands)", () => {
    const withoutPlanned: Record<string, unknown> = JSON.parse(JSON.stringify(summaryPayload));
    delete withoutPlanned.planned;
    const parsed = movementSummarySchema.parse(withoutPlanned);
    expect(parsed.planned).toBeUndefined();
  });

  it("rejects a summary missing the kpis savings figure", () => {
    const withoutSavings: Record<string, unknown> = JSON.parse(JSON.stringify(summaryPayload));
    delete (withoutSavings.kpis as Record<string, unknown>).savings;
    const result = movementSummarySchema.safeParse(withoutSavings);
    expect(result.success).toBe(false);
  });

  it("rejects a summary missing the per-month savings figure", () => {
    const withoutMonthSavings: Record<string, unknown> = JSON.parse(JSON.stringify(summaryPayload));
    const months = withoutMonthSavings.mom as { months: Record<string, unknown>[] };
    delete months.months[0]?.savings;
    const result = movementSummarySchema.safeParse(withoutMonthSavings);
    expect(result.success).toBe(false);
  });

  it("rejects a summary missing kpis", () => {
    const withoutKpis: Record<string, unknown> = { ...summaryPayload };
    delete withoutKpis.kpis;
    const result = movementSummarySchema.safeParse(withoutKpis);
    expect(result.success).toBe(false);
  });
});

describe("savingsRuleSchema", () => {
  it("accepts a valid rule with ownerId, keyword and percent", () => {
    const parsed = savingsRuleSchema.parse({ ownerId: "owner-1", keyword: "entrenuts", percent: 10 });
    expect(parsed.percent).toBe(10);
  });

  it("accepts percent 100", () => {
    const parsed = savingsRuleSchema.parse({ ownerId: "owner-1", keyword: "entrenuts", percent: 100 });
    expect(parsed.percent).toBe(100);
  });

  it.each([0, -1, 101, 150])("rejects percent %s", (percent) => {
    const result = savingsRuleSchema.safeParse({ ownerId: "owner-1", keyword: "entrenuts", percent });
    expect(result.success).toBe(false);
  });

  it("rejects a missing keyword", () => {
    const result = savingsRuleSchema.safeParse({ ownerId: "owner-1", percent: 10 });
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

  it("accepts an explicit SAVINGS type", () => {
    const parsed = createMovementSchema.parse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "SAVINGS",
    });
    expect(parsed.type).toBe("SAVINGS");
  });

  it("rejects an invalid type value", () => {
    const result = createMovementSchema.safeParse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "REFUND",
    });
    expect(result.success).toBe(false);
  });

  it("accepts PENDING for EXPENSE", () => {
    const parsed = createMovementSchema.parse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "EXPENSE",
      status: "PENDING",
    });
    expect(parsed.status).toBe("PENDING");
  });

  it("accepts PENDING without an explicit type (absent type counts as EXPENSE)", () => {
    const parsed = createMovementSchema.parse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      status: "PENDING",
    });
    expect(parsed.status).toBe("PENDING");
  });

  it("accepts PAID for INCOME", () => {
    const parsed = createMovementSchema.parse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "INCOME",
      status: "PAID",
    });
    expect(parsed.status).toBe("PAID");
  });

  it("rejects PENDING for INCOME", () => {
    const result = createMovementSchema.safeParse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "INCOME",
      status: "PENDING",
    });
    expect(result.success).toBe(false);
  });

  it("rejects PENDING for SAVINGS", () => {
    const result = createMovementSchema.safeParse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "SAVINGS",
      status: "PENDING",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown status value", () => {
    const result = createMovementSchema.safeParse({
      amount: 1000,
      occurredAt: "2026-08-01T12:00:00.000Z",
      type: "EXPENSE",
      status: "PARTIAL",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateMovementSchema", () => {
  it("accepts a payload with only note", () => {
    const parsed = updateMovementSchema.parse({ note: "uber" });
    expect(parsed.note).toBe("uber");
  });

  it("accepts category null (clears the category)", () => {
    const parsed = updateMovementSchema.parse({ category: null });
    expect(parsed.category).toBeNull();
  });

  it("rejects a non-positive amount", () => {
    const result = updateMovementSchema.safeParse({ amount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects an empty patch", () => {
    const result = updateMovementSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a status-only patch (status is not editable through PATCH)", () => {
    const result = updateMovementSchema.safeParse({ status: "PENDING" });
    expect(result.success).toBe(false);
  });

  it("rejects an occurredAt-only patch (occurredAt is not editable through PATCH)", () => {
    const result = updateMovementSchema.safeParse({ occurredAt: "2026-08-01T12:00:00.000Z" });
    expect(result.success).toBe(false);
  });
});