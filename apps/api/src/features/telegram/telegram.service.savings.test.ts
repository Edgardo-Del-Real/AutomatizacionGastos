import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { CategoryService } from "../categories/categories.service";
import type { SavingsRuleService } from "../savings/savings.service";
import type { HouseholdService } from "../household/household.service";
import type { BotStateRepository, BotStateRecord } from "./bot-state.repository";
import type { InlineKeyboard } from "./telegram.parser";
import { capturePayloadSchema, previewPayloadSchema, TelegramService } from "./telegram.service";
import { menuReply, successReply } from "./reply-text";

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
  mockResolveSplit: ReturnType<typeof vi.fn>;
  mockEnsureAhorro: ReturnType<typeof vi.fn>;
  mockListCategories: ReturnType<typeof vi.fn>;
  botStateRepository: BotStateRepository;
  replies: string[];
  reply: (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>;
};

function makeHarness(): Harness {
  const replies: string[] = [];
  const reply = async (text: string): Promise<void> => {
    replies.push(text);
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
    mockResolveSplit: vi.mocked(savingsService.resolveSplit),
    mockEnsureAhorro: vi.mocked(categoryService.ensureAhorro),
    mockListCategories: vi.mocked(categoryService.listCategories),
    botStateRepository,
    replies,
    reply,
  };
}

describe("TelegramService savings flow (v2 — Phase 3: whole INGRESO)", () => {
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

  it("an INGRESO capture registers a whole INCOME (the automatic split lands in Phase 4)", async () => {
    await saveIngreso("cobro sueldo de entrenuts 1000");

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, note: "cobro sueldo de entrenuts", category: "Cafe", type: "INCOME" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    // Phase 3 registers whole: the savings split is not resolved yet.
    expect(h.mockResolveSplit).not.toHaveBeenCalled();
    expect(h.mockEnsureAhorro).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(successReply(1000, "cobro sueldo de entrenuts", "Cafe"));
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("the menu tap persists capture type INGRESO", async () => {
    await h.service.handleCallback(callbackUpdate("m:inc"), h.reply);

    const lastCall = h.mockListCategories.mock.calls.length;
    expect(lastCall).toBeGreaterThan(0);
    const state = await h.botStateRepository.get(ownerId);
    const payload = capturePayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.type).toBe("INGRESO");
  });
});