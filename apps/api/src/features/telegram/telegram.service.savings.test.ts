import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { CategoryService } from "../categories/categories.service";
import type { SavingsRuleService } from "../savings/savings.service";
import type { HouseholdService } from "../household/household.service";
import type { BotStateRepository, BotStateRecord } from "./bot-state.repository";
import type { InlineKeyboard } from "./telegram.parser";
import { capturePayloadSchema, previewPayloadSchema, savingsPercentPayloadSchema, TelegramService, type PreviewPayload } from "./telegram.service";
import {
  alreadyProcessedReply,
  menuReply,
  previewConfirmReply,
  savingsPercentInvalidReply,
  savingsPercentPromptReply,
  successReply,
  successSplitReply,
} from "./reply-text";

const OWNER_CHAT_ID = 123456789;
const ownerId = "default";

function textUpdate(overrides?: { messageId?: number; text?: string }): unknown {
  return {
    update_id: 8000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
      chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" },
      date: 1712803046,
      text: overrides?.text ?? "café 2500",
    },
  };
}

function callbackUpdate(data: string): unknown {
  return {
    update_id: 9000,
    callback_query: {
      id: "cb_1",
      chat_instance: "987654321",
      from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
      message: { message_id: 77, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "preview" },
      data,
    },
  };
}

type Harness = {
  service: TelegramService;
  mockCreateExpense: ReturnType<typeof vi.fn>;
  mockCreateIncomeWithSavings: ReturnType<typeof vi.fn>;
  mockResolveSplit: ReturnType<typeof vi.fn>;
  mockEnsureAhorro: ReturnType<typeof vi.fn>;
  mockMatchNote: ReturnType<typeof vi.fn>;
  botStateRepository: BotStateRepository;
  replies: string[];
  keyboards: (InlineKeyboard | undefined)[];
  reply: (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<number | undefined>;
};

function makeHarness(): Harness {
  const replies: string[] = [];
  const keyboards: (InlineKeyboard | undefined)[] = [];
  const reply = async (text: string, keyboard?: InlineKeyboard): Promise<number | undefined> => {
    replies.push(text);
    keyboards.push(keyboard);
    return undefined;
  };
  let storedState: BotStateRecord | null = null;
  const messageRepository = { recordProcessed: vi.fn() } as unknown as ProcessedMessageRepository;
  const expenseService = {
    createExpense: vi.fn(async () => ({
      id: "mov-1",
      ownerId,
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE",
    })),
    deleteExpense: vi.fn(async () => undefined),
    createIncomeWithSavings: vi.fn(async () => ({
      net: { id: "net-1", ownerId, amount: 900, currency: "ARS", category: null, note: null, occurredAt: new Date(), createdAt: new Date(), type: "INCOME" },
      savings: { id: "sav-1", ownerId, amount: 100, currency: "ARS", category: "ahorro", note: null, occurredAt: new Date(), createdAt: new Date(), type: "SAVINGS" },
    })),
  } as unknown as ExpenseService;
  const movementService = {
    listMovements: vi.fn(async () => []),
    getSummary: vi.fn(async () => ({
      kpis: { income: 0, expenses: 0, balance: 0, count: 0, maxAmount: 0 },
      byCategory: [],
      mom: { months: [] },
      daily: [],
      planned: { month: "2026-10", total: 0 },
      categories: [],
    })),
    updateMovement: vi.fn(async () => ({})),
    markMovementPaid: vi.fn(async () => ({})),
  } as unknown as MovementService;
  const categoryService = {
    listCategories: vi.fn(async () => [
      { id: "c0", ownerId, name: "Cafe", type: "NORMAL", createdAt: new Date(), keywords: [] },
    ]),
    createCategory: vi.fn(async (_owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId,
      name,
      type: "NORMAL",
      createdAt: new Date(),
    })),
    deleteCategory: vi.fn(async () => ({})),
    renameCategory: vi.fn(async () => null),
    ensureOtro: vi.fn(async () => undefined),
    ensureAhorro: vi.fn(async () => undefined),
    matchNote: vi.fn(async () => null),
    listKeywordRules: vi.fn(async () => []),
  } as unknown as CategoryService;
  const savingsService = {
    defineRule: vi.fn(async () => ({ id: "r1", ownerId, keyword: "x", percent: 10 })),
    matchNote: vi.fn(async () => null),
    resolveSplit: vi.fn(async () => ({ kind: "whole" })),
    computeSplit: vi.fn((gross: number, percent: number) => ({
      net: gross - (gross * percent) / 100,
      savings: (gross * percent) / 100,
    })),
  } as unknown as SavingsRuleService;
  const botStateRepository = {
    get: vi.fn(async () => storedState),
    set: vi.fn(async (state: BotStateRecord) => {
      storedState = state;
    }),
    clear: vi.fn(async () => {
      storedState = null;
    }),
  } as unknown as BotStateRepository;
  const household = {
    resolveOwnerByChatId: vi.fn(() => ownerId),
    partnerOf: vi.fn(() => null),
  } as unknown as HouseholdService;

  const service = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    savingsService,
    botStateRepository,
    household,
    logger: () => undefined,
  });

  return {
    service,
    mockCreateExpense: vi.mocked(expenseService.createExpense),
    mockCreateIncomeWithSavings: vi.mocked(expenseService.createIncomeWithSavings),
    mockResolveSplit: vi.mocked(savingsService.resolveSplit),
    mockEnsureAhorro: vi.mocked(categoryService.ensureAhorro),
    mockMatchNote: vi.mocked(savingsService.matchNote),
    botStateRepository,
    replies,
    keyboards,
    reply,
  };
}

