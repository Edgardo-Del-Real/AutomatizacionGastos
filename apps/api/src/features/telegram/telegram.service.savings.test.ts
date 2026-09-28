import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { CategoryService } from "../categories/categories.service";
import type { SavingsRuleService } from "../savings/savings.service";
import type { HouseholdService } from "../household/household.service";
import type { BotStateRepository, BotStateRecord } from "./bot-state.repository";
import type { ConversationEnvelope, ExecutionResult } from "./bot-brain";
import { TelegramService } from "./telegram.service";

const OWNER_CHAT_ID = 123456789;
const ownerId = "default";

function textUpdate(overrides?: { text?: string; messageId?: number }): unknown {
  return {
    update_id: 8000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
      chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" },
      date: 1712803046,
      text: overrides?.text ?? "cobro sueldo de entrenuts 1000",
    },
  };
}

type SavingsHarness = {
  service: TelegramService;
  mockCreateExpense: ReturnType<typeof vi.fn>;
  mockCreateIncomeWithSavings: ReturnType<typeof vi.fn>;
  mockEnsureAhorro: ReturnType<typeof vi.fn>;
  mockResolveSplit: ReturnType<typeof vi.fn>;
  mockMatchNote: ReturnType<typeof vi.fn>;
  replies: string[];
  reply: (text: string) => Promise<void>;
};

function makeSavingsHarness(): SavingsHarness {
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
      type: "INCOME",
    })),
    createIncomeWithSavings: vi.fn(async () => ({
      net: { amount: 900 },
      savings: { amount: 100 },
    })),
  } as unknown as ExpenseService;
  const movementService = {
    updateMovement: vi.fn(),
    listMovements: vi.fn(async () => []),
    getSummary: vi.fn(async () => emptySummary()),
  } as unknown as MovementService;
  const categoryService = {
    listCategories: vi.fn(async () => [
      { id: "c-work", ownerId, name: "trabajo", type: "NORMAL", createdAt: new Date(), keywords: [] },
    ]),
    matchNote: vi.fn(async () => null),
    ensureOtro: vi.fn(async (owner: string) => ({
      id: "otro-id",
      ownerId: owner,
      name: "otro",
      type: "NORMAL",
      createdAt: new Date(),
    })),
    ensureAhorro: vi.fn(async (owner: string) => ({
      id: "ahorro-id",
      ownerId: owner,
      name: "ahorro",
      type: "SAVINGS",
      createdAt: new Date(),
    })),
    createCategory: vi.fn(async (owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId: owner,
      name,
      type: "NORMAL",
      createdAt: new Date(),
    })),
    deleteCategory: vi.fn(),
    renameCategory: vi.fn(),
    associateKeyword: vi.fn(),
    assertOwnerCategory: vi.fn(),
  } as unknown as CategoryService;
  const savingsService = {
    resolveSplit: vi.fn(async () => ({ kind: "split", percent: 10 })),
    defineRule: vi.fn(),
    matchNote: vi.fn(),
    computeSplit: vi.fn(),
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
  const brain = {
    interpret: vi.fn<(message: string) => Promise<ConversationEnvelope | null>>(async () => null),
    reply: vi.fn<(result: ExecutionResult) => Promise<string | null>>(async () => null),
  };
  const household = {
    resolveOwnerByChatId: vi.fn((chatId: number) => (chatId === OWNER_CHAT_ID ? ownerId : null)),
    partnerOf: vi.fn(() => null),
    getMembers: vi.fn(() => [{ ownerId, name: "default" }]),
  };

  const service = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    savingsService,
    botStateRepository,
    household: household as unknown as HouseholdService,
    logger: vi.fn(),
    brain,
  });

  return {
    service,
    mockCreateExpense: vi.mocked(expenseService.createExpense),
    mockCreateIncomeWithSavings: vi.mocked(expenseService.createIncomeWithSavings),
    mockEnsureAhorro: vi.mocked(categoryService.ensureAhorro),
    mockResolveSplit: vi.mocked(savingsService.resolveSplit),
    mockMatchNote: vi.mocked(categoryService.matchNote),
    replies,
    reply,
  };
}

function emptySummary() {
  return {
    kpis: {
      income: 0,
      expenses: 0,
      balance: 0,
      savings: 0,
      avgPerMonth: 0,
      avgPerMovement: 0,
      maxAmount: 0,
      count: 0,
      countThisMonth: 0,
    },
    mom: { months: [{ month: "2026-09", income: 0, expenses: 0, balance: 0, savings: 0 }] },
    daily: [],
    categories: [],
    top: { expenses: [], income: [] },
      planned: { month: "2026-09", total: 0 },
  };
}

