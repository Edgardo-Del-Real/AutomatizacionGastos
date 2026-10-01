import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { CategoryService } from "../categories/categories.service";
import type { SavingsRuleService } from "../savings/savings.service";
import type { HouseholdService } from "../household/household.service";
import type { BotStateRepository, BotStateRecord } from "./bot-state.repository";
import type { ConversationEnvelope, ExecutionResult } from "./bot-brain";
import type { InlineKeyboard } from "./telegram.parser";
import { ConflictError, NotFoundError, ValidationFailedError } from "../../infra/errors";
import { ReservedCategoryError } from "../categories/reserved";
import {
  alreadyProcessedReply,
  askAmountReply,
  askCategoryReply,
  associateKeywordRedirectReply,
  callbackUnavailableReply,
  capturePromptReply,
  categoryButtonsReply,
  collectAbandonedReply,
  correctionAbandonedReply,
  correctionDoneReply,
  deletedMovementReply,
  deleteAskReply,
  deleteCancelledReply,
  deleteConfirmReply,
  dialogClosedReply,
  formatARS,
  greetingReply,
  helpReply,
  keptCollectingReply,
  markPaidAlreadyReply,
  markPaidAskReply,
  markPaidReply,
  menuReply,
  ayudaReply,
  movementMissingReply,
  movementSelectionAbandonedReply,
  nothingPendingReply,
  nothingToDeleteReply,
  offTopicRedirectReply,
  otroKeptReply,
  pendingCapturePromptReply,
  plannedSharedRejectedReply,
  queryRedirectReply,
  questionDroppedReply,
  reservedCategoryReply,
  successReply,
} from "./reply-text";
import {
  amountConfirmationPayloadSchema,
  deleteConfirmPayloadSchema,
  lifecycleSelectionPayloadSchema,
  quickCapturePreviewPayloadSchema,
  registrationCollectPayloadSchema,
  TelegramService,
} from "./telegram.service";
import { BOT_STATES } from "./bot-state.repository";

const OWNER_CHAT_ID = 123456789;
const ownerId = "default";

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`chatId`,`messageId`)",
    { code: "P2002", clientVersion: "6.0.0", meta: { target: ["chatId_messageId"] } },
  );
}

function textUpdate(overrides?: { fromId?: number; chatId?: number; messageId?: number; text?: string; chatType?: string }): unknown {
  const fromId = overrides?.fromId ?? OWNER_CHAT_ID;
  return {
    update_id: 8000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: fromId, is_bot: false, first_name: "Rita" },
      chat: { id: overrides?.chatId ?? fromId, type: overrides?.chatType ?? "private", first_name: "Rita" },
      date: 1712803046,
      text: overrides?.text ?? "café 2500",
    },
  };
}

function callbackUpdate(overrides?: { fromId?: number; chatId?: number; messageId?: number; data?: string }): unknown {
  const fromId = overrides?.fromId ?? OWNER_CHAT_ID;
  return {
    update_id: 9000,
    callback_query: {
      id: "cb_1",
      chat_instance: "987654321",
      from: { id: fromId, is_bot: false, first_name: "Rita" },
      message: {
        message_id: overrides?.messageId ?? 77,
        chat: { id: overrides?.chatId ?? fromId, type: "private", first_name: "Rita" },
        date: 1712803046,
        text: "preview",
      },
      data: overrides?.data ?? "m:new",
    },
  };
}

type Harness = {
  service: TelegramService;
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  movementService: MovementService;
  categoryService: CategoryService;
  botStateRepository: BotStateRepository;
  mockRecord: ReturnType<typeof vi.fn>;
  mockCreateExpense: ReturnType<typeof vi.fn>;
  mockUpdateMovement: ReturnType<typeof vi.fn>;
  mockListMovements: ReturnType<typeof vi.fn>;
  mockMarkMovementPaid: ReturnType<typeof vi.fn>;
  mockDeleteExpense: ReturnType<typeof vi.fn>;
  mockGetSummary: ReturnType<typeof vi.fn>;
  mockListCategories: ReturnType<typeof vi.fn>;
  mockListKeywordRules: ReturnType<typeof vi.fn>;
  mockMatchNote: ReturnType<typeof vi.fn>;
  mockCreateCategory: ReturnType<typeof vi.fn>;
  mockDeleteCategory: ReturnType<typeof vi.fn>;
  mockAssociateKeyword: ReturnType<typeof vi.fn>;
  mockRenameCategory: ReturnType<typeof vi.fn>;
  mockEnsureOtro: ReturnType<typeof vi.fn>;
  mockEnsureAhorro: ReturnType<typeof vi.fn>;
  mockResolveSplit: ReturnType<typeof vi.fn>;
  mockSetState: ReturnType<typeof vi.fn>;
  mockBrainInterpret: ReturnType<typeof vi.fn>;
  mockBrainReply: ReturnType<typeof vi.fn>;
  mockLogger: ReturnType<typeof vi.fn>;
  replies: string[];
  keyboards: (InlineKeyboard | undefined)[];
  edits: (number | undefined)[];
  reply: (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>;
};

function makeHarness(options?: { noBrain?: boolean }): Harness {
  const replies: string[] = [];
  const keyboards: (InlineKeyboard | undefined)[] = [];
  const edits: (number | undefined)[] = [];
  const reply = async (text: string, keyboard?: InlineKeyboard, editMessageId?: number): Promise<void> => {
    replies.push(text);
    keyboards.push(keyboard);
    edits.push(editMessageId);
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
    updateMovement: vi.fn(async (ownerIdArg: string, id: string, patch: unknown) => ({
      id,
      ownerId: ownerIdArg,
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE",
      ...(patch as Record<string, unknown>),
    })),
    listMovements: vi.fn(async () => []),
    markMovementPaid: vi.fn(async (id: string) => ({
      id,
      ownerId,
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE" as const,
      status: "PAID" as const,
    })),
    getSummary: vi.fn(async () => emptySummary()),
  } as unknown as MovementService;
  const categoryService = {
    listCategories: vi.fn(async () => []),
    listKeywordRules: vi.fn(async () => []),
    matchNote: vi.fn(async () => null),
    createCategory: vi.fn(async (owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId: owner,
      name,
      createdAt: new Date(),
    })),
    deleteCategory: vi.fn(async (owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId: owner,
      name,
      createdAt: new Date(),
    })),
    associateKeyword: vi.fn(async () => undefined),
    renameCategory: vi.fn(async () => null),
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
    assertOwnerCategory: vi.fn(async () => undefined),
  } as unknown as CategoryService;
  const savingsService = {
    resolveSplit: vi.fn(async () => ({ kind: "whole" })),
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
  const mockLogger = vi.fn();
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
    logger: mockLogger,
    ...(options?.noBrain === true ? {} : { brain }),
  });

  return {
    service,
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    botStateRepository,
    mockRecord: vi.mocked(messageRepository.recordProcessed),
    mockCreateExpense: vi.mocked(expenseService.createExpense),
    mockUpdateMovement: vi.mocked(movementService.updateMovement),
    mockListMovements: vi.mocked(movementService.listMovements),
    mockMarkMovementPaid: vi.mocked(movementService.markMovementPaid),
    mockDeleteExpense: vi.mocked(expenseService.deleteExpense),
    mockGetSummary: vi.mocked(movementService.getSummary),
    mockListCategories: vi.mocked(categoryService.listCategories),
    mockListKeywordRules: vi.mocked(categoryService.listKeywordRules),
    mockMatchNote: vi.mocked(categoryService.matchNote),
    mockCreateCategory: vi.mocked(categoryService.createCategory),
    mockDeleteCategory: vi.mocked(categoryService.deleteCategory),
    mockAssociateKeyword: vi.mocked(categoryService.associateKeyword),
    mockRenameCategory: vi.mocked(categoryService.renameCategory),
    mockEnsureOtro: vi.mocked(categoryService.ensureOtro),
    mockEnsureAhorro: vi.mocked(categoryService.ensureAhorro),
    mockResolveSplit: vi.mocked(savingsService.resolveSplit),
    mockSetState: vi.mocked(botStateRepository.set),
    mockBrainInterpret: vi.mocked(brain.interpret),
    mockBrainReply: vi.mocked(brain.reply),
    mockLogger,
    replies,
    keyboards,
    edits,
    reply,
  };
}

