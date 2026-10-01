import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { CategoryService } from "../categories/categories.service";
import type { SavingsRuleService } from "../savings/savings.service";
import type { HouseholdService } from "../household/household.service";
import type { BotStateRepository, BotStateRecord } from "./bot-state.repository";
import type { ConversationEnvelope } from "./bot-brain";
import type { InlineKeyboard } from "./telegram.parser";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import { ReservedCategoryError } from "../categories/reserved";
import {
  alreadyProcessedReply,
  ayudaReply,
  callbackUnavailableReply,
  capturePromptReply,
  captureShapedRedirectReply,
  categoryAdminReply,
  categoryCrudRedirectReply,
  categoryNamePromptReply,
  compartidoPrefixRedirectReply,
  deleteCancelledReply,
  deleteConfirmReply,
  deletedMovementReply,
  duplicateCategoryReply,
  expenseAdminReply,
  greetingReply,
  menuReply,
  movementMissingReply,
  plannedReply,
  previewAskCategoryReply,
  previewReply,
  previstoPrefixRedirectReply,
  queryRedirectReply,
  questionDroppedReply,
  reportsMenuReply,
  reservedCategoryReply,
  savingsOverrideRedirectReply,
  selectionAbandonedReply,
  setupQuestionReply,
  successReply,
  unresolvableReply,
} from "./reply-text";
import {
  capturePayloadSchema,
  categoryNamePayloadSchema,
  previewPayloadSchema,
  TelegramService,
} from "./telegram.service";
import { BOT_STATES } from "./bot-state.repository";

const OWNER_CHAT_ID = 123456789;
const ownerId = "default";

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
  botStateRepository: BotStateRepository;
  mockRecord: ReturnType<typeof vi.fn>;
  mockCreateExpense: ReturnType<typeof vi.fn>;
  mockUpdateMovement: ReturnType<typeof vi.fn>;
  mockListMovements: ReturnType<typeof vi.fn>;
  mockMarkMovementPaid: ReturnType<typeof vi.fn>;
  mockDeleteExpense: ReturnType<typeof vi.fn>;
  mockGetSummary: ReturnType<typeof vi.fn>;
  mockListCategories: ReturnType<typeof vi.fn>;
  mockCreateCategory: ReturnType<typeof vi.fn>;
  mockDeleteCategory: ReturnType<typeof vi.fn>;
  mockRenameCategory: ReturnType<typeof vi.fn>;
  mockEnsureOtro: ReturnType<typeof vi.fn>;
  mockEnsureAhorro: ReturnType<typeof vi.fn>;
  mockResolveSplit: ReturnType<typeof vi.fn>;
  mockDefineRule: ReturnType<typeof vi.fn>;
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
      type: "NORMAL",
      createdAt: new Date(),
    })),
    deleteCategory: vi.fn(async (owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId: owner,
      name,
      type: "NORMAL",
      createdAt: new Date(),
    })),
    renameCategory: vi.fn(async (owner: string, from: string, to: string) => ({
      id: `cat-${to}`,
      ownerId: owner,
      name: to,
      type: "NORMAL",
      createdAt: new Date(),
    })),
    associateKeyword: vi.fn(async () => undefined),
    ensureOtro: vi.fn(async () => undefined),
    ensureAhorro: vi.fn(async () => undefined),
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
    resolveOwnerByChatId: vi.fn((fromId: number) => (fromId === OWNER_CHAT_ID ? ownerId : null)),
    partnerOf: vi.fn(() => null),
  } as unknown as HouseholdService;
  const brain = options?.noBrain
    ? undefined
    : {
        interpret: vi.fn(async () => null),
        reply: vi.fn(async () => null),
      };
  const logger = vi.fn();

  const service = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    savingsService,
    botStateRepository,
    household,
    logger,
    ...(brain === undefined ? {} : { brain }),
  });

  return {
    service,
    botStateRepository,
    mockRecord: vi.mocked(messageRepository.recordProcessed),
    mockCreateExpense: vi.mocked(expenseService.createExpense),
    mockUpdateMovement: vi.mocked(movementService.updateMovement),
    mockListMovements: vi.mocked(movementService.listMovements),
    mockMarkMovementPaid: vi.mocked(movementService.markMovementPaid),
    mockDeleteExpense: vi.mocked(expenseService.deleteExpense),
    mockGetSummary: vi.mocked(movementService.getSummary),
    mockListCategories: vi.mocked(categoryService.listCategories),
    mockCreateCategory: vi.mocked(categoryService.createCategory),
    mockDeleteCategory: vi.mocked(categoryService.deleteCategory),
    mockRenameCategory: vi.mocked(categoryService.renameCategory),
    mockEnsureOtro: vi.mocked(categoryService.ensureOtro),
    mockEnsureAhorro: vi.mocked(categoryService.ensureAhorro),
    mockResolveSplit: vi.mocked(savingsService.resolveSplit),
    mockDefineRule: vi.mocked(savingsService.defineRule),
    mockSetState: vi.mocked(botStateRepository.set),
    mockBrainInterpret: vi.mocked(brain?.interpret ?? vi.fn()),
    mockBrainReply: vi.mocked(brain?.reply ?? vi.fn()),
    mockLogger: logger,
    replies,
    keyboards,
    edits,
    reply,
  };
}