describe("TelegramService savings split on INGRESO (v2)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  async function saveIngreso(text: string): Promise<void> {
    await h.service.handleCallback(callbackUpdate("m:inc"), h.reply);
    await h.service.handleUpdate(textUpdate({ text, messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    await h.service.handleCallback(callbackUpdate("cat:c0"), h.reply);
    await h.service.handleCallback(callbackUpdate(`pv:save:${payload.saveToken}`), h.reply);
  }

  it("splits an INGRESO with a matching rule: net INCOME + SAVINGS in ahorro, one transaction", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "split", percent: 10 });

    await saveIngreso("cobro sueldo de entrenuts 1000");

    expect(h.mockResolveSplit).toHaveBeenCalledWith(ownerId, "cobro sueldo de entrenuts", { kind: "none" });
    expect(h.mockEnsureAhorro).toHaveBeenCalledWith(ownerId);
    expect(h.mockCreateIncomeWithSavings).toHaveBeenCalledWith({
      ownerId,
      gross: 1000,
      percent: 10,
      note: "cobro sueldo de entrenuts",
      netCategory: "Cafe",
      savingsCategory: "ahorro",
      visibility: "INDIVIDUAL",
      occurredAt: expect.any(Date),
    });
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(successSplitReply(1000, 900, 100, "Cafe"));
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("registers whole INCOME with the standard confirmation when no rule matches", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "whole" });

    await saveIngreso("cobro sueldo 1000");

    expect(h.mockResolveSplit).toHaveBeenCalledWith(ownerId, "cobro sueldo", { kind: "none" });
    expect(h.mockCreateIncomeWithSavings).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, note: "cobro sueldo", category: "Cafe", type: "INCOME" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-2)).toBe(successReply(1000, "cobro sueldo", "Cafe"));
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("COMPARTIDO NEVER splits even when the note matches a rule (single SHARED EXPENSE)", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "split", percent: 10 });
    h.mockResolveSplit.mockClear();

    await h.service.handleCallback(callbackUpdate("m:shr"), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "2000 super de entrenuts", messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    await h.service.handleCallback(callbackUpdate("cat:c0"), h.reply);
    await h.service.handleCallback(callbackUpdate(`pv:save:${payload.saveToken}`), h.reply);

    expect(h.mockResolveSplit).not.toHaveBeenCalled();
    expect(h.mockCreateIncomeWithSavings).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, note: "super de entrenuts", category: "Cafe", type: "EXPENSE" }),
      ownerId,
      { visibility: "SHARED" },
    );
  });

  it("PENDING never splits either (savings only apply to INGRESO)", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "split", percent: 10 });
    h.mockResolveSplit.mockClear();

    await h.service.handleCallback(callbackUpdate("m:prev"), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "2500 alquiler", messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    await h.service.handleCallback(callbackUpdate("cat:c0"), h.reply);
    await h.service.handleCallback(callbackUpdate(`pv:save:${payload.saveToken}`), h.reply);

    expect(h.mockResolveSplit).not.toHaveBeenCalled();
    expect(h.mockCreateIncomeWithSavings).not.toHaveBeenCalled();
  });

  it("the menu tap persists capture type INGRESO", async () => {
    await h.service.handleCallback(callbackUpdate("m:inc"), h.reply);

    const state = await h.botStateRepository.get(ownerId);
    const payload = capturePayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.type).toBe("INGRESO");
  });
});