describe("TelegramService savings split tails (D5/D7)", () => {
  let h: SavingsHarness;

  beforeEach(() => {
    h = makeSavingsHarness();
  });

  it("splits a matching INCOME into net INCOME + SAVINGS in one transaction and reports gross/net/savings", async () => {
    await h.service.handleUpdate(textUpdate(), h.reply);

    expect(h.mockCreateIncomeWithSavings).toHaveBeenCalledTimes(1);
    expect(h.mockCreateIncomeWithSavings).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        gross: 1000,
        percent: 10,
        note: expect.any(String),
        category: "ahorro",
        visibility: "INDIVIDUAL",
      }),
    );
    expect(h.mockEnsureAhorro).toHaveBeenCalledWith(ownerId);
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const joined = h.replies.join("\n");
    expect(joined).toContain("1.000,00"); // gross
    expect(joined).toContain("900,00"); // net
    expect(joined).toContain("100,00"); // savings
  });

  it("inherits SHARED visibility on the split when the compartido: prefix is present", async () => {
    await h.service.handleUpdate(textUpdate({ text: "compartido: cobro sueldo de entrenuts 1000" }), h.reply);

    expect(h.mockCreateIncomeWithSavings).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "SHARED" }),
    );
  });

  it("registers a whole INCOME when no rule matches", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "whole" });

    await h.service.handleUpdate(textUpdate({ text: "cobro de otro lado 1000" }), h.reply);

    expect(h.mockCreateIncomeWithSavings).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, type: "INCOME", category: "otro" }),
      ownerId,
      expect.objectContaining({ visibility: "INDIVIDUAL" }),
    );
  });

  it("applies the 'sin ahorro' override: whole INCOME, no SAVINGS movement", async () => {
    // The real resolveSplit honors the disabled override; the mock returns
    // whole so the tail registers a single movement.
    h.mockResolveSplit.mockResolvedValue({ kind: "whole" });

    await h.service.handleUpdate(textUpdate({ text: "sin ahorro cobro sueldo de entrenuts 1000" }), h.reply);

    expect(h.mockResolveSplit).toHaveBeenCalledWith(ownerId, expect.any(String), { kind: "disabled" });
    expect(h.mockCreateIncomeWithSavings).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
  });

  it("applies the 'con 5%' override percent for that message only", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "split", percent: 5 });

    await h.service.handleUpdate(textUpdate({ text: "con 5% cobro sueldo de entrenuts 1000" }), h.reply);

    expect(h.mockResolveSplit).toHaveBeenCalledWith(ownerId, expect.any(String), { kind: "percent", percent: 5 });
    expect(h.mockCreateIncomeWithSavings).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 5, gross: 1000 }),
    );
  });

  it("rejects an invalid override percent with a validation reply and no movement", async () => {
    await h.service.handleUpdate(textUpdate({ text: "con 150% cobro sueldo de entrenuts 1000" }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockCreateIncomeWithSavings).not.toHaveBeenCalled();
    expect(h.replies.join("\n")).toContain("150");
  });

  it("passes the override into the persisted amount-confirmation payload", async () => {
    const { service, mockCreateIncomeWithSavings, mockCreateExpense, replies, reply } = h;
    // The disabled override makes the resolved registration whole.
    h.mockResolveSplit.mockResolvedValue({ kind: "whole" });
    // Brain answers differently in idle (800) and resolves the conflict in the
    // dialog (1000) — the acted-on value comes from the persisted payload.
    const brain = (service as unknown as { deps: { brain?: { interpret: ReturnType<typeof vi.fn> } } }).deps.brain;
    brain?.interpret.mockImplementation(async (message: string) =>
      message === "1000"
        ? {
            intent: "register_expense",
            amount: 1000,
            category: null,
            note: null,
            query_type: null,
            new_name: null,
            dialog_action: "resolve",
            then_reassign: false,
            shared: false,
          }
        : {
            intent: "register_expense",
            amount: 800,
            category: null,
            note: null,
            query_type: null,
            new_name: null,
            dialog_action: null,
            then_reassign: false,
            shared: false,
          },
    );

    await service.handleUpdate(textUpdate({ text: "sin ahorro cobro sueldo de entrenuts 1000" }), reply);
    // The deterministic amount (1000) differs from the brain amount (800): the
    // question asks; answering 1000 resolves from the stored payload, which
    // carries the disabled override.
    await service.handleUpdate(textUpdate({ text: "1000", messageId: 43 }), reply);

    expect(mockCreateIncomeWithSavings).not.toHaveBeenCalled();
    expect(mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(replies.join("\n")).toContain("1.000,00");
  });

  it("redirects a create_savings_rule intent to the explicit command without executing anything", async () => {
    const { service, mockCreateIncomeWithSavings, mockCreateExpense, replies, reply } = h;
    const brain = (service as unknown as { deps: { brain?: { interpret: ReturnType<typeof vi.fn> } } }).deps.brain;
    brain?.interpret.mockResolvedValue({
      intent: "create_savings_rule",
      amount: null,
      category: "entrenuts",
      note: "al 10%",
      query_type: null,
      new_name: null,
      dialog_action: null,
      then_reassign: false,
      shared: false,
    });

    await service.handleUpdate(textUpdate({ text: "guarda un ahorro del 10% para entrenuts" }), reply);

    expect(mockCreateIncomeWithSavings).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
    expect(replies.join("\n")).toContain("registrar ahorro");
  });

  it("answers the month-savings query from real data and redirects honestly on failure", async () => {
    const { service, replies, reply } = h;
    const movementService = (service as unknown as { deps: { movementService: MovementService } }).deps
      .movementService;
    const mockGetSummary = vi.mocked(movementService.getSummary);
    mockGetSummary.mockResolvedValue({
      kpis: {
        income: 0,
        expenses: 0,
        balance: 0,
        savings: 150,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 0,
        count: 0,
        countThisMonth: 0,
      },
      mom: {
        months: [{ month: "2026-09", income: 0, expenses: 0, balance: 0, savings: 150 }],
      },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
      planned: { month: "2026-09", total: 0 },
    });
    const brain = (service as unknown as { deps: { brain?: { interpret: ReturnType<typeof vi.fn> } } }).deps.brain;
    brain?.interpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "savings",
      new_name: null,
      dialog_action: null,
      then_reassign: false,
      shared: false,
    });

    await service.handleUpdate(textUpdate({ text: "cuánto ahorré este mes?" }), reply);
    expect(replies.join("\n")).toContain("150");

    // Failure path: an honest redirect, never a fabricated amount.
    replies.length = 0;
    mockGetSummary.mockRejectedValue(new Error("db down"));
    await service.handleUpdate(textUpdate({ text: "cuánto ahorré este mes?", messageId: 44 }), reply);
    expect(replies.join("\n")).toContain("No pude consultar");
  });
});