function emptySummary() {
  return {
    kpis: { income: 0, expenses: 0, balance: 0, count: 0, maxAmount: 0 },
    byCategory: [],
    mom: { months: [] },
    daily: [],
    planned: { month: "2026-10", total: 0 },
    categories: [],
  };
}

function seedHarnessCategories(h: Harness, names: string[]): void {
  h.mockListCategories.mockResolvedValue(
    names.map((name, index) => ({
      id: `c${index}`,
      ownerId,
      name,
      type: "NORMAL",
      createdAt: new Date(),
      keywords: [],
    })),
  );
}

/** Enters `awaiting_capture{type}` through a menu tap. */
async function seedAwaitingCapture(h: Harness, type: "REAL" | "PENDING" | "INGRESO" | "COMPARTIDO"): Promise<void> {
  seedHarnessCategories(h, ["Cafe", "Transporte"]);
  const menu = { REAL: "m:new", PENDING: "m:prev", INGRESO: "m:inc", COMPARTIDO: "m:shr" }[type];
  await h.service.handleCallback(callbackUpdate({ data: menu }), h.reply);
}

describe("payload schemas (v2)", () => {
  it("parses a capture payload with the menu-chosen type", () => {
    const result = capturePayloadSchema.safeParse({ type: "INGRESO" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("INGRESO");
    }
  });

  it("rejects an unknown capture type", () => {
    expect(capturePayloadSchema.safeParse({ type: "DUDOSO" }).success).toBe(false);
  });

  it("parses a preview payload with category null and a save token", () => {
    const result = previewPayloadSchema.safeParse({
      amount: 2500,
      note: "alquiler",
      type: "PENDING",
      category: null,
      saveToken: "a1b2c3d4",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a preview payload with a bad token", () => {
    expect(
      previewPayloadSchema.safeParse({
        amount: 2500,
        note: null,
        type: "REAL",
        category: "Cafe",
        saveToken: "zz",
      }).success,
    ).toBe(false);
  });

  it("parses a category-name payload with the preview flow", () => {
    const result = categoryNamePayloadSchema.safeParse({
      flow: "preview",
      preview: { amount: 2500, note: null, type: "REAL", category: null, saveToken: "a1b2c3d4" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flow).toBe("preview");
    }
  });

  it("declares the eight v2 bot states and drops the removed dialog states", () => {
    for (const state of [
      "idle",
      "awaiting_setup",
      "awaiting_capture",
      "awaiting_preview",
      "awaiting_category_name",
      "awaiting_movement_selection",
      "awaiting_category_selection",
      "awaiting_delete_confirmation",
    ]) {
      expect(BOT_STATES).toContain(state);
    }
    expect(BOT_STATES).not.toContain("awaiting_category");
    expect(BOT_STATES).not.toContain("awaiting_registration");
    expect(BOT_STATES).not.toContain("awaiting_amount_confirmation");
  });
});

describe("TelegramService.handleCallback (v2 callback routing)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("returns true for a known callback and dispatches it", async () => {
    seedHarnessCategories(h, ["Cafe"]);

    expect(await h.service.handleCallback(callbackUpdate({ data: "m:new" }), h.reply)).toBe(true);
    expect(h.replies.at(-1)).toBe(capturePromptReply());
  });

  it("returns false for an unknown chat callback without replying", async () => {
    expect(
      await h.service.handleCallback(callbackUpdate({ fromId: 999, data: "m:new" }), h.reply),
    ).toBe(false);
    expect(h.replies).toHaveLength(0);
  });

  it("returns false for a non-callback update", async () => {
    expect(await h.service.handleCallback(textUpdate(), h.reply)).toBe(false);
    expect(h.replies).toHaveLength(0);
  });

  it("replies honestly for an unknown action prefix and changes no state", async () => {
    seedHarnessCategories(h, ["Cafe"]);

    expect(await h.service.handleCallback(callbackUpdate({ data: "zz:1" }), h.reply)).toBe(true);
    expect(h.replies.at(-1)).toBe(callbackUnavailableReply());
    expect(h.mockSetState).not.toHaveBeenCalled();
  });

  it("answers a stale type-toggle callback honestly (pv:typ is gone; no matching preview state)", async () => {
    seedHarnessCategories(h, ["Cafe"]);

    await h.service.handleCallback(callbackUpdate({ data: "pv:typ:r:abcdef12" }), h.reply);
    expect(h.replies.at(-1)).toBe(alreadyProcessedReply());
  });
});

describe("TelegramService menu taps (v2 capture type memory)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe", "Transporte"]);
  });

  it.each([
    ["m:new", "REAL"],
    ["m:prev", "PENDING"],
    ["m:inc", "INGRESO"],
    ["m:shr", "COMPARTIDO"],
  ] as const)("persists capture type %s and prompts for monto+nota", async (data, type) => {
    await h.service.handleCallback(callbackUpdate({ data }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_capture");
    const payload = capturePayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.type).toBe(type);
    expect(h.replies.at(-1)).toBe(capturePromptReply());
  });

  it("supersedes an open preview when a type tap arrives", async () => {
    await seedAwaitingCapture(h, "REAL");
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 2 }), h.reply);
    expect(h.replies.at(-1)).toContain("¿Guardamos?");

    await h.service.handleCallback(callbackUpdate({ data: "m:inc", messageId: 88 }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_capture");
    expect(capturePayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}")).type).toBe("INGRESO");
    expect(h.replies.at(-1)).toBe(capturePromptReply());
  });

  it("sends the setup question when the owner has zero categories", async () => {
    h.mockListCategories.mockResolvedValue([]);

    await h.service.handleCallback(callbackUpdate({ data: "m:new" }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_setup");
    expect(h.replies.at(-1)).toBe(setupQuestionReply([]));
  });

  it("opens the expense-admin sub-menu and supersedes any pending flow", async () => {
    await seedAwaitingCapture(h, "REAL");

    await h.service.handleCallback(callbackUpdate({ data: "m:adm", messageId: 88 }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("idle");
    expect(h.replies.at(-1)).toBe(expenseAdminReply());
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb[0]?.[0]?.text).toBe("🗑 Borrar gasto");
    expect(kb[1]?.[0]?.text).toBe("✏️ Corregir categoría");
    expect(kb[2]?.[0]?.text).toBe("💵 Marcar como pagado");
  });

  it("opens the category-admin sub-menu", async () => {
    await h.service.handleCallback(callbackUpdate({ data: "m:cats" }), h.reply);

    expect(h.replies.at(-1)).toBe(categoryAdminReply());
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb.map((row) => row[0]?.text)).toEqual(["➕ Crear categoría", "✏️ Renombrar categoría", "🗑 Borrar categoría"]);
  });

  it("opens the reports sub-menu with the five queries", async () => {
    await h.service.handleCallback(callbackUpdate({ data: "m:rep" }), h.reply);

    expect(h.replies.at(-1)).toBe(reportsMenuReply());
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb.map((row) => row[0]?.text)).toEqual([
      "Últimos movimientos",
      "Saldo",
      "Resumen del mes",
      "Ahorro del mes",
      "Gastos previstos",
    ]);
  });

  it("sends the static help for m:help", async () => {
    await h.service.handleCallback(callbackUpdate({ data: "m:help" }), h.reply);
    expect(h.replies.at(-1)).toBe(ayudaReply());
  });
});