describe("TelegramService savings row and sv:* choices on the INGRESO confirmation (savings-config)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  /** Opens an INGRESO preview, picks a category and returns the open payload + its saveToken. */
  async function openIngresoConfirmation(text: string): Promise<PreviewPayload> {
    await h.service.handleCallback(callbackUpdate("m:inc"), h.reply);
    await h.service.handleUpdate(textUpdate({ text, messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    await h.service.handleCallback(callbackUpdate("cat:c0"), h.reply);
    return payload;
  }

  /** Asserts the last keyboard contains exactly the savings row [5%][10%][Otro][No apartar] for the token. */
  function expectSavingsRow(token: string): void {
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    const savingsRow = kb.find((row) => row.some((button) => button.callback_data.startsWith("sv:")));
    expect(savingsRow?.map((button) => button.callback_data)).toEqual([
      `sv:5:${token}`,
      `sv:10:${token}`,
      `sv:other:${token}`,
      `sv:off:${token}`,
    ]);
  }

  it("renders the savings row on the INGRESO confirmation and labels the auto suggestion (regla)", async () => {
    h.mockMatchNote.mockResolvedValue(10);
    const payload = await openIngresoConfirmation("cobro sueldo de entrenuts 1000");

    expectSavingsRow(payload.saveToken);
    expect(h.replies.at(-1)).toBe(previewConfirmReply(1000, "cobro sueldo de entrenuts", "INGRESO", "Cafe", {
      kind: "auto",
      percent: 10,
    }));
  });

  it("labels the auto suggestion as 'sin regla' when no rule matches", async () => {
    h.mockMatchNote.mockResolvedValue(null);
    const payload = await openIngresoConfirmation("cobro sueldo 1000");

    expect(h.replies.at(-1)).toBe(previewConfirmReply(1000, "cobro sueldo", "INGRESO", "Cafe", {
      kind: "auto",
      percent: null,
    }));
    expectSavingsRow(payload.saveToken);
  });

  it("does NOT render the savings row on non-INGRESO confirmations (REAL keeps Guardar/Corregir)", async () => {
    await h.service.handleCallback(callbackUpdate("m:new"), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    await h.service.handleCallback(callbackUpdate("cat:c0"), h.reply);

    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb.flat().some((button) => button.callback_data.startsWith("sv:"))).toBe(false);
    expect(kb.flat().map((button) => button.callback_data)).toContain(`pv:save:${payload.saveToken}`);
  });

  it("sv:5 persists {kind:'percent', percent:5} and edits the confirmation in place with the manual label", async () => {
    const payload = await openIngresoConfirmation("cobro sueldo de entrenuts 1000");

    await h.service.handleCallback(callbackUpdate(`sv:5:${payload.saveToken}`), h.reply);

    const state = await h.botStateRepository.get(ownerId);
    const updated = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(updated.savings).toEqual({ kind: "percent", percent: 5 });
    expect(h.replies.at(-1)).toBe(
      previewConfirmReply(1000, "cobro sueldo de entrenuts", "INGRESO", "Cafe", { kind: "percent", percent: 5 }),
    );
    const kbAfter = h.keyboards.at(-1) as InlineKeyboard;
    const savingsRowAfter = kbAfter.find((row) => row.some((button) => button.callback_data.startsWith("sv:")));
    expect(savingsRowAfter?.map((button) => button.callback_data)).toEqual([
      `sv:5:${payload.saveToken}`,
      `sv:10:${payload.saveToken}`,
      `sv:other:${payload.saveToken}`,
      `sv:off:${payload.saveToken}`,
    ]);
    expect(kbAfter.at(-1)?.map((button) => button.callback_data)).toEqual([
      `pv:save:${payload.saveToken}`,
      `pv:edit:${payload.saveToken}`,
    ]);
  });

  it("sv:off persists {kind:'disabled'} and saves register the whole INCOME via the disabled override", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "whole" });
    const payload = await openIngresoConfirmation("cobro sueldo de entrenuts 1000");

    await h.service.handleCallback(callbackUpdate(`sv:off:${payload.saveToken}`), h.reply);
    expect(h.replies.at(-1)).toBe(
      previewConfirmReply(1000, "cobro sueldo de entrenuts", "INGRESO", "Cafe", { kind: "disabled" }),
    );

    await h.service.handleCallback(callbackUpdate(`pv:save:${payload.saveToken}`), h.reply);

    expect(h.mockResolveSplit).toHaveBeenCalledWith(ownerId, "cobro sueldo de entrenuts", { kind: "disabled" });
    expect(h.mockCreateIncomeWithSavings).not.toHaveBeenCalled();
  });

  it("sv:other enters awaiting_savings_percent persisting the preview", async () => {
    const payload = await openIngresoConfirmation("cobro sueldo 1000");

    await h.service.handleCallback(callbackUpdate(`sv:other:${payload.saveToken}`), h.reply);

    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_savings_percent");
    const saved = savingsPercentPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(saved.preview.saveToken).toBe(payload.saveToken);
    expect(h.replies.at(-1)).toBe(savingsPercentPromptReply());
  });

  it("a valid percent reply returns to awaiting_preview, persists the override and edits the confirmation", async () => {
    const payload = await openIngresoConfirmation("cobro sueldo 1000");
    await h.service.handleCallback(callbackUpdate(`sv:other:${payload.saveToken}`), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "15,5%", messageId: 3 }), h.reply);

    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_preview");
    const updated = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(updated.savings).toEqual({ kind: "percent", percent: 15.5 });
    expect(h.replies.at(-1)).toBe(
      previewConfirmReply(1000, "cobro sueldo", "INGRESO", "Cafe", { kind: "percent", percent: 15.5 }),
    );
  });

  it("an invalid percent reply re-prompts and keeps the awaiting_savings_percent state", async () => {
    const payload = await openIngresoConfirmation("cobro sueldo 1000");
    await h.service.handleCallback(callbackUpdate(`sv:other:${payload.saveToken}`), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "150", messageId: 3 }), h.reply);

    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_savings_percent");
    expect(h.replies.at(-1)).toBe(savingsPercentInvalidReply());
    const saved = savingsPercentPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(saved.preview.savings).toBeUndefined();
  });

  it("gates sv:* by state+token: a mismatched token replies already processed and changes nothing", async () => {
    await openIngresoConfirmation("cobro sueldo 1000");

    await h.service.handleCallback(callbackUpdate("sv:5:deadbeef"), h.reply);

    expect(h.replies.at(-1)).toBe(alreadyProcessedReply());
    const state = await h.botStateRepository.get(ownerId);
    const unchanged = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(unchanged.savings).toBeUndefined();
  });
});