function seedHarnessCategories(h: Harness, names: string[]): void {
  h.mockListCategories.mockResolvedValue(
    names.map((name) => ({ id: `c-${name}`, ownerId, name, createdAt: new Date(), keywords: [] })),
  );
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

describe("registrationCollectPayloadSchema", () => {
  it("parses a full collect payload with amount, category, note and flags", () => {
    const result = registrationCollectPayloadSchema.safeParse({
      body: "quiero cargar un gasto previsto",
      note: "gym",
      amount: 5000,
      category: "Gimnasio",
      shared: true,
      planned: true,
      override: { kind: "percent", percent: 10 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe("gym");
      expect(result.data.amount).toBe(5000);
      expect(result.data.category).toBe("Gimnasio");
      expect(result.data.shared).toBe(true);
      expect(result.data.planned).toBe(true);
      expect(result.data.override).toEqual({ kind: "percent", percent: 10 });
    }
  });

  it("accepts a nullable amount and category (open fields)", () => {
    const result = registrationCollectPayloadSchema.safeParse({
      body: "gym",
      note: "gym",
      amount: null,
      category: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBeNull();
      expect(result.data.category).toBeNull();
    }
  });

  it("defaults shared, planned and override when omitted", () => {
    const result = registrationCollectPayloadSchema.safeParse({
      body: "gym",
      note: null,
      amount: null,
      category: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shared).toBe(false);
      expect(result.data.planned).toBe(false);
      expect(result.data.override).toEqual({ kind: "none" });
    }
  });

  it.each([0, -5])("rejects a non-positive amount (%s)", (amount) => {
    expect(
      registrationCollectPayloadSchema.safeParse({ body: "x", note: null, amount, category: null }).success,
    ).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(
      registrationCollectPayloadSchema.safeParse({ body: "", note: null, amount: null, category: null }).success,
    ).toBe(false);
  });

  it("declares awaiting_registration as a persisted bot state", () => {
    expect(BOT_STATES).toContain("awaiting_registration");
  });
});

describe("quickCapturePreviewPayloadSchema (D4 preview state)", () => {
  it("parses a full preview payload with type, saveToken, shared and override", () => {
    const result = quickCapturePreviewPayloadSchema.safeParse({
      body: "30000 gym",
      amount: 30000,
      note: "gym",
      category: "Gimnasio",
      type: "PENDING",
      saveToken: "a1b2c3d4",
      shared: true,
      override: { kind: "percent", percent: 10 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("30000 gym");
      expect(result.data.amount).toBe(30000);
      expect(result.data.note).toBe("gym");
      expect(result.data.category).toBe("Gimnasio");
      expect(result.data.type).toBe("PENDING");
      expect(result.data.saveToken).toBe("a1b2c3d4");
      expect(result.data.shared).toBe(true);
      expect(result.data.override).toEqual({ kind: "percent", percent: 10 });
    }
  });

  it("defaults type REAL, shared false and override none when omitted", () => {
    const result = quickCapturePreviewPayloadSchema.safeParse({
      body: "30000 gym",
      amount: 30000,
      note: "gym",
      category: "Gimnasio",
      saveToken: "a1b2c3d4",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("REAL");
      expect(result.data.shared).toBe(false);
      expect(result.data.override).toEqual({ kind: "none" });
    }
  });

  it("rejects a non-8-hex saveToken", () => {
    expect(
      quickCapturePreviewPayloadSchema.safeParse({
        body: "30000 gym",
        amount: 30000,
        note: "gym",
        category: "Gimnasio",
        saveToken: "not-hex",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown type value", () => {
    expect(
      quickCapturePreviewPayloadSchema.safeParse({
        body: "30000 gym",
        amount: 30000,
        note: "gym",
        category: "Gimnasio",
        type: "SHARED",
        saveToken: "a1b2c3d4",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    expect(
      quickCapturePreviewPayloadSchema.safeParse({
        body: "30000 gym",
        amount: -1,
        note: "gym",
        category: "Gimnasio",
        saveToken: "a1b2c3d4",
      }).success,
    ).toBe(false);
  });
});

describe("deleteConfirmPayloadSchema (D6 delete gate)", () => {
  it("parses a delete-confirm payload carrying the persisted target", () => {
    const result = deleteConfirmPayloadSchema.safeParse({
      target: {
        id: "cuid-123",
        amount: 2500,
        note: "alquiler",
        date: "2026-09-19",
        category: "Alquiler",
        occurredAtMs: 1726747200000,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target.id).toBe("cuid-123");
      expect(result.data.target.amount).toBe(2500);
      expect(result.data.target.note).toBe("alquiler");
      expect(result.data.target.date).toBe("2026-09-19");
      expect(result.data.target.category).toBe("Alquiler");
      expect(result.data.target.occurredAtMs).toBe(1726747200000);
    }
  });

  it("rejects a payload without a target id", () => {
    expect(
      deleteConfirmPayloadSchema.safeParse({
        target: { amount: 2500, note: null, date: "2026-09-19", category: "", occurredAtMs: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("TelegramService.handleCallback (D4 callback channel)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  function callbackUpdate(overrides?: { fromId?: number; chatId?: number; messageId?: number; data?: unknown }): unknown {
    const fromId = overrides?.fromId ?? OWNER_CHAT_ID;
    return {
      update_id: 9000,
      callback_query: {
        id: "cb_1",
        from: { id: fromId, is_bot: false, first_name: "Rita" },
        message: {
          message_id: overrides?.messageId ?? 77,
          chat: { id: overrides?.chatId ?? fromId, type: "private", first_name: "Rita" },
          date: 1712803046,
          text: "preview",
        },
        data: overrides?.data ?? "m:new",
      },
    };
  }

  it("replies honestly to an unknown action prefix and changes no state (spec: Unknown action replied honestly)", async () => {
    const before = h.mockSetState.mock.calls.length;

    const processed = await h.service.handleCallback(callbackUpdate({ data: "zz:1" }), h.reply);

    expect(processed).toBe(true);
    expect(h.replies.at(-1)).toBe(callbackUnavailableReply());
    expect(h.mockSetState.mock.calls.length).toBe(before);
  });

  it("ignores a callback from an unknown chat: nothing executes, no reply (spec: Unknown chat ignored)", async () => {
    const before = h.mockSetState.mock.calls.length;

    const processed = await h.service.handleCallback(callbackUpdate({ fromId: 999999999, chatId: 999999999 }), h.reply);

    expect(processed).toBe(false);
    expect(h.replies).toHaveLength(0);
    expect(h.mockSetState.mock.calls.length).toBe(before);
  });

  it("returns false for a non-callback update", async () => {
    expect(await h.service.handleCallback(textUpdate(), h.reply)).toBe(false);
    expect(h.replies).toHaveLength(0);
  });

  it("returns false for a callback with a non-string data", async () => {
    expect(await h.service.handleCallback(callbackUpdate({ data: 42 }), h.reply)).toBe(false);
    expect(h.replies).toHaveLength(0);
  });
});

describe("TelegramService quick-capture preview (awaiting_preview, D4)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Gimnasio", "otro"]);
    h.mockListKeywordRules.mockResolvedValue([
      { keyword: "gym", category: "Gimnasio", createdAt: new Date("2026-09-01T10:00:00Z") },
    ]);
  });

  it("parses '30000 gym' into a preview and NEVER invokes the brain (spec: Captured message skips the LLM)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain(formatARS(30000));
    expect(h.replies.at(-1)).toContain("gym");
    expect(h.replies.at(-1)).toContain("Gimnasio");
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_preview");
    const payload = quickCapturePreviewPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.amount).toBe(30000);
    expect(payload.note).toBe("gym");
    expect(payload.category).toBe("Gimnasio");
    expect(payload.type).toBe("REAL");
    expect(payload.saveToken).toMatch(/^[0-9a-f]{8}$/);
    // The preview carries the Guardar/Corregir + type rows as an inline keyboard.
    expect(h.keyboards.at(-1)).toBeDefined();
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb[0]?.[0]?.text).toBe("✅ Guardar");
    expect(kb[0]?.[1]?.text).toBe("✏️ Corregir");
  });

  it("seeds type PENDING from the previsto: prefix (sanctioned producer)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "previsto: 30000 gym", messageId: 1 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const payload = quickCapturePreviewPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.type).toBe("PENDING");
    expect(h.replies.at(-1)).toContain("previsto");
  });

  it("falls through to the brain on a parser miss (spec: Miss falls back to the brain)", async () => {
    h.mockBrainInterpret.mockResolvedValue({ intent: "register_expense", amount: 30000, category: "otro", note: "alquiler" });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "30000 alquiler", messageId: 1 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledTimes(1);
    expect(h.mockSetState).not.toHaveBeenCalledWith(expect.objectContaining({ state: "awaiting_preview" }));
  });

  it("toggles the type to PENDING via the Previsto button and edits the preview message", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);
    const stored = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const token = quickCapturePreviewPayloadSchema.parse(JSON.parse(stored.pendingNote ?? "{}")).saveToken;

    const processed = await h.service.handleCallback(
      callbackUpdate({ messageId: 77, data: `pv:typ:p:${token}` }),
      h.reply,
    );

    expect(processed).toBe(true);
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const payload = quickCapturePreviewPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.type).toBe("PENDING");
    // The re-render EDITS the preview's own message with the same keyboard.
    expect(h.edits.at(-1)).toBe(77);
    expect(h.keyboards.at(-1)).toBeDefined();
  });

  it("saves via Guardar: registers a REAL expense once and returns to idle", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);
    const stored = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const token = quickCapturePreviewPayloadSchema.parse(JSON.parse(stored.pendingNote ?? "{}")).saveToken;

    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${token}` }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 30000, note: "gym", category: "Gimnasio", type: "EXPENSE" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
    expect(h.replies.at(-1)).toContain("Registrado");
  });

  it("a retried Guardar replies 'ya procesado' and registers exactly once (spec: Repeated Guardar registers once)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);
    const stored = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const token = quickCapturePreviewPayloadSchema.parse(JSON.parse(stored.pendingNote ?? "{}")).saveToken;

    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${token}` }), h.reply);
    h.mockCreateExpense.mockClear();
    const processed = await h.service.handleCallback(callbackUpdate({ data: `pv:save:${token}` }), h.reply);

    expect(processed).toBe(true);
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(alreadyProcessedReply());
  });

  it("saves with Previsto chosen registers a PENDING EXPENSE, never SHARED (spec: Save with Previsto registers PENDING)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);
    const stored = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const payload = quickCapturePreviewPayloadSchema.parse(JSON.parse(stored.pendingNote ?? "{}"));
    await h.service.handleCallback(callbackUpdate({ data: `pv:typ:p:${payload.saveToken}` }), h.reply);
    const afterToggle = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const toggled = quickCapturePreviewPayloadSchema.parse(JSON.parse(afterToggle.pendingNote ?? "{}"));

    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${toggled.saveToken}` }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 30000, type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-1)).toContain("previsto");
  });

  it("Corregir abandons the preview, returns to idle and prompts a new capture (spec: Corregir reopens capture)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);
    const stored = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const token = quickCapturePreviewPayloadSchema.parse(JSON.parse(stored.pendingNote ?? "{}")).saveToken;

    await h.service.handleCallback(callbackUpdate({ data: `pv:edit:${token}` }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
    expect(h.replies.at(-1)).toBe(capturePromptReply());
  });

  it("recovers from a corrupt preview payload to idle without registering (spec: Corrupt preview payload recovers)", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_preview",
      pendingMovementId: null,
      pendingNote: "{not-json",
    });

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
  });

  it("a new text message during awaiting_preview abandons the preview and reprocesses normally (D11)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);
    h.mockListKeywordRules.mockResolvedValue([]);
    h.mockBrainInterpret.mockResolvedValue(null);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "5000 cafe", messageId: 2 }), h.reply);

    // The preview is abandoned: the new text is reprocessed and registers as a
    // fresh movement (otro + correction), never from the preview facts.
    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, note: "cafe" }),
      ownerId,
      expect.anything(),
    );
    const lastState = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastState.state).not.toBe("awaiting_preview");
  });
});

describe("TelegramService delete confirmation gate (awaiting_delete_confirmation, D6)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["otro"]);
  });

  async function seedDeleteGate(target: { id: string; amount: number; note: string | null; date: string; category: string; occurredAtMs: number }): Promise<void> {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_delete_confirmation",
      pendingMovementId: null,
      pendingNote: JSON.stringify({ target }),
    });
  }

  it("dc:ok deletes the persisted target via deleteExpense and returns to idle (spec: Confirmation deletes)", async () => {
    await seedDeleteGate({ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19", category: "Alquiler", occurredAtMs: 1726747200000 });

    const processed = await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m1" }), h.reply);

    expect(processed).toBe(true);
    expect(h.mockDeleteExpense).toHaveBeenCalledWith("m1", ownerId);
    expect(h.replies.at(-1)).toBe(deletedMovementReply(2500, "alquiler", "Alquiler"));
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
  });

  it("a retried dc:ok after consumption replies 'ya procesado' and deletes once (spec: Retried delete confirms once)", async () => {
    await seedDeleteGate({ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19", category: "Alquiler", occurredAtMs: 1726747200000 });

    await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m1" }), h.reply);
    h.mockDeleteExpense.mockClear();
    const processed = await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m1" }), h.reply);

    expect(processed).toBe(true);
    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(alreadyProcessedReply());
  });

  it("dc:no cancels: nothing is deleted and the owner returns to idle (spec: Cancel keeps the movement)", async () => {
    await seedDeleteGate({ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19", category: "Alquiler", occurredAtMs: 1726747200000 });

    const processed = await h.service.handleCallback(callbackUpdate({ data: "dc:no:m1" }), h.reply);

    expect(processed).toBe(true);
    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(deleteCancelledReply());
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
  });

  it("dc:ok on a target deleted elsewhere replies movement missing (spec: Deleted target replies missing)", async () => {
    await seedDeleteGate({ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19", category: "Alquiler", occurredAtMs: 1726747200000 });
    h.mockDeleteExpense.mockRejectedValue(new NotFoundError("Expense m1 not found"));

    await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m1" }), h.reply);

    expect(h.replies.at(-1)).toBe(movementMissingReply());
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
  });

  it("a gate callback with a corrupt payload recovers to idle without deleting (spec: retried or corrupt gate payload recovers)", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_delete_confirmation",
      pendingMovementId: null,
      pendingNote: "{broken",
    });

    const processed = await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m1" }), h.reply);

    expect(processed).toBe(true);
    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
  });

  it("a delete gate callback for a DIFFERENT target than persisted replies already-processed (target id gate)", async () => {
    await seedDeleteGate({ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19", category: "Alquiler", occurredAtMs: 1726747200000 });

    await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m-other" }), h.reply);

    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(alreadyProcessedReply());
  });
});

describe("TelegramService main menu (m:* callbacks, D8/D10)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["otro"]);
  });

  it("renders the menu command with exactly five buttons (spec: Menu shows five actions)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "/menu", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe(menuReply());
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb).toHaveLength(5);
    expect(kb.map((row) => row[0]?.text)).toEqual([
      "Nuevo gasto",
      "Gasto previsto",
      "Borrar",
      "Reporte",
      "Ayuda",
    ]);
    expect(kb.map((row) => row[0]?.callback_data)).toEqual(["m:new", "m:prev", "m:del", "m:rep", "m:help"]);
    // Reopening the menu never changes state (spec: Menu reopens without side effects).
    expect(h.mockSetState).not.toHaveBeenCalled();
  });

  it("m:new replies the capture prompt and stays idle (no state change)", async () => {
    const processed = await h.service.handleCallback(callbackUpdate({ data: "m:new" }), h.reply);

    expect(processed).toBe(true);
    expect(h.replies.at(-1)).toBe(capturePromptReply());
    expect(h.mockSetState).not.toHaveBeenCalled();
  });

  it("m:prev replies the educational pending-capture prompt and does NOT remember the intent (D8)", async () => {
    const processed = await h.service.handleCallback(callbackUpdate({ data: "m:prev" }), h.reply);

    expect(processed).toBe(true);
    expect(h.replies.at(-1)).toBe(pendingCapturePromptReply());
    expect(h.mockSetState).not.toHaveBeenCalled();
  });

  it("m:del lists the delete window as dk buttons and persists the selection payload (spec: Borrar starts the delete flow)", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PAID"),
      lifecycleMovement("m2", 900, "gimnasio", new Date("2026-09-17T12:00:00.000Z"), "Gimnasio", "PAID"),
    ]);

    await h.service.handleCallback(callbackUpdate({ data: "m:del" }), h.reply);

    expect(h.replies.at(-1)).toContain("¿Cuál querés borrar?");
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    const dkButtons = kb.flat().filter((button) => button.callback_data.startsWith("dk:"));
    expect(dkButtons.map((button) => button.callback_data)).toEqual(["dk:m1", "dk:m2"]);
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_movement_selection");
    const payload = lifecycleSelectionPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.action).toBe("delete_expense");
  });

  it("m:rep answers from the real recent-movements query (spec: Reporte answers from real data)", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PAID"),
    ]);
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleCallback(callbackUpdate({ data: "m:rep" }), h.reply);

    expect(h.mockListMovements).toHaveBeenCalledWith(
      { viewerId: ownerId, partnerId: null, visibility: "all" },
      {},
    );
    expect(h.replies.at(-1)).toContain("alquiler");
  });

  it("m:help replies the static help with zero LLM calls (spec: Ayuda replies offline)", async () => {
    const processed = await h.service.handleCallback(callbackUpdate({ data: "m:help" }), h.reply);

    expect(processed).toBe(true);
    expect(h.replies.at(-1)).toBe(ayudaReply());
    expect(h.mockBrainReply).not.toHaveBeenCalled();
  });

  it("a dk pick opens the delete GATE with the picked target (D10)", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: JSON.stringify({
        action: "delete_expense",
        candidates: [
          { id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" },
          { id: "m2", amount: 900, note: "gimnasio", date: "2026-09-17" },
        ],
      }),
    });

    await h.service.handleCallback(callbackUpdate({ data: "dk:m1" }), h.reply);

    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(deleteConfirmReply(2500, "alquiler", null));
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_delete_confirmation");
  });
});

describe("TelegramService dialog category buttons (D9 closed set)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  async function seedAwaitingCategory(movementId: string, note: string | null): Promise<void> {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: movementId,
      pendingNote: note,
    });
  }

  it("an unknown single-token answer renders the category buttons and NEVER auto-creates (spec: Unknown single-token answer shows buttons)", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    seedHarnessCategories(h, ["otro", "Transporte", "Cafe"]);
    h.mockCreateCategory.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "Mascotas", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    const catButtons = kb.flat().filter((button) => button.callback_data.startsWith("cat:"));
    expect(catButtons.length).toBeGreaterThan(0);
    // The buttons encode category IDs, never names (spec: Callback data encodes ids).
    for (const button of catButtons) {
      expect(button.callback_data).toMatch(/^cat:[a-zA-Z0-9-]+$/);
      expect(button.callback_data.length).toBeLessThanOrEqual(64);
    }
    // The state stays open (spec: the state stays open).
    const state = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(state.state).toBe("awaiting_category");
  });

  it("a multi-word non-category answer lists the categories as buttons and stays open (spec: Multi-word non-category answer)", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    seedHarnessCategories(h, ["otro", "Transporte"]);

    await h.service.handleUpdate(textUpdate({ text: "alguna otra cosa", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
    const state = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(state.state).toBe("awaiting_category");
  });

  it("an exact text answer still resolves and reassigns (no buttons)", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    seedHarnessCategories(h, ["otro", "Transporte"]);

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-9", { category: "Transporte" });
    expect(h.replies.at(-1)).toBe(correctionDoneReply("Transporte"));
  });

  it("a punctuated guard word still routes to the abandon handling and never auto-creates (spec: Punctuated guard never auto-creates)", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    seedHarnessCategories(h, ["otro", "Transporte"]);
    h.mockCreateCategory.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no.", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(otroKeptReply());
  });

  it("a cat: callback applies the correction with the SAME tail as the text answer (D9)", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    seedHarnessCategories(h, ["otro", "Transporte", "Cafe"]);

    const processed = await h.service.handleCallback(callbackUpdate({ data: "cat:c-Transporte" }), h.reply);

    expect(processed).toBe(true);
    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-9", { category: "Transporte" });
    expect(h.replies.at(-1)).toBe(correctionDoneReply("Transporte"));
  });

  it("a cat: callback for a deleted category replies honestly and re-renders the buttons (spec: Deleted target replies missing)", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    seedHarnessCategories(h, ["otro", "Transporte"]);

    const processed = await h.service.handleCallback(callbackUpdate({ data: "cat:deleted-cat" }), h.reply);

    expect(processed).toBe(true);
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
    // The state stays open (honest re-render).
    const state = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(state.state).toBe("awaiting_category");
  });

  it("a cat: callback on a closed dialog replies dialog-closed (spec: cat: on a closed dialog → dialogClosedReply)", async () => {
    seedHarnessCategories(h, ["otro", "Transporte"]);

    const processed = await h.service.handleCallback(callbackUpdate({ data: "cat:c-Transporte" }), h.reply);

    expect(processed).toBe(true);
    expect(h.replies.at(-1)).toBe(dialogClosedReply());
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
  });
});

describe("TelegramService registration-collection category buttons (D9)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["otro", "Transporte", "Cafe"]);
  });

  async function seedCollect(payload: { amount: number | null; category: string | null; note: string | null }): Promise<void> {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_registration",
      pendingMovementId: null,
      pendingNote: JSON.stringify({
        body: "gym",
        note: payload.note,
        amount: payload.amount,
        category: payload.category,
        shared: false,
        planned: false,
        override: { kind: "none" },
      }),
    });
  }

  it("a single-token non-match in the collect shows buttons and never auto-creates (spec: Single-token non-match shows buttons)", async () => {
    await seedCollect({ amount: 5000, category: null, note: "gym" });
    h.mockCreateCategory.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "Mascotas", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
    const state = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(state.state).toBe("awaiting_registration");
  });

  it("a cat: callback during the collect completes the registration with the picked category (shared tail)", async () => {
    await seedCollect({ amount: 5000, category: null, note: "gym" });

    await h.service.handleCallback(callbackUpdate({ data: "cat:c-Cafe" }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, note: "gym", category: "Cafe" }),
      ownerId,
      expect.anything(),
    );
  });
});

describe("TelegramService state machine", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("records the 3-arg reply stub into parallel arrays (D13 harness migration)", async () => {
    const kb: InlineKeyboard = [[{ text: "A", callback_data: "m:new" }]];
    await h.reply("texto", kb, 77);

    expect(h.replies).toEqual(["texto"]);
    expect(h.keyboards).toEqual([kb]);
    expect(h.edits).toEqual([77]);
  });

  it("enters awaiting_setup for a valid registration when the owner has no categories, without persisting (D7)", async () => {
    await h.service.handleUpdate(textUpdate(), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenCalledWith({
      ownerId,
      state: "awaiting_setup",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.join("\n")).toContain("categorías");
  });

  it("creates the listed categories plus 'otro' from a newline-separated setup reply", async () => {
    h.mockSetState.mockClear();
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe\nTransporte", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Transporte");
    expect(h.mockEnsureOtro).toHaveBeenCalledWith(ownerId);
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toContain("Cafe");
  });

  it("accepts comma-separated setup replies", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe, Transporte", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Transporte");
    expect(h.mockEnsureOtro).toHaveBeenCalledWith(ownerId);
  });

  it("gates setup entries: 'Cafe, gastos fijos' creates Cafe and redirects the reserved gastos fijos", async () => {
    h.mockCreateCategory.mockImplementation(async (owner: string, name: string) => {
      if (name === "gastos fijos") {
        throw new ReservedCategoryError('Category "gastos fijos" is the reserved concept "gasto fijo"', "gasto fijo");
      }
      return { id: `cat-${name}`, ownerId: owner, name, createdAt: new Date() };
    });

    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe, gastos fijos", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "gastos fijos");
    // No category for the reserved name: only Cafe (plus otro via ensureOtro).
    expect(h.replies.at(-1)).toContain("Cafe");
    expect(h.replies.at(-1)).toContain("gastos fijos");
    expect(h.replies.at(-1)).toContain("previsto");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("dedupes setup names by normalized value", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe\ncafé", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledTimes(1);
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
  });

  it("re-asks and stays in awaiting_setup when the setup reply has no names", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    const before = h.replies.length;
    await h.service.handleUpdate(textUpdate({ text: "   ,  ", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_setup",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.length).toBeGreaterThan(before);
  });

  it("executes 'borrar categoria: no' through the service without creating a literal (batch command)", async () => {
    h.mockListCategories.mockResolvedValueOnce([]); // gate: no categories → setup
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    h.mockCreateCategory.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "borrar categoria: no", messageId: 2 }), h.reply);

    expect(h.mockDeleteCategory).toHaveBeenCalledWith(ownerId, "no");
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toContain("Borradas: no.");
  });

  it("executes a batch rename inside a mixed setup reply without creating a literal", async () => {
    h.mockListCategories.mockResolvedValueOnce([]); // gate: no categories → setup
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    h.mockRenameCategory.mockResolvedValue({
      id: "c1",
      ownerId,
      name: "Cafeteria",
      createdAt: new Date(),
    });
    h.mockCreateCategory.mockClear();

    await h.service.handleUpdate(
      textUpdate({ text: "Cafe\nrenombrar categoria: Cafe a: Cafeteria", messageId: 2 }),
      h.reply,
    );

    expect(h.mockRenameCategory).toHaveBeenCalledWith(ownerId, "Cafe", "Cafeteria");
    expect(h.replies.at(-1)).toContain('"Cafe" a "Cafeteria"');
    expect(h.replies.at(-1)).toContain("Cafe");
  });

  it("skips categories that already exist during setup (append semantics)", async () => {
    h.mockListCategories
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: [] },
      ]);
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe\nSalud", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledTimes(1);
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Salud");
    expect(h.mockEnsureOtro).toHaveBeenCalledWith(ownerId);
  });

  it("handles 'configurar categorias' by entering awaiting_setup without removing existing categories", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "configurar categorias", messageId: 1 }), h.reply);

    expect(h.mockSetState).toHaveBeenCalledWith({
      ownerId,
      state: "awaiting_setup",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toContain("categorías");

    await h.service.handleUpdate(textUpdate({ text: "Salud", messageId: 2 }), h.reply);
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Salud");
    expect(h.mockCreateCategory).not.toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("creates the movement with 'otro' and enters awaiting_category when nothing matches", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$2000 supermercado", messageId: 9 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "otro", type: "EXPENSE" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ supermercado",
    });
    expect(h.replies.at(-1)).toContain("supermercado");
  });

  it("answers a correction by reassigning the pending movement without learning keywords", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Transporte", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$1200 uber viaje", messageId: 9 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 10 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "Transporte" });
    expect(h.mockAssociateKeyword).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe('Listo, el movimiento quedó en "Transporte".');
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("an unknown single-word answer renders the category buttons and never auto-creates (D9)", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockCreateCategory.mockResolvedValue({
      id: "cat-Mascotas",
      ownerId,
      name: "Mascotas",
      createdAt: new Date(),
    });

    await h.service.handleUpdate(textUpdate({ text: "$8000 veterinaria", messageId: 9 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Mascotas", messageId: 10 }), h.reply);

    // The single-token auto-create is REMOVED (D9): no category is created,
    // the closed-set buttons render and the correction stays open.
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockAssociateKeyword).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
    const state = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(state.state).toBe("awaiting_category");
  });

  it("resolves a correction after a restart by reading the persisted state (restart survival)", async () => {
    h.mockSetState.mockClear();
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Transporte", createdAt: new Date(), keywords: [] },
    ]);
    // The process "restarts": only the persisted state remains.
    const botStateRepository = h.botStateRepository;
    await botStateRepository.set({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-9",
      pendingNote: "uber viaje",
    });

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 42 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-9", { category: "Transporte" });
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("records and creates a matched movement with the matched category, ignoring the brain suggestion", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockMatchNote.mockResolvedValue("Cafe");
    // The brain is invoked (intent-first) but a user-authored keyword rule
    // beats its category suggestion.
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2500,
      category: "Kiosco",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 11 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledWith("$2500 cafe");
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Cafe" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockCreateExpense).not.toHaveBeenCalledWith(
      expect.objectContaining({ category: "Kiosco" }),
      ownerId,
    );
    expect(h.replies.at(-1)).toContain("Cafe");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("replies with help for an unparseable message and creates nothing", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    await h.service.handleUpdate(textUpdate({ text: "hola" }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("No entendí");
  });

  it("ignores an unknown chat silently: no record, no movement, no reply, and the log line contains no chatId", async () => {
    await h.service.handleUpdate(textUpdate({ fromId: 987654321 }), h.reply);

    expect(h.mockRecord).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(0);
    const secretLog = h.mockLogger.mock.calls.find((call) => String(call[0]).includes("ignoring"));
    expect(secretLog).toBeTruthy();
    expect(String(secretLog?.[0])).not.toContain("987654321");
  });

  it("skips a duplicate message without replying", async () => {
    h.mockRecord.mockRejectedValue(uniqueViolation());

    await h.service.handleUpdate(textUpdate(), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(0);
  });

  it("tolerates a movement-creation failure by logging and continuing", async () => {
    h.mockCreateExpense.mockRejectedValue(new Error("db down"));
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await expect(h.service.handleUpdate(textUpdate(), h.reply)).resolves.toBeUndefined();
    expect(h.mockLogger).toHaveBeenCalled();
  });

  it("tolerates a reply failure by logging and continuing", async () => {
    const failingReply = async (): Promise<void> => {
      throw new Error("telegram api down");
    };

    await expect(h.service.handleUpdate(textUpdate({ text: "hola" }), failingReply)).resolves.toBeUndefined();
    expect(h.mockLogger).toHaveBeenCalled();
  });

  it("keeps processing subsequent messages after a reply failure", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    const failingReply = async (): Promise<void> => {
      throw new Error("telegram api down");
    };

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 1 }), failingReply);
    await h.service.handleUpdate(textUpdate({ text: "hola de nuevo", messageId: 2 }), h.reply);

    expect(h.replies.at(-1)).toContain("No entendí");
  });

  it("persists the INCOME classification with the fallback category", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "Recibí $50000 de sueldo", messageId: 12 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50000, category: "otro", type: "INCOME" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });
});

describe("TelegramService ambiguity rules (awaiting_category, D6)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
  });

  it('treats a lone "8000" as a NEW registration, not an answer, and warns about the abandoned correction', async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "8000", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, note: null, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-2)).toContain("corrección anterior");
    // Re-enters the correction loop with the NEW pending movement.
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "8000",
    });
  });

  it('a category named "500" beats an amount-shaped answer', async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "500", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "500", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "500" });
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("a multi-word category name is treated as the ANSWER", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Gastos fijos", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "Gastos fijos", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "Gastos fijos" });
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it('"$8000 super" during a correction is a NEW registration that re-enters the loop', async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "$8000 super", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, note: "$ super", category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-2)).toContain("corrección anterior");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ super",
    });
  });

  it('keeps the movement as "otro" and clears state when the user answers "no"', async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "no", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockAssociateKeyword).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, quedó en "otro".');
  });

  it.each(["otro", "dejalo", "dejá", "nada"])('keeps the movement as "otro" for the answer "%s"', async (answer) => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockUpdateMovement.mockClear();

    await h.service.handleUpdate(textUpdate({ text: answer, messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, quedó en "otro".');
  });

  it('a bare affirmation ("si") never auto-creates a category and keeps the dialog open (D6)', async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateCategory.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "si", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe('Dale, ¿a qué categoría lo asigno? Escribí el nombre o "no".');
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_category");
    expect(state?.pendingMovementId).toBe("mov-1");
  });

  it("a multi-word non-category answer presents the category buttons and keeps the state open (D9)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockSetState.mockClear();
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no se qué categoria", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb.flat().some((button) => button.callback_data.startsWith("cat:"))).toBe(true);
  });

  it("resolves a folded plural answer to the existing category without creating (cafes → Cafe)", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Cafe", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "cafes", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "Cafe" });
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, el movimiento quedó en "Cafe".');
  });

  it("a reserved single-token answer renders the buttons and keeps the correction open (D9)", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockCreateCategory.mockRejectedValue(
      new ReservedCategoryError('Category "previsto" is the reserved concept "previsto"', "previsto"),
    );

    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "previsto", messageId: 2 }), h.reply);

    // No creation attempt at all (the single-token path never reaches the
    // guarded service): the closed-set buttons render and the correction stays open.
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
  });

  it.each(["no.", "no,"])('keeps the movement as "otro" for the punctuated guard answer "%s" (no category created)', async (answer) => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateCategory.mockClear();
    h.mockUpdateMovement.mockClear();

    await h.service.handleUpdate(textUpdate({ text: answer, messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, quedó en "otro".');
  });

  it.each(["si.", "s\u00ed."])('a punctuated affirmation ("%s") never auto-creates a category and keeps the dialog open', async (answer) => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateCategory.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: answer, messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe('Dale, \u00bfa qu\u00e9 categor\u00eda lo asigno? Escrib\u00ed el nombre o "no".');
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_category");
  });

  it('a punctuation-only answer ("...") never auto-creates: it lists the categories and keeps the state open', async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateCategory.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "...", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain('No encontr\u00e9 la categor\u00eda');
  });
});

describe("TelegramService registration collection (awaiting_registration)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["otro"]);
  });

  async function seedAwaitingRegistration(payloadOverrides?: Record<string, unknown>): Promise<void> {
    const payload = registrationCollectPayloadSchema.parse({
      body: "quiero cargar un gasto",
      note: "gym",
      amount: null,
      category: null,
      ...payloadOverrides,
    });
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_registration",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
  }

  it("T1: an amount-null register_expense persists the collect payload and asks the amount (no free-text question)", async () => {
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: null,
      note: "gym",
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "quiero cargar un gasto", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_registration");
    expect(lastCall.pendingMovementId).toBeNull();
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.body).toBe("quiero cargar un gasto");
    expect(payload.note).toBe("gym");
    expect(payload.amount).toBeNull();
    expect(payload.category).toBeNull();
    expect(payload.shared).toBe(false);
    expect(payload.planned).toBe(false);
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "register_expense",
        ok: false,
        action: "asked_registration",
        asked_field: "amount",
      }),
    );
    expect(h.replies.at(-1)).toBe(askAmountReply("gym"));
    expect(h.replies.at(-1)).not.toContain("No entendí");
  });

  it("T1: the previsto: prefix persists the planned bit on an amount-null collect and asks the amount", async () => {
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: null,
      note: "gym",
    });

    await h.service.handleUpdate(textUpdate({ text: "previsto: gym", messageId: 1 }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.planned).toBe(true);
    expect(lastCall.state).toBe("awaiting_registration");
  });

  it("T2: a category-signal that resolves to nothing persists the amount and asks the category", async () => {
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2000,
      category: "Kiosco", // signaled but no such category exists
      note: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_registration");
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.amount).toBe(2000);
    expect(payload.category).toBeNull();
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "register_expense",
        ok: false,
        action: "asked_registration",
        asked_field: "category",
      }),
    );
    expect(h.replies.at(-1)).toContain("¿En qué categoría lo guardo");
  });

  it("T2/D8: a no-brain previsto: prefix without an amount enters the collect dialog", async () => {
    const hNoBrain = makeHarness({ noBrain: true });
    seedHarnessCategories(hNoBrain, ["otro"]);

    await hNoBrain.service.handleUpdate(
      textUpdate({ text: "previsto: alquiler", messageId: 1 }),
      hNoBrain.reply,
    );

    expect(hNoBrain.mockCreateExpense).not.toHaveBeenCalled();
    const lastCall = hNoBrain.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_registration");
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.amount).toBeNull();
    expect(payload.planned).toBe(true);
    expect(hNoBrain.replies.at(-1)).toBe(askAmountReply("alquiler"));
  });

  it("T2/D8: a no-brain compartido: prefix without an amount enters the collect dialog", async () => {
    const hNoBrain = makeHarness({ noBrain: true });
    seedHarnessCategories(hNoBrain, ["otro"]);

    await hNoBrain.service.handleUpdate(
      textUpdate({ text: "compartido: expensas", messageId: 1 }),
      hNoBrain.reply,
    );

    const lastCall = hNoBrain.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_registration");
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.shared).toBe(true);
    expect(payload.planned).toBe(false);
  });

  it("T2/D8: a no-brain bare noun keeps the help reply and starts no collect dialog", async () => {
    const hNoBrain = makeHarness({ noBrain: true });
    seedHarnessCategories(hNoBrain, ["otro"]);

    await hNoBrain.service.handleUpdate(textUpdate({ text: "gym", messageId: 1 }), hNoBrain.reply);

    expect(hNoBrain.mockCreateExpense).not.toHaveBeenCalled();
    expect(hNoBrain.mockSetState).not.toHaveBeenCalled();
    expect(hNoBrain.replies.at(-1)).toBe(helpReply());
  });

  it("2.5: routes a message in awaiting_registration into the dialog branch with a decoded context", async () => {
    await seedAwaitingRegistration({ amount: 5000 });
    h.mockBrainInterpret.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "recent",
      dialog_action: null,
    });
    h.mockListMovements.mockResolvedValue([]);

    await h.service.handleUpdate(textUpdate({ text: "decime los últimos movimientos", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledWith(
      "decime los últimos movimientos",
      expect.objectContaining({
        state: "awaiting_registration",
        pending: expect.objectContaining({ amount: 5000, note: "gym" }),
        openQuestion: expect.stringContaining("categoría"),
      }),
    );
// Non-consuming: the pending collect survives the query.
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_registration");
  });

  it("T4: an amount answer completes the registration from the stored context when the category is resolved", async () => {
    await seedAwaitingRegistration({ amount: null, category: "Gimnasio" });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
      dialog_action: "resolve",
    });
    h.mockBrainReply.mockResolvedValue("Listo, registré 5000 en Gimnasio.");

    await h.service.handleUpdate(textUpdate({ text: "5000", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "Gimnasio", note: "gym" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe("Listo, registré 5000 en Gimnasio.");
  });

  it("T4: an amount answer keeps collecting by persisting the amount and asking the category", async () => {
    await seedAwaitingRegistration({ amount: null, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
      dialog_action: "resolve",
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "5000", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_registration");
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.amount).toBe(5000);
    expect(payload.category).toBeNull();
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({ action: "asked_registration", asked_field: "category" }),
    );
    expect(h.replies.at(-1)).toBe(askCategoryReply("gym"));
  });

  it("T4/phantom: a resolve with no amount and no message amount re-asks the amount (T9), never fabricating", async () => {
    await seedAwaitingRegistration({ amount: null, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: null,
      note: null,
      dialog_action: "resolve",
    });
    h.mockBrainReply.mockResolvedValue(null);
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no sé", messageId: 2 }), h.reply);

expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(keptCollectingReply("amount"));
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_registration");
  });

  it("T5: an exact category answer completes the registration from the stored context", async () => {
    seedHarnessCategories(h, ["otro", "Transporte"]);
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "Transporte",
      note: null,
      dialog_action: "resolve",
    });
    h.mockBrainReply.mockResolvedValue("Listo, quedó en Transporte.");

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "Transporte", note: "gym" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe("Listo, quedó en Transporte.");
  });

  it("T5: a folded plural category answer resolves to the existing category without creating", async () => {
    seedHarnessCategories(h, ["otro", "Cafe"]);
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "cafes",
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "cafes", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "Cafe" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("T5: a single-token non-match shows the buttons and never auto-creates (D9)", async () => {
    seedHarnessCategories(h, ["otro"]);
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "Mascotas",
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "Mascotas", messageId: 2 }), h.reply);

    // The single-token auto-create is REMOVED from the collect cascade: no
    // category is created, the buttons render and the collect stays open.
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
  });

  it("T5: a reserved single-token answer shows the buttons and keeps the dialog open", async () => {
    seedHarnessCategories(h, ["otro"]);
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockCreateCategory.mockRejectedValue(
      new ReservedCategoryError('Category "previsto" is the reserved concept "previsto"', "previsto"),
    );
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "previsto",
      note: null,
      dialog_action: "resolve",
    });
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "previsto", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
  });

  it("T5: a multi-word non-match shows the buttons and stays open (never dead-ends)", async () => {
    seedHarnessCategories(h, ["otro", "Cafe"]);
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "no se que categoria",
      note: null,
      dialog_action: "resolve",
    });
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no se que categoria", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
  });

  it("T6: an explicit abandon clears the collect payload and registers nothing", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: null,
      note: null,
      dialog_action: "abandon",
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "no, dejalo", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe(collectAbandonedReply());
  });

  it("T6/D6: 'no, dejalo' abandons the collect through the deterministic path too", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "no, dejalo", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("T7: a query during the collect answers and keeps the pending payload intact", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockSetState.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "recent",
      dialog_action: null,
    });
    h.mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "Cafe",
        note: "cafe con leche",
        occurredAt: new Date("2026-09-17T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
      },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "decime los últimos movimientos", messageId: 2 }), h.reply);

    expect(h.mockListMovements).toHaveBeenCalledWith({ viewerId: ownerId, partnerId: null, visibility: "all" }, {});
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("cafe con leche");
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_registration");
  });

  it("T7: a CRUD during the collect executes and keeps the pending payload intact", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockSetState.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "Mascotas",
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "creá una categoría mascotas", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Mascotas");
    expect(h.mockSetState).not.toHaveBeenCalled();
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_registration");
  });

  it("T8: a new registration during the collect abandons it and registers the new message", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 8000,
      category: null,
      note: null,
      dialog_action: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "$8000 supermercado", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    // CR-5: exactly ONE merged reply carries the abandon fact + the outcome.
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toContain(collectAbandonedReply());
    expect(h.replies[0]).toContain(formatARS(8000));
  });

  it("T10: a corrupt collect payload abandons to idle with the dropped reply, registering nothing", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_registration",
      pendingMovementId: null,
      pendingNote: "{not-json",
    });
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "$3000 panaderia", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe(questionDroppedReply());
  });

  it("T11: the collect payload survives a restart and the dialog continues", async () => {
    // The process "restarts": a fresh service reads the persisted state.
    const restarted = makeHarness();
    seedHarnessCategories(restarted, ["otro", "Gimnasio"]);
    // The payload survives in the store (Postgres in production; here we seed
    // the fresh harness's repository with the same row).
    const payload = registrationCollectPayloadSchema.parse({
      body: "quiero cargar un gasto",
      note: "gym",
      amount: 5000,
      category: null,
    });
    await restarted.botStateRepository.set({
      ownerId,
      state: "awaiting_registration",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    restarted.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "Gimnasio",
      note: null,
      dialog_action: "resolve",
    });

    await restarted.service.handleUpdate(textUpdate({ text: "Gimnasio", messageId: 42 }), restarted.reply);

    expect(restarted.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "Gimnasio" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("intercept: a bare 'dale' during the collect re-asks the open field without calling the brain", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "dale", messageId: 2 }), h.reply);

expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(keptCollectingReply("category"));
  });

  it('a punctuated "no," during the collect abandons it (guard normalization: no category, nothing registers)', async () => {
    await seedAwaitingRegistration();
    h.mockCreateCategory.mockClear();
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no,", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe(collectAbandonedReply());
  });

  it('a punctuated "si." during the collect re-asks the open field without creating anything', async () => {
    await seedAwaitingRegistration();
    h.mockBrainInterpret.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "si.", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(keptCollectingReply("amount"));
  });

  it('a resolve answer with category "no," abandons the collect via the guarded set (never a category named "no")', async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "no,",
      note: null,
      dialog_action: "resolve",
    });
    h.mockCreateCategory.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no,", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe(collectAbandonedReply());
  });

  it('a resolve answer with category "si." re-asks the open field (single-token guard reject, never auto-created)', async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "si.",
      note: null,
      dialog_action: "resolve",
    });
    h.mockCreateCategory.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "si.", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(keptCollectingReply("category"));
  });

  it("2.5: a corrupt collect payload yields a null context so the D6 fallback owns the message", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_registration",
      pendingMovementId: null,
      pendingNote: "{not-json",
    });
    h.mockBrainInterpret.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "$3000 panaderia", messageId: 2 }), h.reply);

    // No context can be built from a corrupt payload: the brain is never
    // called for the dialog and the deterministic rules own the message.
    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
  });
});

describe("TelegramService commands", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("creates a category via 'registrar categoria: X'", async () => {
    await h.service.handleUpdate(textUpdate({ text: "registrar categoria: Salud", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Salud");
    expect(h.replies.at(-1)).toContain("Salud");
  });

  it("redirects a reserved 'registrar categoria: previsto' with the previsto teaching and creates nothing", async () => {
    h.mockCreateCategory.mockRejectedValue(
      new ReservedCategoryError('Category "previsto" is the reserved concept "previsto"', "previsto"),
    );

    await h.service.handleUpdate(textUpdate({ text: "registrar categoria: previsto", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "previsto");
    expect(h.replies.at(-1)).toBe(reservedCategoryReply("previsto", "previsto"));
    expect(h.replies.at(-1)).toContain("previsto: <monto> <nota>");
  });

  it.each([
    ["gasto provisorio", "previsto"],
    ["provisorios", "previsto"],
  ])("redirects the provisorio alias 'registrar categoria: %s' with the previsto teaching and creates nothing", async (name, concept) => {
    h.mockCreateCategory.mockRejectedValue(
      new ReservedCategoryError(`Category "${name}" is the reserved concept "${concept}"`, concept as "previsto"),
    );

    await h.service.handleUpdate(textUpdate({ text: `registrar categoria: ${name}`, messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, name);
    expect(h.replies.at(-1)).toBe(reservedCategoryReply(name, concept as "previsto"));
    expect(h.replies.at(-1)).toContain("previsto: <monto> <nota>");
  });

  it("creates 'un otro gasto' through the command path (real concept words inside names stay creatable)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "registrar categoria: un otro gasto", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "un otro gasto");
    expect(h.replies.at(-1)).toContain("un otro gasto");
  });

  it("redirects a reserved 'renombrar categoria: X a: ahorros' with the ahorro teaching", async () => {
    h.mockRenameCategory.mockRejectedValue(
      new ReservedCategoryError('Category "ahorros" is the reserved concept "ahorro"', "ahorro"),
    );

    await h.service.handleUpdate(
      textUpdate({ text: "renombrar categoria: Guardado a: ahorros", messageId: 1 }),
      h.reply,
    );

    expect(h.mockRenameCategory).toHaveBeenCalledWith(ownerId, "Guardado", "ahorros");
    expect(h.replies.at(-1)).toBe(reservedCategoryReply("ahorros", "ahorro"));
    expect(h.replies.at(-1)).toContain("registrar ahorro");
  });

  it("renames a category via 'renombrar categoria: X a: Y'", async () => {
    h.mockRenameCategory.mockResolvedValue({
      id: "c1",
      ownerId,
      name: "Cafeteria",
      createdAt: new Date(),
    });

    await h.service.handleUpdate(
      textUpdate({ text: "renombrar categoria: Cafe a: Cafeteria", messageId: 1 }),
      h.reply,
    );

    expect(h.mockRenameCategory).toHaveBeenCalledWith(ownerId, "Cafe", "Cafeteria");
    expect(h.replies.at(-1)).toContain("Cafeteria");
  });

  it("associates a keyword via 'asociar palabra: P a categoria: X'", async () => {
    await h.service.handleUpdate(
      textUpdate({ text: "asociar palabra: uber a categoria: Transporte", messageId: 1 }),
      h.reply,
    );

    expect(h.mockAssociateKeyword).toHaveBeenCalledWith(ownerId, "uber", "Transporte");
    expect(h.replies.at(-1)).toContain("uber");
  });

  it("lists categories via 'listar categorias'", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: ["cafe"] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toContain("Cafe");
  });

  it("lists an empty category set via 'listar categorias'", async () => {
    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe("No hay categorías.");
  });

  it("processes commands during awaiting_category without consuming the pending correction", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ anterior",
    });
  });

  it("falls through to registration for unrecognized text (not a command)", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    await h.service.handleUpdate(textUpdate({ text: "$2000 supermercado", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalled();
  });
});

describe("TelegramService brain orchestration (llm-conversational-bot)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  function seedConfirmation(overrides?: {
    amounts?: [number, number];
    category?: string | null;
    note?: string | null;
  }): void {
    const payload = amountConfirmationPayloadSchema.parse({
      body: "gaste 4800 en el kiosco",
      note: overrides?.note ?? "gaste en el kiosco",
      amounts: overrides?.amounts ?? [4800, 5000],
      category: overrides?.category ?? null,
    });
    h.botStateRepository.set({
      ownerId,
      state: "awaiting_amount_confirmation",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
  }

  it("registers a keyword-miss with a resolvable brain category using the owner's spelling", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Supermercado", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2000,
      category: "supermercado",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "Supermercado" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    // No correction round-trip: the state goes straight to idle.
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toContain("Supermercado");
  });

  it("enters the collect dialog when a signaled category resolves to nothing, never auto-creating it (E2)", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2000,
      category: "Kiosco",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "$2000 chucherias", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_registration");
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.amount).toBe(2000);
    expect(payload.category).toBeNull();
    expect(h.replies.at(-1)).toContain("¿En qué categoría lo guardo");
  });

  it("treats a brain suggestion of 'otro' as no suggestion and offers the correction", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2000,
      category: "otro",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ feria",
    });
  });

  it("folds a plural brain suggestion to the owner category ('cafes' resolves to 'Cafe')", async () => {
    seedHarnessCategories(h, ["Cafe", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2000,
      category: "cafes",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    // B2 folded resolution: "cafes" folds to the owner "Cafe" and registers
    // there — no collect dialog, no phantom category, no correction round-trip.
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "Cafe" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("never materializes PENDING from the brain without the prefix (D7: brain never decides the type)", async () => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2500,
      category: "Vivienda",
      note: "alquiler",
    });

    await h.service.handleUpdate(
      textUpdate({ text: "dejalo para el mes que viene: 2500 alquiler", messageId: 1 }),
      h.reply,
    );

    // A future-expense phrasing WITHOUT the previsto: prefix registers as a
    // REAL expense — PENDING results only from the prefix or the Previsto
    // button (spec telegram-bot "Brain never decides the planned type").
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Vivienda", type: "EXPENSE" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockCreateExpense).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "PENDING" }),
      ownerId,
      expect.anything(),
    );
  });

  it("lets the previsto: prefix beat a brain planned:false flag", async () => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2500,
      category: "Vivienda",
      note: "alquiler",
      planned: false,
    });

    await h.service.handleUpdate(textUpdate({ text: "previsto: 2500 alquiler", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Vivienda", type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("falls back to today's otro path on a keyword miss when the brain returns null", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ feria",
    });
  });

  it("behaves exactly as today when the brain returns null, without any reply call", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockBrainReply).not.toHaveBeenCalled();
  });

  it("rescues an unparseable amount and registers with the resolved category", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Supermercado", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: "Supermercado",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "compre mercaderia", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, note: "compre mercaderia", category: "Supermercado" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("rescues an unparseable amount and registers in otro with the correction offer", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "compre mercaderia", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, note: "compre mercaderia", category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "compre mercaderia",
    });
  });

  it.each(["gaste cinco mil pesos", "1234,50 cafe"])(
    "replies with help and creates nothing when the interpret returns null for %s",
    async (body) => {
      h.mockListCategories.mockResolvedValue([
        { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      ]);
      h.mockBrainInterpret.mockResolvedValue(null);

      await h.service.handleUpdate(textUpdate({ text: body, messageId: 1 }), h.reply);

      expect(h.mockCreateExpense).not.toHaveBeenCalled();
      expect(h.replies.at(-1)).toContain("No entendí");
    },
  );

  it("asks the owner on a genuine amount conflict and persists the confirmation payload", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "gaste 4800 en el kiosco", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_amount_confirmation");
    expect(lastCall.pendingMovementId).toBeNull();
    const payload = JSON.parse(String(lastCall.pendingNote)) as {
      amounts: number[];
      body: string;
      note: string | null;
      category: string | null;
    };
    expect(payload.amounts).toEqual([4800, 5000]);
    expect(payload.body).toBe("gaste 4800 en el kiosco");
    expect(payload.note).toBe("gaste en el kiosco");
    expect(payload.category).toBeNull();
    const reply = h.replies.at(-1) ?? "";
    expect(reply).toContain(formatARS(4800));
    expect(reply).toContain(formatARS(5000));
  });

  it('registers the brain amount directly for a "5 mil" stance message with no conflict question', async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "gaste 5 mil en el super", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    // Registered directly: the conflict question and its state never fire.
    expect(h.mockSetState).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "awaiting_category" }),
    );
    expect(h.replies.at(-1)).toContain(formatARS(5000));
    expect(h.replies.at(-1)).not.toContain("no me queda claro");
  });

  it("registers the chosen amount from the stored context on a matching answer", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Supermercado", createdAt: new Date(), keywords: [] },
    ]);
    seedConfirmation({ category: "Supermercado" });

    await h.service.handleUpdate(textUpdate({ text: "5000", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        note: "gaste en el kiosco",
        category: "Supermercado",
        type: "EXPENSE",
      }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("registers the chosen amount in otro and offers correction when the stored category is null", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    seedConfirmation();

    await h.service.handleUpdate(textUpdate({ text: "5000", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "gaste en el kiosco",
    });
  });

  it("abandons the confirmation on a non-matching reply and processes the text as a new registration", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    seedConfirmation();

    await h.service.handleUpdate(textUpdate({ text: "6000", messageId: 2 }), h.reply);

    // Nothing registers from the conflicting message; the new text registers 6000.
    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 6000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-2)).toContain("monto");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "6000",
    });
  });

  it("resolves a confirmation after a restart from a payload built through the schema", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Transporte", createdAt: new Date(), keywords: [] },
    ]);
    const payload = amountConfirmationPayloadSchema.parse({
      body: "gaste 4800 en taxi",
      note: "gaste en taxi",
      amounts: [4800, 5000],
      category: "Transporte",
    });
    h.botStateRepository.set({
      ownerId,
      state: "awaiting_amount_confirmation",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "5 mil", messageId: 42 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "Transporte" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("recovers from a corrupted confirmation payload by abandoning and reprocessing the text", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.botStateRepository.set({
      ownerId,
      state: "awaiting_amount_confirmation",
      pendingMovementId: null,
      pendingNote: "{not-json",
    });

    await h.service.handleUpdate(textUpdate({ text: "$3000 panaderia", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-2)).toContain("monto");
  });

  it("keeps the confirmation question open when movement creation fails", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    seedConfirmation();
    h.mockSetState.mockClear();
    h.mockCreateExpense.mockRejectedValue(new Error("db down"));

    await h.service.handleUpdate(textUpdate({ text: "5000", messageId: 2 }), h.reply);

    expect(h.mockLogger).toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
  });

  it("processes commands during a confirmation without consuming it", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    seedConfirmation();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("otro");
  });

  it("runs the registration flow for a register_expense envelope and sends the brain reply verbatim", async () => {
    seedHarnessCategories(h, ["Supermercado", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: "Supermercado",
      note: null,
    });
    h.mockBrainReply.mockResolvedValue("Listo, quedó registrado 5000 en Supermercado.");

    await h.service.handleUpdate(textUpdate({ text: "compre mercaderia", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "Supermercado", note: "compre mercaderia" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockBrainReply).toHaveBeenCalledWith({
      intent: "register_expense",
      ok: true,
      action: "registered",
      amount: 5000,
      category: "Supermercado",
      note: "compre mercaderia",
    });
    expect(h.replies.at(-1)).toBe("Listo, quedó registrado 5000 en Supermercado.");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("sends the fixed success template carrying the same facts when the brain reply is null", async () => {
    seedHarnessCategories(h, ["Supermercado", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: "Supermercado",
      note: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "compre mercaderia", messageId: 1 }), h.reply);

    expect(h.mockBrainReply).toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain(formatARS(5000));
    expect(h.replies.at(-1)).toContain("compre mercaderia");
    expect(h.replies.at(-1)).toContain("Supermercado");
  });

  it("answers a query_balance intent with the real balance and sends the brain reply verbatim", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockGetSummary.mockResolvedValue({
      kpis: {
        income: 3000,
        expenses: 1000,
        balance: 2000,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 1000,
        count: 3,
        countThisMonth: 1,
      },
      mom: { months: [{ month: "2026-09", income: 1000, expenses: 500, balance: 500 }] },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
      planned: { month: "2026-09", total: 0 },
    });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_balance",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });
    h.mockBrainReply.mockResolvedValue("Tu balance es $ 2.000,00.");

    await h.service.handleUpdate(textUpdate({ text: "cuánto me queda?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.mockGetSummary).toHaveBeenCalledWith({ viewerId: ownerId, partnerId: null, visibility: "all" });
    expect(h.mockBrainReply).toHaveBeenCalledWith({
      intent: "query_balance",
      ok: true,
      action: "answered",
      amount: null,
      category: null,
      note: null,
      query_type: "balance",
      query: { query_type: "balance", balance: 2000, income: 3000, expenses: 1000 },
    });
    expect(h.replies.at(-1)).toBe("Tu balance es $ 2.000,00.");
  });

  it("answers a query_month intent with the real data and the fixed template when the brain reply is null", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockGetSummary.mockResolvedValue({
      kpis: {
        income: 5000,
        expenses: 2000,
        balance: 3000,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 1500,
        count: 5,
        countThisMonth: 3,
      },
      mom: {
        months: [
          { month: "2026-08", income: 2000, expenses: 1000, balance: 1000 },
          { month: "2026-09", income: 3000, expenses: 2000, balance: 1000 },
        ],
      },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
      planned: { month: "2026-09", total: 0 },
    });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_month",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "cuánto gasté este mes?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockBrainReply).toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain(formatARS(2000));
    expect(h.replies.at(-1)).not.toBe(queryRedirectReply());
  });

  it("answers a query/categories intent by listing the owner categories through the brain", async () => {
    seedHarnessCategories(h, ["Cafe", "Transporte", "otro"]);
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: ["cafe"] },
      { id: "c2", ownerId, name: "Transporte", createdAt: new Date(), keywords: [] },
      { id: "c3", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "categories",
    });
    h.mockBrainReply.mockResolvedValue("Tenés Cafe y Transporte.");

    await h.service.handleUpdate(textUpdate({ text: "cuales son las categorias disponibles?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockListCategories).toHaveBeenCalledWith(ownerId);
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "query",
        ok: true,
        action: "answered",
        query_type: "categories",
        query: {
          query_type: "categories",
          categories: [
            { name: "Cafe", keywords: ["cafe"] },
            { name: "Transporte", keywords: [] },
            { name: "otro", keywords: [] },
          ],
        },
      }),
    );
    expect(h.replies.at(-1)).toBe("Tenés Cafe y Transporte.");
  });

  it("answers a query/categories intent with the fixed template when the brain reply is null", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "categories",
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "que categorias tengo?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("otro");
  });

  it("answers a query_recent intent with the most recent movements", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "Cafe",
        note: "cafe con leche",
        occurredAt: new Date("2026-09-17T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
      },
      {
        id: "m2",
        ownerId,
        amount: 50000,
        currency: "ARS",
        category: null,
        note: null,
        occurredAt: new Date("2026-09-16T12:00:00.000Z"),
        createdAt: new Date(),
        type: "INCOME",
      },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_recent",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });
    h.mockBrainReply.mockResolvedValue("Tus últimos movimientos: gastaste 2500 en Cafe.");

    await h.service.handleUpdate(textUpdate({ text: "ultimos movimientos", messageId: 1 }), h.reply);

    expect(h.mockListMovements).toHaveBeenCalledWith({ viewerId: ownerId, partnerId: null, visibility: "all" }, {});
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "query_recent",
        action: "answered",
        query_type: "recent",
        query: {
          query_type: "recent",
          movements: [
            { amount: 2500, category: "Cafe", note: "cafe con leche", date: "2026-09-17", type: "EXPENSE" },
            { amount: 50000, category: null, note: null, date: "2026-09-16", type: "INCOME" },
          ],
        },
      }),
    );
    expect(h.replies.at(-1)).toBe("Tus últimos movimientos: gastaste 2500 en Cafe.");
  });

  it("redirects a malformed query intent without a query_type instead of executing", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "quiero saber todo", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockListMovements).not.toHaveBeenCalled();
    expect(h.mockGetSummary).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(queryRedirectReply());
  });

  it("redirects honestly when the query executor fails", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockGetSummary.mockRejectedValue(new Error("db down"));
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_balance",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "cuánto me queda?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockLogger).toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(queryRedirectReply());
  });

  it("redirects an off_topic intent without creating a movement and never chats", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "off_topic",
      amount: null,
      category: null,
      note: null,
    });
    h.mockBrainReply.mockResolvedValue("Solo registro gastos: mandame un monto.");

    // Genuinely off-topic text: "hola" is now greeting-classified (3.4 flip).
    await h.service.handleUpdate(textUpdate({ text: "me contás un chiste?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe("Solo registro gastos: mandame un monto.");
    expect(h.replies.at(-1)).not.toContain("bien, gracias");
  });

  it("redirects an off_topic intent to the fixed expense-scoped fallback when the brain reply is null", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "off_topic",
      amount: null,
      category: null,
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "cuál es tu color favorito?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(offTopicRedirectReply());
  });

  it("greeting: a greeting intent in idle sends a warm expense-scoped greeting, creating nothing", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "greeting",
      amount: null,
      category: null,
      note: null,
    });
    h.mockBrainReply.mockResolvedValue("¡Hola! Mandame un gasto y lo cargo.");

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "greeting", ok: true, action: "none" }),
    );
    expect(h.replies.at(-1)).toBe("¡Hola! Mandame un gasto y lo cargo.");
  });

  it("greeting: the fixed fallback replies when the brain reply is null", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "greeting",
      amount: null,
      category: null,
      note: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe(greetingReply());
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
  });

  it("greeting: a greeting during an open dialog leaves the pending untouched", async () => {
    const payload = registrationCollectPayloadSchema.parse({
      body: "quiero cargar un gasto",
      note: "gym",
      amount: 5000,
      category: null,
    });
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_registration",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "greeting",
      amount: null,
      category: null,
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_registration");
    expect(h.replies.at(-1)).toBe(greetingReply());
  });

  it("redirects associate_keyword to the explicit command", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "associate_keyword",
      amount: null,
      category: null,
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "de ahora en más uber va a transporte", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(associateKeywordRedirectReply());
  });

  it("replies with help for help and reserved correct_* intents in idle", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "help",
      amount: null,
      category: null,
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "qué puedo hacer?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(helpReply());

    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_amount",
      amount: 5000,
      category: null,
      note: null,
    });
    await h.service.handleUpdate(textUpdate({ text: "5000", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(helpReply());
  });

  it("uses the deterministic note when both the parser and the brain provide one", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2500,
      category: null,
      note: "cafe con leche",
    });

    await h.service.handleUpdate(textUpdate({ text: "cafe 2500", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, note: "cafe" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("fills the note gap from the brain when the deterministic note is absent", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2500,
      category: null,
      note: "cafe",
    });

    await h.service.handleUpdate(textUpdate({ text: "2500", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, note: "cafe" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("routes a dialog answer through interpret with context and reassigns on resolve", async () => {
    seedHarnessCategories(h, ["otro", "Transporte"]);
    h.mockBrainReply.mockResolvedValue("Listo, el movimiento quedó en Transporte.");

    await h.service.handleUpdate(textUpdate({ text: "$1200 uber viaje", messageId: 1 }), h.reply);
    h.mockBrainInterpret.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: null,
      category: "Transporte",
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledWith(
      "Transporte",
      expect.objectContaining({ state: "awaiting_category", openQuestion: expect.stringContaining("uber viaje") }),
    );
    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "Transporte" });
    expect(h.mockBrainReply).toHaveBeenCalledWith({
      intent: "correct_category",
      ok: true,
      action: "registered",
      amount: null,
      category: "Transporte",
      note: "$ uber viaje",
    });
    expect(h.replies.at(-1)).toBe("Listo, el movimiento quedó en Transporte.");
  });

  it("routes an amount-confirmation answer through interpret and registers the chosen amount on resolve", async () => {
    seedHarnessCategories(h, ["otro"]);
    seedConfirmation();
    h.mockBrainInterpret.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
      dialog_action: "resolve",
    });
    h.mockBrainReply.mockResolvedValue("Listo, quedó registrado 5000.");

    await h.service.handleUpdate(textUpdate({ text: "5000", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledWith(
      "5000",
      expect.objectContaining({
        state: "awaiting_amount_confirmation",
        pending: expect.objectContaining({ amounts: [4800, 5000] }),
      }),
    );
    // The stored category is null, so the answer registers in "otro" and the
    // branch result reports the correction offer.
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "register_expense", action: "asked_category", amount: 5000 }),
    );
    expect(h.replies.at(-1)).toBe("Listo, quedó registrado 5000.");
  });

  it("never calls the brain reply for commands", async () => {
    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 1 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockBrainReply).not.toHaveBeenCalled();
  });

  it("creates a category through the create_category intent and sends the brain reply verbatim", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "Mascotas",
      note: null,
    });
    h.mockBrainReply.mockResolvedValue("Listo, creé la categoría Mascotas.");

    await h.service.handleUpdate(textUpdate({ text: "creá una categoria llamada mascotas", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Mascotas");
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "create_category",
        ok: true,
        action: "created",
        category: "Mascotas",
      }),
    );
    expect(h.replies.at(-1)).toBe("Listo, creé la categoría Mascotas.");
  });

  it("creates a category and falls back to the fixed template when the brain reply is null", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "Mascotas",
      note: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "creá una categoria llamada mascotas", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Mascotas");
    expect(h.replies.at(-1)).toBe('Categoría "Mascotas" creada.');
  });

  it("replies with the duplicate template when create_category collides with an existing name", async () => {
    seedHarnessCategories(h, ["Mascotas", "otro"]);
    h.mockCreateCategory.mockRejectedValue(new ValidationFailedError('Category "Mascotas" already exists'));
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "Mascotas",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "creá la categoria mascotas", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe('Ya existe una categoría "Mascotas".');
  });

  it("deletes a category through the delete_category intent and sends the brain reply verbatim", async () => {
    seedHarnessCategories(h, ["Viajes", "otro"]);
    h.mockDeleteCategory.mockResolvedValue({ id: "c-viajes", ownerId, name: "Viajes", createdAt: new Date() });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "delete_category",
      amount: null,
      category: "Viajes",
      note: null,
    });
    h.mockBrainReply.mockResolvedValue("Listo, borré Viajes.");

    await h.service.handleUpdate(textUpdate({ text: "borra la categoria viajes", messageId: 1 }), h.reply);

    expect(h.mockDeleteCategory).toHaveBeenCalledWith(ownerId, "Viajes");
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "delete_category", ok: true, action: "deleted", category: "Viajes" }),
    );
    expect(h.replies.at(-1)).toBe("Listo, borré Viajes.");
  });

  it("refuses to delete 'otro' through the bot with the fixed warning", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockDeleteCategory.mockRejectedValue(new ValidationFailedError('Cannot delete the "otro" fallback category'));
    h.mockBrainInterpret.mockResolvedValue({
      intent: "delete_category",
      amount: null,
      category: "otro",
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "borra la categoria otro", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toContain("otro");
    expect(h.replies.at(-1)).not.toBe('Categoría "otro" borrada.');
  });

  it("renames a category through the rename_category intent", async () => {
    seedHarnessCategories(h, ["Super", "otro"]);
    h.mockRenameCategory.mockResolvedValue({ id: "c-super", ownerId, name: "Supermercado", createdAt: new Date() });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "rename_category",
      amount: null,
      category: "Super",
      note: null,
      new_name: "Supermercado",
    });
    h.mockBrainReply.mockResolvedValue("Listo, ahora es Supermercado.");

    await h.service.handleUpdate(textUpdate({ text: "renombra super a supermercado", messageId: 1 }), h.reply);

    expect(h.mockRenameCategory).toHaveBeenCalledWith(ownerId, "Super", "Supermercado");
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "rename_category",
        ok: true,
        action: "renamed",
        category: "Super",
        new_name: "Supermercado",
      }),
    );
    expect(h.replies.at(-1)).toBe("Listo, ahora es Supermercado.");
  });

  it("replies with the missing-category template when rename targets an unknown category", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockRenameCategory.mockResolvedValue(null);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "rename_category",
      amount: null,
      category: "Fantasma",
      note: null,
      new_name: "Fantasmas",
    });

    await h.service.handleUpdate(textUpdate({ text: "renombra fantasma a fantasmas", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe('No existe la categoría "Fantasma".');
  });

  it("answers a capabilities intent with the fixed summary and never with 'No se ejecutó nada'", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "capabilities",
      amount: null,
      category: null,
      note: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "podes borrar categorias?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("borrar");
    expect(h.replies.at(-1)).not.toContain("No se ejecutó nada");
  });

  it("sends the brain reply verbatim for a capabilities intent", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "capabilities",
      amount: null,
      category: null,
      note: null,
    });
    h.mockBrainReply.mockResolvedValue("Sí, puedo crear, borrar y renombrar categorías.");

    await h.service.handleUpdate(textUpdate({ text: "qué podés hacer?", messageId: 1 }), h.reply);

    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "capabilities", ok: true, action: "capabilities" }),
    );
    expect(h.replies.at(-1)).toBe("Sí, puedo crear, borrar y renombrar categorías.");
  });
});

describe("TelegramService dialog controller (brain-routed)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Transporte", createdAt: new Date(), keywords: [] },
    ]);
  });

  async function seedAwaitingCategory(pendingMovementId: string | null, note = "uber viaje"): Promise<void> {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_category",
      pendingMovementId,
      pendingNote: note,
    });
  }

  async function seedAwaitingRegistration(payloadOverrides?: Record<string, unknown>): Promise<void> {
    const payload = registrationCollectPayloadSchema.parse({
      body: "quiero cargar un gasto",
      note: "gym",
      amount: null,
      category: null,
      ...payloadOverrides,
    });
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_registration",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
  }

  it("collection: a resolve answer with the category completes from the stored context (single interpret call)", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "Transporte",
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, category: "Transporte", note: "gym" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("collection: an explicit abandon clears the collect and registers nothing", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: null,
      note: null,
      dialog_action: "abandon",
    });

    await h.service.handleUpdate(textUpdate({ text: "no, dejalo", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("collection: phantom guard keeps the dialog open and re-asks on a wrong-field resolve", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: null,
      category: "no se",
      note: null,
      dialog_action: "resolve",
    });
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no se", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_registration");
  });

  it("collection: a query during the collect answers without consuming the pending", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockSetState.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "recent",
      dialog_action: null,
    });
    h.mockListMovements.mockResolvedValue([]);

    await h.service.handleUpdate(textUpdate({ text: "decime los últimos movimientos", messageId: 2 }), h.reply);

    expect(h.mockSetState).not.toHaveBeenCalled();
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_registration");
  });

  it("collection: a new registration during the collect abandons it with a single interpret call", async () => {
    await seedAwaitingRegistration({ amount: 5000, category: null });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 8000,
      category: null,
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "$8000 supermercado", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledTimes(1);
    // CR-5: exactly ONE merged reply carries the abandon fact + the outcome.
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toContain(collectAbandonedReply());
    expect(h.replies[0]).toContain(formatARS(8000));
  });

  it("reassigns the pending movement on a resolve answer with an exact category", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: null,
      category: "Transporte",
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-9", { category: "Transporte" });
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, el movimiento quedó en "Transporte".');
  });

  it('a resolve answer with category "no." keeps the movement in "otro" (guard normalization, no category created)', async () => {
    await seedAwaitingCategory("mov-9");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: null,
      category: "no.",
      note: null,
      dialog_action: "resolve",
    });
    h.mockCreateCategory.mockClear();
    h.mockUpdateMovement.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no.", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, quedó en "otro".');
  });

  it('a resolve answer with category "si." re-asks the target category (single-token guard reject, never auto-created)', async () => {
    await seedAwaitingCategory("mov-9");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: null,
      category: "si.",
      note: null,
      dialog_action: "resolve",
    });
    h.mockCreateCategory.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "si.", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe('Dale, ¿a qué categoría lo asigno? Escribí el nombre o "no".');
  });

  it("routes an explicit abandon to today's D6 rules verbatim", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: null,
      category: null,
      note: null,
      dialog_action: "abandon",
    });

    await h.service.handleUpdate(textUpdate({ text: "no", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, quedó en "otro".');
  });

  it("keeps the awaiting_category dialog open and asks for the target category on a bare affirmation", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockBrainInterpret.mockClear();
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "si", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    // The dialog stays open: no state transition, the pending movement survives.
    expect(h.mockSetState).not.toHaveBeenCalled();
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_category");
    expect(state?.pendingMovementId).toBe("mov-9");
    expect(h.replies.at(-1)).toBe('Dale, ¿a qué categoría lo asigno? Escribí el nombre o "no".');
  });

  it("keeps the dialog open for accented and 'dale' affirmations", async () => {
    await seedAwaitingCategory("mov-9");

    await h.service.handleUpdate(textUpdate({ text: "sí", messageId: 2 }), h.reply);
    expect(h.replies.at(-1)).toBe('Dale, ¿a qué categoría lo asigno? Escribí el nombre o "no".');

    await h.service.handleUpdate(textUpdate({ text: "dale", messageId: 3 }), h.reply);
    expect(h.replies.at(-1)).toBe('Dale, ¿a qué categoría lo asigno? Escribí el nombre o "no".');

    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_category");
    expect(state?.pendingMovementId).toBe("mov-9");
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
  });

  it("answers a query during a dialog without consuming the pending", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockSetState.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "recent",
      dialog_action: null,
    });
    h.mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "Cafe",
        note: "cafe con leche",
        occurredAt: new Date("2026-09-17T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
      },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "decime los últimos movimientos", messageId: 2 }), h.reply);

    expect(h.mockListMovements).toHaveBeenCalledWith({ viewerId: ownerId, partnerId: null, visibility: "all" }, {});
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("cafe con leche");
  });

  it("creates a category during a dialog without consuming the pending", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockSetState.mockClear();
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "Mascotas",
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "creá una categoría mascotas", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Mascotas");
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_category");
    expect(state?.pendingMovementId).toBe("mov-9");
  });

  it("registers a new message during a dialog with a single interpret call", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 8000,
      category: null,
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "$8000 supermercado", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    // CR-5: exactly ONE merged reply carries the abandon fact + the outcome.
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toContain("corrección anterior");
    expect(h.replies[0]).toContain(formatARS(8000));
    // The pending correction was abandoned; the new movement re-enters the loop.
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ supermercado",
    });
  });

  it("creates and reassigns in one reply when create_category carries then_reassign", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
      then_reassign: true,
    });

    await h.service.handleUpdate(textUpdate({ text: "creá gastos hormiga y guardalo ahí", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "gastos hormiga");
    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-9", { category: "gastos hormiga" });
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "create_category", ok: true, action: "created_reassigned" }),
    );
    expect(h.replies).toHaveLength(1);
  });

  it("ignores then_reassign when no pending movement exists", async () => {
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
      then_reassign: true,
    });

    await h.service.handleUpdate(textUpdate({ text: "creá gastos hormiga y guardalo ahí", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "gastos hormiga");
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
  });

  it("gates then_reassign on a reserved create: redirect reply, no category, no reassignment, dialog stays open", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockCreateCategory.mockRejectedValue(
      new ReservedCategoryError('Category "gastos fijos" is the reserved concept "gasto fijo"', "gasto fijo"),
    );
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "gastos fijos",
      note: null,
      dialog_action: null,
      then_reassign: true,
    });

    await h.service.handleUpdate(textUpdate({ text: "creá gastos fijos y guardalo ahí", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "gastos fijos");
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(reservedCategoryReply("gastos fijos", "gasto fijo"));
    expect(h.replies.at(-1)).toContain("previsto");
    // The pending correction stays open: state is untouched.
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_category");
    expect(state?.pendingMovementId).toBe("mov-9");
  });

  it("replies with both the created and the missing-movement notices when the reassign fails", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "create_category",
      amount: null,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
      then_reassign: true,
    });
    h.mockUpdateMovement.mockRejectedValue(new NotFoundError("Movement mov-9 not found"));

    await h.service.handleUpdate(textUpdate({ text: "creá gastos hormiga y guardalo ahí", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "gastos hormiga");
    expect(h.replies.at(-2)).toBe('Categoría "gastos hormiga" creada.');
    expect(h.replies.at(-1)).toBe("Ese movimiento ya no existe.");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("phantom: a bare affirmation classified resolve registers nothing and is not reprocessed", async () => {
    const payload = amountConfirmationPayloadSchema.parse({
      body: "gaste 4800 en el kiosco",
      note: "gaste en el kiosco",
      amounts: [4800, 5000],
      category: null,
    });
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_amount_confirmation",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "si", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockBrainInterpret).toHaveBeenCalledTimes(1);
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toContain("pregunta");
  });

  it("phantom: a resolve with a missing pending movement drops the question", async () => {
    await seedAwaitingCategory(null);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: null,
      category: "Transporte",
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("pregunta");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("phantom: a resolve with a corrupt amount-confirmation payload degrades to the D6 abandon path", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_amount_confirmation",
      pendingMovementId: null,
      pendingNote: "{not-json",
    });
    h.mockBrainInterpret.mockResolvedValue(null);
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$3000 panaderia", messageId: 2 }), h.reply);

    // No context can be built from a corrupt payload: the brain is never called
    // for the dialog and today's abandon-and-reprocess rules own the message.
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("phantom: never reads envelope.amount when the reply matches no payload amount", async () => {
    const payload = amountConfirmationPayloadSchema.parse({
      body: "gaste 4800 en el kiosco",
      note: "gaste en el kiosco",
      amounts: [4800, 5000],
      category: null,
    });
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_amount_confirmation",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "6000", messageId: 2 }), h.reply);

    // The envelope carries 5000, but the message says 6000: nothing registers.
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("pregunta");
  });

  it("resolves an amount confirmation with the chosen amount from the stored payload", async () => {
    const payload = amountConfirmationPayloadSchema.parse({
      body: "gaste 4800 en el kiosco",
      note: "gaste en el kiosco",
      amounts: [4800, 5000],
      category: "Supermercado",
    });
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_amount_confirmation",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
      dialog_action: "resolve",
    });

    await h.service.handleUpdate(textUpdate({ text: "5 mil", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, note: "gaste en el kiosco", category: "Supermercado" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("keeps the D6 fallback verbatim when the brain is null in a dialog", async () => {
    await seedAwaitingCategory("mov-9");
    h.mockSetState.mockClear();
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "no se qué categoria", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).toHaveBeenCalledWith(
      "no se qué categoria",
      expect.objectContaining({ state: "awaiting_category" }),
    );
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(categoryButtonsReply());
  });
});

describe("TelegramService movement selection (awaiting_movement_selection)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
  });

  const payload = {
    category: "gastos hormiga",
    candidates: [
      { id: "m1", amount: 2500, note: "super", date: "2026-09-19" },
      { id: "m2", amount: 2500, note: "uber", date: "2026-09-17" },
    ],
  };

  async function seedSelection(overrides?: { category?: string; candidates?: typeof payload.candidates }): Promise<void> {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: JSON.stringify({
        category: overrides?.category ?? payload.category,
        candidates: overrides?.candidates ?? payload.candidates,
      }),
    });
  }

  it("picks a candidate by number and reassigns it deterministically", async () => {
    await seedSelection();

    await h.service.handleUpdate(textUpdate({ text: "2", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "m2", { category: "gastos hormiga" });
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe('Listo, el movimiento quedó en "gastos hormiga".');
  });

  it("picks a candidate by normalized note containment", async () => {
    await seedSelection();

    await h.service.handleUpdate(textUpdate({ text: "uber", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "m2", { category: "gastos hormiga" });
  });

  it("picks a candidate by a unique amount", async () => {
    await seedSelection({
      candidates: [
        { id: "m1", amount: 2500, note: "super", date: "2026-09-19" },
        { id: "m2", amount: 900, note: "pan", date: "2026-09-17" },
      ],
    });

    await h.service.handleUpdate(textUpdate({ text: "900", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "m2", { category: "gastos hormiga" });
  });

  it("abandons a non-answer and processes the text normally, changing nothing", async () => {
    await seedSelection();
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "cualquier cosa", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toContain("corrección");
    expect(h.replies.at(-1)).toContain("No entendí");
  });

  it("drops a corrupt selection payload and processes the text normally", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: "{not-json",
    });
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toContain("pregunta");
  });

  it("replies with the missing-movement notice when the picked movement was deleted", async () => {
    await seedSelection();
    h.mockUpdateMovement.mockRejectedValue(new NotFoundError("Movement m2 not found"));

    await h.service.handleUpdate(textUpdate({ text: "2", messageId: 2 }), h.reply);

    expect(h.replies.at(-1)).toBe("Ese movimiento ya no existe.");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });
});

/** Movement fixture shape consumed by the lifecycle executor's listMovements. */
function lifecycleMovement(
  id: string,
  amount: number,
  note: string | null,
  occurredAt: Date,
  category: string,
  status: "PENDING" | "PAID" = "PAID",
  type: "EXPENSE" | "INCOME" | "SAVINGS" = "EXPENSE",
) {
  return {
    id,
    ownerId,
    amount,
    currency: "ARS",
    category,
    note,
    occurredAt,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type,
    status,
  };
}

describe("TelegramService movement lifecycle (mark_paid / delete_expense)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["otro"]);
  });

  it("routes mark_paid with a unique category match through markMovementPaid and replies with the fixed facts", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PENDING"),
    ]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "mark_paid", amount: null, category: "alquiler", note: null });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "el previsto de alquiler lo pagué", messageId: 1 }), h.reply);

    expect(h.mockMarkMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(markPaidReply(2500, "alquiler", "Alquiler"));
    // The executed lifecycle path writes NO state: the owner stays idle and no
    // dialog is entered (one reply, nothing pending).
    expect(h.mockSetState).not.toHaveBeenCalled();
  });

  it("routes mark_paid and sends the brain reply verbatim carrying the executed facts", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PENDING"),
    ]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "mark_paid", amount: null, category: "alquiler", note: null });
    h.mockBrainReply.mockResolvedValue("Listo, pagué el alquiler de 2500.");

    await h.service.handleUpdate(textUpdate({ text: "el previsto de alquiler lo pagué", messageId: 1 }), h.reply);

    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe("Listo, pagué el alquiler de 2500.");
    expect(h.mockBrainReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "mark_paid",
        ok: true,
        action: "marked_paid",
        amount: 2500,
        category: "Alquiler",
        note: "alquiler",
      }),
    );
  });

  it("routes delete_expense with no cues to the most-recent movement and OPENS THE GATE without deleting (D6)", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 900, "pan", new Date("2026-09-19T12:00:00.000Z"), "Panaderia", "PAID"),
      lifecycleMovement("m2", 2500, "alquiler", new Date("2026-09-10T12:00:00.000Z"), "Alquiler", "PAID"),
    ]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "delete_expense", amount: null, category: null, note: null });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "borra ese gasto", messageId: 1 }), h.reply);

    // Nothing is deleted yet: the confirmation gate opens with the target
    // persisted and the [❌ Cancelar] [🗑 Borrar] keyboard (spec
    // bot-expense-lifecycle "Delete by recency asks for confirmation first").
    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(deleteConfirmReply(900, "pan", "Panaderia"));
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb[0]?.[0]?.text).toBe("❌ Cancelar");
    expect(kb[0]?.[1]?.text).toBe("🗑 Borrar");
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_delete_confirmation");
    const payload = deleteConfirmPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.target.id).toBe("m1");
    expect(payload.target.amount).toBe(900);
  });

  it("replies already_paid when markMovementPaid 409s, changing nothing", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PENDING"),
    ]);
    h.mockMarkMovementPaid.mockRejectedValue(new ConflictError("Movement m1 is already PAID"));
    h.mockBrainInterpret.mockResolvedValue({ intent: "mark_paid", amount: null, category: "alquiler", note: null });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "el previsto de alquiler lo pagué", messageId: 1 }), h.reply);

    expect(h.mockMarkMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(h.replies.at(-1)).toBe(markPaidAlreadyReply());
  });

  it("replies nothing_pending when no PENDING and no paid fallback matches", async () => {
    h.mockListMovements.mockResolvedValue([]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "mark_paid", amount: null, category: null, note: null });

    await h.service.handleUpdate(textUpdate({ text: "ya lo pagué", messageId: 1 }), h.reply);

    expect(h.mockMarkMovementPaid).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(nothingPendingReply());
  });

  it("replies nothing_to_delete when no movement matches, deleting nothing", async () => {
    h.mockListMovements.mockResolvedValue([]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "delete_expense", amount: null, category: null, note: null });

    await h.service.handleUpdate(textUpdate({ text: "borra ese gasto", messageId: 1 }), h.reply);

    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(nothingToDeleteReply());
  });

  it("replies movement_missing when the referenced movement disappeared (404)", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PENDING"),
    ]);
    h.mockMarkMovementPaid.mockRejectedValue(new NotFoundError("Movement m1 not found"));
    h.mockBrainInterpret.mockResolvedValue({ intent: "mark_paid", amount: null, category: "alquiler", note: null });

    await h.service.handleUpdate(textUpdate({ text: "el previsto de alquiler lo pagué", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe(movementMissingReply());
  });

  it("asks with the fixed mark-paid question and persists the lifecycle payload on ambiguity", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PENDING"),
      lifecycleMovement("m2", 2500, "alquiler expensas", new Date("2026-09-17T12:00:00.000Z"), "Alquiler", "PENDING"),
    ]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "mark_paid", amount: null, category: "alquiler", note: null });

    await h.service.handleUpdate(textUpdate({ text: "el previsto de alquiler lo pagué", messageId: 1 }), h.reply);

    expect(h.mockMarkMovementPaid).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(
      markPaidAskReply([
        { amount: 2500, note: "alquiler", date: "2026-09-19" },
        { amount: 2500, note: "alquiler expensas", date: "2026-09-17" },
      ]),
    );
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_movement_selection");
    const payload = lifecycleSelectionPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.action).toBe("mark_paid");
    expect(payload.candidates).toHaveLength(2);
    expect(payload.candidates[0]?.id).toBe("m1");
  });

  it("asks with the fixed delete question and persists the lifecycle payload on ambiguity", async () => {
    h.mockListMovements.mockResolvedValue([
      lifecycleMovement("m1", 2500, "alquiler", new Date("2026-09-19T12:00:00.000Z"), "Alquiler", "PAID"),
      lifecycleMovement("m2", 2500, "alquiler expensas", new Date("2026-09-17T12:00:00.000Z"), "Alquiler", "PAID"),
    ]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "delete_expense", amount: null, category: "alquiler", note: null });

    await h.service.handleUpdate(textUpdate({ text: "borrá el de alquiler", messageId: 1 }), h.reply);

    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(
      deleteAskReply([
        { amount: 2500, note: "alquiler", date: "2026-09-19" },
        { amount: 2500, note: "alquiler expensas", date: "2026-09-17" },
      ]),
    );
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_movement_selection");
    const payload = lifecycleSelectionPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.action).toBe("delete_expense");
  });
});

describe("TelegramService movement lifecycle selection pick (awaiting_movement_selection)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["otro"]);
  });

  async function seedLifecycleSelection(
    action: "mark_paid" | "delete_expense",
    candidates: { id: string; amount: number; note: string | null; date: string }[],
  ): Promise<void> {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: JSON.stringify({ action, candidates }),
    });
  }

  it("picks a numbered candidate and marks it paid via markPaidById, replying once", async () => {
    await seedLifecycleSelection("mark_paid", [
      { id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" },
      { id: "m2", amount: 900, note: "gimnasio", date: "2026-09-17" },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "2", messageId: 2 }), h.reply);

    expect(h.mockMarkMovementPaid).toHaveBeenCalledWith(ownerId, "m2");
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe(markPaidReply(900, "gimnasio", null));
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("picks a candidate by note and marks it paid via markPaidById, replying once", async () => {
    await seedLifecycleSelection("mark_paid", [
      { id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" },
      { id: "m2", amount: 900, note: "gimnasio", date: "2026-09-17" },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "gimnasio", messageId: 2 }), h.reply);

    expect(h.mockMarkMovementPaid).toHaveBeenCalledWith(ownerId, "m2");
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe(markPaidReply(900, "gimnasio", null));
  });

  it("picks a delete candidate by number and OPENS THE GATE with that target (D6/D10)", async () => {
    await seedLifecycleSelection("delete_expense", [
      { id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" },
      { id: "m2", amount: 900, note: "gimnasio", date: "2026-09-17" },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "1", messageId: 2 }), h.reply);

    // The pick transitions to the confirmation gate: nothing is deleted yet.
    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe(deleteConfirmReply(2500, "alquiler", null));
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_delete_confirmation");
    const payload = deleteConfirmPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.target.id).toBe("m1");
  });

  it("maps a 409 from a lifecycle pick to the already-paid reply", async () => {
    await seedLifecycleSelection("mark_paid", [{ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" }]);
    h.mockMarkMovementPaid.mockRejectedValue(new ConflictError("Movement m1 is already PAID"));

    await h.service.handleUpdate(textUpdate({ text: "1", messageId: 2 }), h.reply);

    expect(h.mockMarkMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe(markPaidAlreadyReply());
  });

  it("maps a 404 from a lifecycle pick to the missing-movement reply", async () => {
    await seedLifecycleSelection("mark_paid", [{ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" }]);
    h.mockMarkMovementPaid.mockRejectedValue(new NotFoundError("Movement m1 not found"));

    await h.service.handleUpdate(textUpdate({ text: "1", messageId: 2 }), h.reply);

    expect(h.mockMarkMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe(movementMissingReply());
  });

  it("abandons a non-answer to a lifecycle ask without reprocessing the text", async () => {
    await seedLifecycleSelection("mark_paid", [{ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" }]);
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "ninguno", messageId: 2 }), h.reply);

    expect(h.mockMarkMovementPaid).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe(movementSelectionAbandonedReply());
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("drops an invalid lifecycle payload with the dropped reply", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: JSON.stringify({ action: "mark_paid" }),
    });
    h.mockBrainInterpret.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 2 }), h.reply);

    expect(h.mockMarkMovementPaid).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(questionDroppedReply());
  });
});

describe("TelegramService movement correction (correct_category)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
  });

  it("reassigns a unique movement from an idle correct_category envelope", async () => {
    h.mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "uber",
        occurredAt: new Date("2026-09-19T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
      },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: 2500,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "esos 2500 a gastos hormiga", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "gastos hormiga");
    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "m1", { category: "gastos hormiga" });
    expect(h.replies.at(-1)).toContain("gastos hormiga");
    expect(h.replies.at(-1)).toContain(formatARS(2500));
  });

  it("asks with a persisted selection question when the reference is ambiguous", async () => {
    const now = Date.now();
    h.mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "super",
        occurredAt: new Date(now - 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        type: "EXPENSE",
      },
      {
        id: "m2",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "uber",
        occurredAt: new Date(now - 6 * 60 * 60 * 1000),
        createdAt: new Date(),
        type: "EXPENSE",
      },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: 2500,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "esos 2500 a gastos hormiga", messageId: 1 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    const lastState = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastState.state).toBe("awaiting_movement_selection");
    expect(lastState.pendingMovementId).toBeNull();
    const stored = JSON.parse(String(lastState.pendingNote)) as {
      category: string;
      candidates: { id: string }[];
    };
    expect(stored.category).toBe("gastos hormiga");
    expect(stored.candidates.map((candidate) => candidate.id)).toEqual(["m1", "m2"]);
    expect(h.replies.at(-1)).toContain("¿Cuál de estos movimientos corrijo?");
    expect(h.replies.at(-1)).toContain("1)");
  });

  it("asks for a reference when the envelope carries no amount and no note", async () => {
    h.mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "super",
        occurredAt: new Date("2026-09-19T12:00:00.000Z"),
        createdAt: new Date(),
        type: "EXPENSE",
      },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: null,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "corregime eso", messageId: 1 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("¿Qué movimiento querés corregir?");
  });

  it("replies no_match for an empty window without changing state", async () => {
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: 2500,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "esos 2500 a gastos hormiga", messageId: 1 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("No encontré");
  });

  it("replies help when correct_category has no target category and never runs the matcher", async () => {
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: 2500,
      category: null,
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "corregime", messageId: 1 }), h.reply);

    expect(h.mockListMovements).not.toHaveBeenCalled();
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(helpReply());
  });

  it("a selection ask during a dialog supersedes the pending correction", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-9",
      pendingNote: "uber viaje",
    });
    h.mockSetState.mockClear();
    const now = Date.now();
    h.mockListMovements.mockResolvedValue([
      {
        id: "m1",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "super",
        occurredAt: new Date(now - 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        type: "EXPENSE",
      },
      {
        id: "m2",
        ownerId,
        amount: 2500,
        currency: "ARS",
        category: "otro",
        note: "uber",
        occurredAt: new Date(now - 6 * 60 * 60 * 1000),
        createdAt: new Date(),
        type: "EXPENSE",
      },
    ]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "correct_category",
      amount: 2500,
      category: "gastos hormiga",
      note: null,
      dialog_action: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "esos 2500 a gastos hormiga", messageId: 2 }), h.reply);

    const lastState = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastState.state).toBe("awaiting_movement_selection");
    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
  });
});

describe("TelegramService planned registration (previsto:)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("registers 'previsto: 2500 alquiler' as a PENDING EXPENSE deterministically (brain-absent)", async () => {
    seedHarnessCategories(h, ["otro"]);
    // matchNote returns null → the "otro" correction tail runs with planned.

    await h.service.handleUpdate(textUpdate({ text: "previsto: 2500 alquiler", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "otro", type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "alquiler",
    });
    expect(h.replies.at(-1)).toContain("previsto");
    expect(h.replies.at(-1)).toContain(formatARS(2500));
  });

  it("brain-absent path: a planned phrasing WITHOUT the prefix never becomes PENDING (prefix is the only producer)", async () => {
    const hNoBrain = makeHarness({ noBrain: true });
    seedHarnessCategories(hNoBrain, ["otro"]);
    hNoBrain.mockBrainInterpret.mockClear();

    await hNoBrain.service.handleUpdate(
      textUpdate({ text: "dejalo para el mes que viene: 2500 alquiler", messageId: 1 }),
      hNoBrain.reply,
    );

    expect(hNoBrain.mockBrainInterpret).not.toHaveBeenCalled();
    expect(hNoBrain.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, type: "EXPENSE" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    // Without the prefix there is no PENDING: the status key is absent.
    expect(hNoBrain.mockCreateExpense).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "PENDING" }),
      ownerId,
      expect.anything(),
    );
  });

  it("registers a matched-category previsto: with the planned confirmation reply", async () => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockMatchNote.mockResolvedValue("Vivienda");

    await h.service.handleUpdate(textUpdate({ text: "previsto: 2500 alquiler", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Vivienda", type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-1)).toContain("previsto");
    expect(h.replies.at(-1)).toContain(formatARS(2500));
    expect(h.replies.at(-1)).toContain("Vivienda");
    expect(h.mockSetState).toHaveBeenLastCalledWith({ ownerId, state: "idle", pendingMovementId: null, pendingNote: null });
  });

  it("registers a previsto: through the brain path as a PENDING EXPENSE", async () => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2500,
      category: "Vivienda",
      note: "alquiler",
    });

    await h.service.handleUpdate(textUpdate({ text: "previsto: 2500 alquiler", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Vivienda", type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-1)).toContain("previsto");
  });

  it.each([
    ["compartido: previsto: 2500 alquiler", "compartido first"],
    ["previsto: compartido: 2500 alquiler", "previsto first"],
  ])("rejects previsto: combined with compartido: with an individual-only redirect (%s)", async (text) => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockMatchNote.mockResolvedValue("Vivienda");

    await h.service.handleUpdate(textUpdate({ text, messageId: 1 }), h.reply);

    // Planned expenses are INDIVIDUAL by design: nothing is created, no dialog
    // starts, the state stays untouched and the educational redirect replies.
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(plannedSharedRejectedReply());
  });

  it("registers a compartido: prefix as SHARED (normal shared expenses keep working)", async () => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockMatchNote.mockResolvedValue("Vivienda");

    await h.service.handleUpdate(textUpdate({ text: "compartido: 2500 expensas", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Vivienda", type: "EXPENSE" }),
      ownerId,
      { visibility: "SHARED" },
    );
    expect(h.replies.at(-1)).not.toBe(plannedSharedRejectedReply());
  });

  it("forces INDIVIDUAL when a previsto: prefix leaks a shared signal (safety net)", async () => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 2500,
      category: "Vivienda",
      note: "alquiler",
      shared: true,
    });

    await h.service.handleUpdate(
      textUpdate({ text: "previsto: dejalo compartido 2500 alquiler", messageId: 1 }),
      h.reply,
    );

    // A leaked SHARED flag must never persist on a PENDING row: planned wins.
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Vivienda", type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("never applies a savings split to a previsto: registration (forced EXPENSE)", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockResolveSplit.mockResolvedValue({ kind: "split", percent: 10 });

    await h.service.handleUpdate(textUpdate({ text: "previsto: 1000 entrenuts", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, type: "EXPENSE", status: "PENDING" }),
      ownerId,
      expect.anything(),
    );
  });

  it("persists planned in the amount-confirmation payload and registers PENDING on resolution", async () => {
    seedHarnessCategories(h, ["Vivienda", "otro"]);
    h.mockBrainInterpret.mockImplementation(async (message: string) => {
      if (message === "2500") {
        // The owner picks the deterministic amount: a resolve envelope.
        return {
          intent: "register_expense",
          amount: 2500,
          category: "Vivienda",
          note: "alquiler",
          dialog_action: "resolve",
        };
      }
      return {
        intent: "register_expense",
        amount: 2600,
        category: "Vivienda",
        note: "alquiler",
      };
    });

    // Deterministic 2500 vs brain 2600 → amount-conflict question.
    await h.service.handleUpdate(textUpdate({ text: "previsto: 2500 alquiler", messageId: 1 }), h.reply);

    const stored = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(stored.state).toBe("awaiting_amount_confirmation");
    const payload = amountConfirmationPayloadSchema.parse(JSON.parse(stored.pendingNote ?? "{}"));
    expect(payload.planned).toBe(true);
    expect(payload.shared).toBe(false);

    // The owner picks the deterministic amount; the registration stays planned.
    h.mockCreateExpense.mockClear();
    await h.service.handleUpdate(textUpdate({ text: "2500", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Vivienda", type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-1)).toContain("previsto");
  });
});

describe("TelegramService planned query (query_planned)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  function summaryWithPlanned(total: number, month = "2026-10") {
    return {
      kpis: {
        income: 5000,
        expenses: 2000,
        balance: 3000,
        savings: 0,
        avgPerMonth: 0,
        avgPerMovement: 0,
        maxAmount: 2000,
        count: 7,
        countThisMonth: 2,
      },
      mom: { months: [{ month: "2026-09", income: 3000, expenses: 1000, balance: 2000, savings: 0 }] },
      daily: [],
      categories: [],
      top: { expenses: [], income: [] },
      planned: { month, total },
    };
  }

  it("answers a query_planned intent with the real planned total and sends the brain reply verbatim", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockGetSummary.mockResolvedValue(summaryWithPlanned(4000));
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_planned",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });
    h.mockBrainReply.mockResolvedValue("El mes que viene tenés previsto $ 4.000,00.");

    await h.service.handleUpdate(textUpdate({ text: "cuánto tengo previsto?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).not.toHaveBeenCalled();
    expect(h.mockGetSummary).toHaveBeenCalledWith({ viewerId: ownerId, partnerId: null, visibility: "all" });
    expect(h.mockBrainReply).toHaveBeenCalledWith({
      intent: "query_planned",
      ok: true,
      action: "answered",
      amount: null,
      category: null,
      note: null,
      query_type: "planned",
      query: { query_type: "planned", month: "2026-10", total: 4000 },
      planned_month: "2026-10",
      planned_total: 4000,
    });
    expect(h.replies.at(-1)).toBe("El mes que viene tenés previsto $ 4.000,00.");
  });

  it("answers a query_planned intent with the fixed template when the brain reply is null", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockGetSummary.mockResolvedValue(summaryWithPlanned(4000));
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_planned",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "cuánto tengo previsto?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("previsto");
    expect(h.replies.at(-1)).toContain(formatARS(4000));
    expect(h.replies.at(-1)).not.toBe(queryRedirectReply());
  });

  it("answers zero when the owner has no planned expenses", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockGetSummary.mockResolvedValue(summaryWithPlanned(0));
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_planned",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "cuánto tengo previsto?", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toContain(formatARS(0));
  });

  it("redirects honestly when the planned query execution fails", async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockGetSummary.mockRejectedValue(new Error("db down"));
    h.mockBrainInterpret.mockResolvedValue({
      intent: "query_planned",
      amount: null,
      category: null,
      note: null,
      query_type: null,
    });

    await h.service.handleUpdate(textUpdate({ text: "cuánto tengo previsto?", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockLogger).toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(queryRedirectReply());
  });
});

describe("TelegramService resolveSuggestion folded (B2 truth table)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it('"cafes" folds to the owner category "Cafe" and registers there (exact, then folded)', async () => {
    seedHarnessCategories(h, ["Cafe", "otro"]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "register_expense", amount: 2000, category: "cafes", note: null });

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "Cafe" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it('"Otros" folds to the owner "otro" category and registers there WITHOUT a correction offer', async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "register_expense", amount: 2000, category: "Otros", note: null });

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toBe(successReply(2000, "$ feria", "otro"));
  });

  it('an exact "otro" suggestion stays a no-suggestion: otro + correction offer (today kept)', async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "register_expense", amount: 2000, category: "otro", note: null });

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ feria",
    });
  });

  it('"Supercado" with no owner match resolves to null: the E2 collect asks the category, never auto-creating', async () => {
    seedHarnessCategories(h, ["otro"]);
    h.mockBrainInterpret.mockResolvedValue({ intent: "register_expense", amount: 2000, category: "Supercado", note: null });

    await h.service.handleUpdate(textUpdate({ text: "$2000 feria", messageId: 1 }), h.reply);

    // The resolver returns null (no suggestion): the envelope still SIGNALED a
    // category, so the existing E2 collect path asks the category with the
    // amount persisted — no phantom category, no auto-create, no "Supercado".
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_registration");
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.amount).toBe(2000);
    expect(payload.category).toBeNull();
    expect(h.replies.at(-1)).toBe(askCategoryReply("$ feria"));
  });
});

describe("TelegramService CR-5 merged reply (register during a dialog)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["otro"]);
  });

  async function seedAwaitingCategory(movementId: string, note: string | null): Promise<void> {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: movementId,
      pendingNote: note,
    });
  }

  it("registers during awaiting_category with EXACTLY ONE reply merging the abandon fact and the registration outcome", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 8000,
      category: null,
      note: null,
      dialog_action: null,
    });
    h.mockBrainReply.mockResolvedValue(null);

    await h.service.handleUpdate(textUpdate({ text: "$8000 supermercado", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, category: "otro" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toContain(correctionAbandonedReply());
    expect(h.replies[0]).toContain(formatARS(8000));
  });

  it("passes abandoned_dialog: true to the brain reply in the merged single send", async () => {
    await seedAwaitingCategory("mov-9", "uber viaje");
    h.mockBrainInterpret.mockResolvedValue({
      intent: "register_expense",
      amount: 8000,
      category: null,
      note: null,
      dialog_action: null,
    });
    h.mockBrainReply.mockResolvedValue("Registré el nuevo gasto de 8000.");

    await h.service.handleUpdate(textUpdate({ text: "$8000 supermercado", messageId: 2 }), h.reply);

    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toBe("Registré el nuevo gasto de 8000.");
    expect(h.mockBrainReply).toHaveBeenCalledWith(expect.objectContaining({ abandoned_dialog: true }));
  });
});