describe("TelegramService capture chain (awaiting_capture → awaiting_preview)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe", "Transporte"]);
  });

  it("parses '30000 gym' into a preview with the menu-chosen type and ZERO LLM calls", async () => {
    await seedAwaitingCapture(h, "REAL");
    h.mockBrainInterpret.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 2 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_preview");
    const payload = previewPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload).toMatchObject({ amount: 30000, note: "gym", type: "REAL", category: null });
    expect(payload.saveToken).toMatch(/^[0-9a-f]{8}$/);
    expect(h.replies.at(-1)).toBe(previewReply(30000, "gym", "REAL"));
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb[0]?.[0]?.text).toBe("Cafe");
    expect(kb[1]?.[0]?.text).toBe("Transporte");
    expect(kb[2]?.[0]?.text).toBe("➕ Crear categoría");
    expect(kb[3]?.[0]?.text).toBe("✅ Guardar");
    expect(kb[3]?.[1]?.text).toBe("✏️ Corregir");
  });

  it("carries the PENDING type from the 📅 tap into the preview", async () => {
    await seedAwaitingCapture(h, "PENDING");

    await h.service.handleUpdate(textUpdate({ text: "2500 alquiler", messageId: 2 }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    const payload = previewPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.type).toBe("PENDING");
  });

  it("re-prompts for the amount on a message without a parseable amount, registering nothing and never calling the brain", async () => {
    await seedAwaitingCapture(h, "REAL");
    h.mockBrainInterpret.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "gym", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(capturePromptReply());
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_capture");
  });

  it("recovers a corrupt capture payload to idle without registering", async () => {
    await h.service.handleCallback(callbackUpdate({ data: "m:new" }), h.reply);
    h.mockSetState.mockClear();
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_capture",
      pendingMovementId: null,
      pendingNote: "not-json",
    } as BotStateRecord);

    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 2 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("idle");
  });
});

