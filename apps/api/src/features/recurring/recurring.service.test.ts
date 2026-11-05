import { describe, expect, it, vi } from "vitest";

import type { RecurringConfirmationRecord, RecurringRepository, RecurringRule } from "./recurring.repository";
import { baInstant, baPeriodKey, nextRunAfter } from "./recurring.schedule";
import { RecurringService } from "./recurring.service";

describe("recurring schedule", () => {
  it("fires the same day next month when today's slot already passed", () => {
    const now = baInstant(2026, 12, 10, 15, 0);
    expect(nextRunAfter(now, 1)).toEqual(baInstant(2027, 1, 1, 12, 30));
  });

  it("fires today when the slot is still ahead", () => {
    const now = baInstant(2026, 12, 3, 8, 0);
    expect(nextRunAfter(now, 3)).toEqual(baInstant(2026, 12, 3, 12, 30));
  });

  it("keeps the period in Buenos Aires across the UTC boundary", () => {
    // 2026-12-01T02:00Z is still November 30th, 23:00 in Buenos Aires.
    expect(baPeriodKey(new Date("2026-12-01T02:00:00.000Z"))).toBe("2026-11");
    expect(baPeriodKey(baInstant(2026, 12, 1, 12, 30))).toBe("2026-12");
  });
});

function makeRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: "rule-1",
    ownerId: "default",
    amount: 320000,
    note: "alquiler",
    category: "GASTOS FIJOS",
    notifyDay: 1,
    active: true,
    nextRunAt: baInstant(2026, 12, 1, 12, 30),
    createdAt: baInstant(2026, 11, 1, 12, 30),
    ...overrides,
  };
}

function makeHarness(rule: RecurringRule, now: Date) {
  let confirmation: RecurringConfirmationRecord | null = null;
  const repository = {
    findDue: vi.fn(async () => [rule]),
    createConfirmationIfMissing: vi.fn(async (data) => {
      confirmation = {
        id: "conf-1",
        recurringId: data.recurringId,
        ownerId: data.ownerId,
        period: data.period,
        amount: data.amount,
        scheduledAt: data.scheduledAt,
        status: "PENDING",
        messageId: null,
        createdAt: data.scheduledAt,
        decidedAt: null,
        remindedAt: null,
      };
      return confirmation;
    }),
    setMessageId: vi.fn(async () => undefined),
    advance: vi.fn(async () => undefined),
    listByOwner: vi.fn(async () => [rule]),
    findConfirmation: vi.fn(async (id: string) =>
      confirmation !== null && confirmation.id === id ? confirmation : null,
    ),
    markDecided: vi.fn(async (_id: string, status: "CONFIRMED" | "SKIPPED") => {
      if (confirmation !== null) {
        confirmation = { ...confirmation, status };
      }
    }),
    findPendingOlderThan: vi.fn(async () => []),
    markReminded: vi.fn(async () => undefined),
    nextWakeAt: vi.fn(async () => rule.nextRunAt),
  } as unknown as RecurringRepository;

  const expenses = { create: vi.fn(async () => undefined) };
  const notifier = {
    ask: vi.fn(async () => 77),
    remind: vi.fn(async () => undefined),
    resolved: vi.fn(async () => undefined),
  };

  const service = new RecurringService(repository, expenses, notifier, () => now);
  return { service, repository, expenses, notifier };
}

describe("RecurringService.processDue", () => {
  it("asks once and moves the rule to the next month", async () => {
    const rule = makeRule();
    const harness = makeHarness(rule, baInstant(2026, 12, 1, 12, 31));

    const asked = await harness.service.processDue();

    expect(asked).toBe(1);
    expect(harness.notifier.ask).toHaveBeenCalledTimes(1);
    expect(harness.repository.advance).toHaveBeenCalledWith("rule-1", baInstant(2027, 1, 1, 12, 30));
  });

  it("skips a rule that is more than three days late", async () => {
    const rule = makeRule();
    const harness = makeHarness(rule, baInstant(2026, 12, 6, 9, 0));

    const asked = await harness.service.processDue();

    expect(asked).toBe(0);
    expect(harness.notifier.ask).not.toHaveBeenCalled();
    expect(harness.repository.advance).toHaveBeenCalledTimes(1);
  });
});

describe("RecurringService.confirm", () => {
  it("creates a PAID expense on the due day and closes the confirmation", async () => {
    const rule = makeRule();
    const harness = makeHarness(rule, baInstant(2026, 12, 1, 13, 0));
    await harness.service.processDue();

    const done = await harness.service.confirm("conf-1");

    expect(done).toBe(true);
    expect(harness.expenses.create).toHaveBeenCalledWith({
      ownerId: "default",
      amount: 320000,
      note: "alquiler",
      category: "GASTOS FIJOS",
      occurredAt: baInstant(2026, 12, 1, 12, 30),
    });
    expect(harness.repository.markDecided).toHaveBeenCalledWith("conf-1", "CONFIRMED", expect.any(Date));
  });

  it("uses the corrected amount when the owner fixes it", async () => {
    const rule = makeRule();
    const harness = makeHarness(rule, baInstant(2026, 12, 1, 13, 0));
    await harness.service.processDue();

    await harness.service.confirm("conf-1", 350000);

    expect(harness.expenses.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 350000 }),
    );
  });

  it("is a no-op the second time", async () => {
    const rule = makeRule();
    const harness = makeHarness(rule, baInstant(2026, 12, 1, 13, 0));
    await harness.service.processDue();
    expect(await harness.service.confirm("conf-1")).toBe(true);

    // Second tap on the same buttons, and a stale id: neither creates money.
    expect(await harness.service.confirm("conf-1")).toBe(false);
    expect(harness.expenses.create).toHaveBeenCalledTimes(1);
    expect(await harness.service.confirm("missing")).toBe(false);
  });
});