describe("TelegramService preview callbacks (v2)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe", "Transporte"]);
  });

  async function openPreview(): Promise<{ token: string }> {
    await seedAwaitingCapture(h, "REAL");
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    return { token: payload.saveToken };
  }

  it("selects a category via cat:<id> and re-renders the preview", async () => {
    await openPreview();
    h.mockSetState.mockClear();

    await h.service.handleCallback(callbackUpdate({ data: "cat:c0", messageId: 90 }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_preview");
    const payload = previewPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.category).toBe("Cafe");
    expect(h.replies.at(-1)).toBe(previewReply(30000, "gym", "REAL"));
    expect(h.edits.at(-1)).toBe(90);
  });

  it("gates Guardar until a category is selected: nothing registers and the preview asks", async () => {
    const { token } = await openPreview();

    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${token}` }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(previewAskCategoryReply());
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_preview");
  });

  it("registers with the previewed facts after a category is selected and returns to the menu", async () => {
    const { token } = await openPreview();
    await h.service.handleCallback(callbackUpdate({ data: "cat:c0", messageId: 90 }), h.reply);

    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${token}` }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 30000, note: "gym", category: "Cafe", type: "EXPENSE" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-1)).toBe(menuReply());
    expect(h.replies.at(-2)).toBe(successReply(30000, "gym", "Cafe"));
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("idle");
  });

  it("is idempotent: a retried Guardar with a consumed token replies already processed", async () => {
    const { token } = await openPreview();
    await h.service.handleCallback(callbackUpdate({ data: "cat:c0", messageId: 90 }), h.reply);
    h.mockSetState.mockClear();

    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${token}` }), h.reply);
    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${token}` }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(h.replies.at(-1)).toBe(alreadyProcessedReply());
  });

  it("Corregir reopens capture with the SAME type", async () => {
    await seedAwaitingCapture(h, "PENDING");
    await h.service.handleUpdate(textUpdate({ text: "2500 alquiler", messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));

    await h.service.handleCallback(callbackUpdate({ data: `pv:edit:${payload.saveToken}` }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_capture");
    expect(capturePayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}")).type).toBe("PENDING");
    expect(h.replies.at(-1)).toBe(capturePromptReply());
  });

  it("➕ Crear categoría enters awaiting_category_name with the preview flow", async () => {
    const { token } = await openPreview();

    await h.service.handleCallback(callbackUpdate({ data: `pv:catnew:${token}` }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_category_name");
    const payload = categoryNamePayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.flow).toBe("preview");
    expect(payload.preview?.amount).toBe(30000);
    expect(h.replies.at(-1)).toBe(categoryNamePromptReply("preview"));
  });

  it("creates the category from the preview name and re-renders the preview with it selected", async () => {
    const { token } = await openPreview();
    await h.service.handleCallback(callbackUpdate({ data: `pv:catnew:${token}` }), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "Gimnasio", messageId: 3 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Gimnasio");
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_preview");
    const payload = previewPayloadSchema.parse(JSON.parse(lastCall.pendingNote ?? "{}"));
    expect(payload.category).toBe("Gimnasio");
    expect(h.replies.at(-1)).toBe(previewReply(30000, "gym", "REAL"));
  });

  it("rejects a reserved name: redirect, nothing created, preview stays without a selection", async () => {
    const { token } = await openPreview();
    await h.service.handleCallback(callbackUpdate({ data: `pv:catnew:${token}` }), h.reply);
    h.mockCreateCategory.mockRejectedValue(
      new ReservedCategoryError('Category "previsto" is the reserved concept "previsto"', "previsto"),
    );

    await h.service.handleUpdate(textUpdate({ text: "previsto", messageId: 3 }), h.reply);

    expect(h.replies.at(-1)).toBe(previewReply(30000, "gym", "REAL"));
    expect(h.replies.at(-2)).toBe(reservedCategoryReply("previsto", "previsto"));
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.category).toBeNull();
  });

  it("rejects a duplicate name and keeps the preview without a selection", async () => {
    const { token } = await openPreview();
    await h.service.handleCallback(callbackUpdate({ data: `pv:catnew:${token}` }), h.reply);
    h.mockCreateCategory.mockRejectedValue(new ValidationFailedError('Category "Gimnasio" already exists'));

    await h.service.handleUpdate(textUpdate({ text: "Gimnasio", messageId: 3 }), h.reply);

    expect(h.replies.at(-1)).toBe(previewReply(30000, "gym", "REAL"));
    expect(h.replies.at(-2)).toBe(duplicateCategoryReply("Gimnasio"));
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.category).toBeNull();
  });
});

describe("TelegramService movement type mapping (v2)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe"]);
  });

  async function saveCapture(type: "REAL" | "PENDING" | "INGRESO" | "COMPARTIDO", text: string): Promise<void> {
    await seedAwaitingCapture(h, type);
    await h.service.handleUpdate(textUpdate({ text, messageId: 2 }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    await h.service.handleCallback(callbackUpdate({ data: "cat:c0", messageId: 90 }), h.reply);
    await h.service.handleCallback(callbackUpdate({ data: `pv:save:${payload.saveToken}` }), h.reply);
  }

  it("REAL registers EXPENSE + PAID + INDIVIDUAL", async () => {
    await saveCapture("REAL", "14000 pasaje");

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 14000, note: "pasaje", category: "Cafe", type: "EXPENSE" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-2)).toBe(successReply(14000, "pasaje", "Cafe"));
  });

  it("PENDING registers EXPENSE + PENDING + INDIVIDUAL and confirms as previsto", async () => {
    await saveCapture("PENDING", "2500 alquiler");

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, note: "alquiler", category: "Cafe", type: "EXPENSE", status: "PENDING" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
    expect(h.replies.at(-2)).toBe(plannedReply(2500, "alquiler", "Cafe"));
  });

  it("INGRESO registers INCOME + PAID + INDIVIDUAL when no rule matches (resolveSplit whole)", async () => {
    h.mockResolveSplit.mockResolvedValue({ kind: "whole" });

    await saveCapture("INGRESO", "cobro sueldo de entrenuts 1000");

    // The savings rule ALWAYS applies to INGRESO (no per-message overrides):
    // resolveSplit runs with the neutral override and yields whole here.
    expect(h.mockResolveSplit).toHaveBeenCalledWith(ownerId, "cobro sueldo de entrenuts", { kind: "none" });
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, note: "cobro sueldo de entrenuts", category: "Cafe", type: "INCOME" }),
      ownerId,
      { visibility: "INDIVIDUAL" },
    );
  });

  it("COMPARTIDO registers EXPENSE + PAID + SHARED", async () => {
    await saveCapture("COMPARTIDO", "2000 super");

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, note: "super", category: "Cafe", type: "EXPENSE" }),
      ownerId,
      { visibility: "SHARED" },
    );
  });

  it("the save confirmation always returns to the menu", async () => {
    await saveCapture("REAL", "14000 pasaje");

    expect(h.replies.at(-1)).toBe(menuReply());
  });
});

describe("TelegramService idle routing (v2 pre-checks and brain classification)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe", "Transporte"]);
  });

  it("redirects capture-shaped text to ➕ Nuevo gasto with the menu and NEVER calls the brain", async () => {
    h.mockBrainInterpret.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "14000 pasaje", messageId: 1 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(captureShapedRedirectReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("redirects an amount-only message the same way", async () => {
    await h.service.handleUpdate(textUpdate({ text: "30000", messageId: 1 }), h.reply);

    expect(h.replies.at(-2)).toBe(captureShapedRedirectReply());
  });

  it("redirects the previsto: prefix to the 📅 button with the menu and zero LLM", async () => {
    h.mockBrainInterpret.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "previsto: 2500 alquiler", messageId: 1 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(previstoPrefixRedirectReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("redirects the compartido: prefix to the 👥 button", async () => {
    await h.service.handleUpdate(textUpdate({ text: "compartido: 2000 super", messageId: 1 }), h.reply);

    expect(h.replies.at(-2)).toBe(compartidoPrefixRedirectReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("redirects savings-override text to the automatic rule", async () => {
    await h.service.handleUpdate(textUpdate({ text: "sin ahorro cobro sueldo de entrenuts 1000", messageId: 1 }), h.reply);

    expect(h.replies.at(-2)).toBe(savingsOverrideRedirectReply());
  });

  it("redirects legacy text CRUD to the 🗂 button and never creates", async () => {
    await h.service.handleUpdate(textUpdate({ text: "registrar categoria: Salud", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(categoryCrudRedirectReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("routes a query-classified message through the executor and returns to the menu", async () => {
    h.mockGetSummary.mockResolvedValue({
      ...emptySummary(),
      kpis: { income: 2000, expenses: 500, balance: 1500, count: 2, maxAmount: 2000 },
    });
    h.mockBrainInterpret.mockResolvedValue({ intent: "query_balance", amount: null, note: null } satisfies ConversationEnvelope);

    await h.service.handleUpdate(textUpdate({ text: "cuánto gasté", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(menuReply());
    expect(h.replies.at(-2)).toContain("1.500");
  });

  it("greets warmly and shows the menu for a greeting-classified message", async () => {
    h.mockBrainInterpret.mockResolvedValue({ intent: "greeting", amount: null, note: null } satisfies ConversationEnvelope);

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 1 }), h.reply);

    expect(h.replies.at(-2)).toBe(greetingReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("shows the static help for a help-classified message", async () => {
    h.mockBrainInterpret.mockResolvedValue({ intent: "help", amount: null, note: null } satisfies ConversationEnvelope);

    await h.service.handleUpdate(textUpdate({ text: "qué sabés hacer?", messageId: 1 }), h.reply);

    expect(h.replies.at(-2)).toBe(ayudaReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("replies unresolvable plus the menu for off_topic and for a null brain", async () => {
    h.mockBrainInterpret.mockResolvedValue({ intent: "off_topic", amount: null, note: null } satisfies ConversationEnvelope);
    await h.service.handleUpdate(textUpdate({ text: "que lindo día", messageId: 1 }), h.reply);

    expect(h.replies.at(-2)).toBe(unresolvableReply());
    expect(h.replies.at(-1)).toBe(menuReply());

    h.mockBrainInterpret.mockResolvedValue(null);
    await h.service.handleUpdate(textUpdate({ text: "otra cosa", messageId: 2 }), h.reply);

    expect(h.replies.at(-2)).toBe(unresolvableReply());
  });

  it("sends the query redirect plus the menu when the query executor fails", async () => {
    h.mockBrainInterpret.mockResolvedValue({ intent: "query_balance", amount: null, note: null } satisfies ConversationEnvelope);
    h.mockGetSummary.mockRejectedValue(new Error("db down"));

    await h.service.handleUpdate(textUpdate({ text: "cuánto gasté", messageId: 1 }), h.reply);

    expect(h.replies.at(-2)).toBe(queryRedirectReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("the setup gate precedes idle routing: no categories → awaiting_setup, no parser, no brain", async () => {
    h.mockListCategories.mockResolvedValue([]);
    h.mockBrainInterpret.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);

    expect(h.mockBrainInterpret).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("awaiting_setup");
    expect(h.replies.at(-1)).toBe(setupQuestionReply([]));
  });
});

describe("TelegramService state machine recovery (v2)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe"]);
  });

  it.each(["awaiting_registration", "awaiting_category", "awaiting_amount_confirmation"] as const)(
    "recovers a removed %s payload to idle with the dropped reply, consuming the message",
    async (removedState) => {
      await h.botStateRepository.set({
        ownerId,
        state: removedState,
        pendingMovementId: "mov-1",
        pendingNote: "{}",
      } as BotStateRecord);
      h.mockSetState.mockClear();

      await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);

      expect(h.mockCreateExpense).not.toHaveBeenCalled();
      expect(h.mockBrainInterpret).not.toHaveBeenCalled();
      const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
      expect(lastCall.state).toBe("idle");
      expect(lastCall.pendingMovementId).toBeNull();
      expect(lastCall.pendingNote).toBeNull();
      expect(h.replies.at(-1)).toBe(questionDroppedReply());
    },
  );

  it("recovers an unknown persisted state string to idle", async () => {
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_whatever",
      pendingMovementId: null,
      pendingNote: null,
    } as unknown as BotStateRecord);

    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(questionDroppedReply());
  });

  it("a new text during a preview abandons it and idle-routes the text (never capture)", async () => {
    await seedAwaitingCapture(h, "REAL");
    await h.service.handleUpdate(textUpdate({ text: "30000 gym", messageId: 2 }), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "14000 pasaje", messageId: 3 }), h.reply);

    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("idle");
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("a new text during the delete gate abandons it: nothing deleted, then idle-route", async () => {
    const payload = {
      action: "delete_expense",
      candidates: [{ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" }],
    };
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    await h.service.handleCallback(callbackUpdate({ data: "dk:m1" }), h.reply);
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_delete_confirmation");

    await h.service.handleUpdate(textUpdate({ text: "14000 pasaje", messageId: 3 }), h.reply);

    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    const after = await h.botStateRepository.get(ownerId);
    expect(after?.state).toBe("idle");
  });

  it("a new text during a movement pick abandons it to the menu, changing nothing", async () => {
    const payload = {
      action: "delete_expense",
      candidates: [{ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" }],
    };
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 1 }), h.reply);

    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(selectionAbandonedReply());
    expect(h.replies.at(-1)).toBe(menuReply());
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("idle");
  });
});

describe("TelegramService delete gate (dk/dc, unchanged from v1)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe"]);
    h.mockListMovements.mockResolvedValue([
      { id: "m1", ownerId, amount: 2500, currency: "ARS", category: "Cafe", note: "alquiler", occurredAt: new Date("2026-09-19T12:00:00Z"), createdAt: new Date(), type: "EXPENSE" },
    ]);
  });

  /** Opens a delete pick (Phase 6 re-enters this via am:del; here the payload is seeded directly). */
  async function openDeletePick(): Promise<void> {
    const payload = {
      action: "delete_expense",
      candidates: [{ id: "m1", amount: 2500, note: "alquiler", date: "2026-09-19" }],
    };
    await h.botStateRepository.set({
      ownerId,
      state: "awaiting_movement_selection",
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
  }

  it("a pick opens the confirmation gate and nothing is deleted yet", async () => {
    await openDeletePick();
    await h.service.handleCallback(callbackUpdate({ data: "dk:m1" }), h.reply);

    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_delete_confirmation");
    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toBe(deleteConfirmReply(2500, "alquiler", null));
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb[0]?.[0]?.text).toBe("❌ Cancelar");
    expect(kb[0]?.[1]?.text).toBe("🗑 Borrar");
  });

  it("dc:ok deletes the persisted target and returns to the menu", async () => {
    await openDeletePick();
    await h.service.handleCallback(callbackUpdate({ data: "dk:m1" }), h.reply);

    await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m1" }), h.reply);

    expect(h.mockDeleteExpense).toHaveBeenCalledWith("m1", ownerId);
    expect(h.replies.at(-2)).toBe(deletedMovementReply(2500, "alquiler", null));
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("dc:no cancels without deleting and returns to the menu", async () => {
    await openDeletePick();
    await h.service.handleCallback(callbackUpdate({ data: "dk:m1" }), h.reply);

    await h.service.handleCallback(callbackUpdate({ data: "dc:no:m1" }), h.reply);

    expect(h.mockDeleteExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-2)).toBe(deleteCancelledReply());
    expect(h.replies.at(-1)).toBe(menuReply());
  });

  it("a 404 on confirm replies movement missing", async () => {
    h.mockDeleteExpense.mockRejectedValue(new NotFoundError("Expense m1 not found"));
    await openDeletePick();
    await h.service.handleCallback(callbackUpdate({ data: "dk:m1" }), h.reply);

    await h.service.handleCallback(callbackUpdate({ data: "dc:ok:m1" }), h.reply);

    expect(h.replies.at(-2)).toBe(movementMissingReply());
  });
});

describe("TelegramService commands (v2 surface)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedHarnessCategories(h, ["Cafe", "Transporte"]);
  });

  it("the menu command abandons any pending flow and renders the eight-button menu", async () => {
    await seedAwaitingCapture(h, "REAL");
    h.mockSetState.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "menu", messageId: 2 }), h.reply);

    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("idle");
    expect(h.replies.at(-1)).toBe(menuReply());
    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb.map((row) => row[0]?.text)).toEqual([
      "➕ Nuevo gasto",
      "📅 Gasto previsto",
      "➕ Ingreso",
      "👥 Compartido",
      "🗂 Administrar categorías",
      "🧾 Administrar gastos",
      "📊 Reportes",
      "❓ Ayuda",
    ]);
  });

  it("/start renders the same eight-button menu", async () => {
    await h.service.handleUpdate(textUpdate({ text: "/start", messageId: 1 }), h.reply);

    const kb = h.keyboards.at(-1) as InlineKeyboard;
    expect(kb).toHaveLength(8);
  });

  it("ayuda replies with the static help", async () => {
    await h.service.handleUpdate(textUpdate({ text: "/ayuda", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe(ayudaReply());
  });

  it("lists the categories", async () => {
    seedHarnessCategories(h, ["Cafe", "Transporte"]);

    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toContain("Cafe");
    expect(h.replies.at(-1)).toContain("Transporte");
  });

  it("configurar opens the setup question listing the existing categories", async () => {
    seedHarnessCategories(h, ["Cafe", "Transporte"]);

    await h.service.handleUpdate(textUpdate({ text: "/configurar_categorias", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe(setupQuestionReply(["Cafe", "Transporte"]));
    const state = await h.botStateRepository.get(ownerId);
    expect(state?.state).toBe("awaiting_setup");
  });

  it("defines a savings rule via the command", async () => {
    await h.service.handleUpdate(textUpdate({ text: "registrar ahorro: entrenuts al 10%", messageId: 1 }), h.reply);

    expect(h.mockDefineRule).toHaveBeenCalledWith(ownerId, "entrenuts", 10);
    expect(h.replies.at(-1)).toContain("entrenuts");
  });

  it("rejects an out-of-range savings-rule percent", async () => {
    await h.service.handleUpdate(textUpdate({ text: "registrar ahorro: entrenuts al 150%", messageId: 1 }), h.reply);

    expect(h.mockDefineRule).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("0");
  });
});

describe("TelegramService setup flow (awaiting_setup)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("creates the listed categories and returns to idle", async () => {
    h.mockListCategories.mockResolvedValue([]);
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    expect(h.mockSetState.mock.calls.at(-1)?.[0].state).toBe("awaiting_setup");

    await h.service.handleUpdate(textUpdate({ text: "Cafe\nTransporte", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Transporte");
    // v2: setup never creates the legacy "otro" row (spec movement-categories
    // "Setup creates no otro for new owners").
    expect(h.mockEnsureOtro).not.toHaveBeenCalled();
    const lastCall = h.mockSetState.mock.calls.at(-1)?.[0] as BotStateRecord;
    expect(lastCall.state).toBe("idle");
    expect(h.replies.at(-1)).not.toContain("otro");
  });

  it("executes a batch delete command without creating a literal", async () => {
    h.mockListCategories.mockResolvedValue([]);
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "borrar categoria: no", messageId: 2 }), h.reply);

    expect(h.mockDeleteCategory).toHaveBeenCalledWith(ownerId, "no");
    expect(h.mockCreateCategory).not.toHaveBeenCalled();
  });
});