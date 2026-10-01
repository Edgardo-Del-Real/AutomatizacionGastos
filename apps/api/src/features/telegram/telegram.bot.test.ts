import { Bot, BotError } from "grammy";
import type { Update } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import type { CategoryService } from "../categories/categories.service";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { HouseholdService } from "../household/household.service";
import type { BotStateRepository } from "./bot-state.repository";
import type { SavingsRuleService } from "../savings/savings.service";
import {
  BOT_COMMANDS,
  createTelegramBot,
  recordApiCalls,
  redactToken,
  registerGracefulStop,
  startTelegramBot,
  type RecordedApiCall,
} from "./telegram.bot";
import { TelegramService } from "./telegram.service";

const TOKEN = "123456:TEST_TOKEN";
const OWNER_CHAT_ID = 123456789;
const ownerId = "default";

function textUpdate(overrides?: { fromId?: number; chatId?: number; messageId?: number; text?: string }): Update {
  const fromId = overrides?.fromId ?? OWNER_CHAT_ID;
  return {
    update_id: 8000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: fromId, is_bot: false, first_name: "Rita" },
      chat: { id: overrides?.chatId ?? fromId, type: "private", first_name: "Rita" },
      date: 1712803046,
      text: overrides?.text ?? "café 2500",
    },
  };
}

function callbackUpdate(overrides?: { fromId?: number; chatId?: number; data?: string }): Update {
  const fromId = overrides?.fromId ?? OWNER_CHAT_ID;
  return {
    update_id: 9000,
    callback_query: {
      id: "cb_1",
      chat_instance: "987654321",
      from: { id: fromId, is_bot: false, first_name: "Rita" },
      message: {
        message_id: 77,
        chat: { id: overrides?.chatId ?? fromId, type: "private", first_name: "Rita" },
        date: 1712803046,
        text: "preview",
      },
      data: overrides?.data ?? "m:new",
    },
  };
}

function buildOfflineBot(service: TelegramService, recorded: RecordedApiCall[]): Bot {
  const bot = createTelegramBot(TOKEN, service);
  bot.botInfo = {
    id: 987654,
    is_bot: true,
    first_name: "Rita Bot",
    username: "rita_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
  bot.api.config.use(recordApiCalls(recorded));
  return bot;
}

type BotHarness = {
  service: TelegramService;
  bot: Bot;
  recorded: RecordedApiCall[];
  mockRecord: ReturnType<typeof vi.fn>;
  mockCreateExpense: ReturnType<typeof vi.fn>;
};

function makeBotHarness(): BotHarness {
  const recorded: RecordedApiCall[] = [];
  const messageRepository = { recordProcessed: vi.fn() } as unknown as ProcessedMessageRepository;
  const expenseService = {
    createExpense: vi.fn(async () => ({
      id: "mov-1",
      ownerId,
      amount: 100,
      currency: "ARS",
      category: "otro",
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE",
    })),
    deleteExpense: vi.fn(async () => undefined),
  } as unknown as ExpenseService;
  const movementService = {
    updateMovement: vi.fn(async (_owner: string, id: string) => ({
      id,
      ownerId,
      amount: 100,
      currency: "ARS",
      category: "otro",
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE",
    })),
    listMovements: vi.fn(async () => []),
    getSummary: vi.fn(async () => ({
      kpis: { income: 0, expenses: 0, balance: 0, count: 0, maxAmount: 0 },
      byCategory: [],
      mom: { months: [] },
      daily: [],
      planned: { month: "2026-10", total: 0 },
      categories: [],
    })),
    markMovementPaid: vi.fn(async () => ({})),
  } as unknown as MovementService;
  const categoryService = {
    listCategories: vi.fn(async () => [
      { id: "c1", ownerId, name: "otro", type: "NORMAL", createdAt: new Date(), keywords: [] },
    ]),
    listKeywordRules: vi.fn(async () => []),
    matchNote: vi.fn(async () => null),
    createCategory: vi.fn(async (_owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId,
      name,
      type: "NORMAL",
      createdAt: new Date(),
    })),
    deleteCategory: vi.fn(async () => ({})),
    renameCategory: vi.fn(async () => null),
    associateKeyword: vi.fn(async () => undefined),
    ensureOtro: vi.fn(async () => ({
      id: "otro-id",
      ownerId,
      name: "otro",
      type: "NORMAL",
      createdAt: new Date(),
    })),
    ensureAhorro: vi.fn(async () => undefined),
  } as unknown as CategoryService;
  const botStateRepository = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  } as unknown as BotStateRepository;
  const savingsService = {
    resolveSplit: vi.fn(async () => ({ kind: "whole" })),
    defineRule: vi.fn(),
    matchNote: vi.fn(),
    computeSplit: vi.fn(),
  } as unknown as SavingsRuleService;

  const service = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    savingsService,
    botStateRepository,
    household: {
      resolveOwnerByChatId: (chatId: number) => (chatId === OWNER_CHAT_ID ? ownerId : null),
      partnerOf: () => null,
      getMembers: () => [{ ownerId, name: "default" }],
    } as unknown as HouseholdService,
    logger: () => undefined,
  });
  const bot = buildOfflineBot(service, recorded);

  return {
    service,
    bot,
    recorded,
    mockRecord: vi.mocked(messageRepository.recordProcessed),
    mockCreateExpense: vi.mocked(expenseService.createExpense),
  };
}

describe("redactToken", () => {
  it("strips the raw token from a value", () => {
    expect(redactToken(`token is ${TOKEN} here`, TOKEN)).not.toContain(TOKEN);
    expect(redactToken(`token is ${TOKEN} here`, TOKEN)).toContain("[REDACTED]");
  });

  it("strips the token embedded in an api.telegram.org URL", () => {
    const url = `https://api.telegram.org/bot${TOKEN}/getUpdates`;

    const redacted = redactToken(url, TOKEN);

    expect(redacted).not.toContain(TOKEN);
    expect(redacted).not.toContain(`bot${TOKEN}`);
    expect(redacted).toContain("[REDACTED]");
  });

  it("leaves a value without the token untouched", () => {
    expect(redactToken("getUpdates failed: 409 Conflict", TOKEN)).toBe("getUpdates failed: 409 Conflict");
  });
});

describe("createTelegramBot (offline reply recording)", () => {
  let h: BotHarness;

  beforeEach(() => {
    h = makeBotHarness();
  });

  it("records the unresolvable reply offline for idle text with no brain", async () => {
    // "hola" has no amount and no brain → the unresolvable fallback flows
    // through ctx.reply → bot.api.sendMessage.
    await expect(h.bot.handleUpdate(textUpdate({ text: "hola" }))).resolves.toBeUndefined();

    expect(h.recorded.some((call) => call.method === "sendMessage")).toBe(true);
    const sendMessage = h.recorded.find((call) => call.method === "sendMessage");
    expect(String(sendMessage?.payload?.chat_id)).toBe(String(OWNER_CHAT_ID));
    expect(String(sendMessage?.payload?.text).toLowerCase()).toContain("no puedo resolver eso");
  });

  it("records the capture-shaped redirect for a free-text amount (never capture from idle)", async () => {
    await expect(h.bot.handleUpdate(textUpdate({ text: "$2000 supermercado" }))).resolves.toBeUndefined();

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    const sendMessage = h.recorded.find((call) => call.method === "sendMessage");
    expect(sendMessage).toBeDefined();
    expect(String(sendMessage?.payload?.text)).toContain("➕ Nuevo gasto");
  });

  it("attaches the eight-button inline keyboard to /start (D2 message reply port)", async () => {
    await expect(h.bot.handleUpdate(textUpdate({ text: "/start" }))).resolves.toBeUndefined();

    const sendMessage = h.recorded.find((call) => call.method === "sendMessage");
    expect(sendMessage).toBeDefined();
    const markup = sendMessage?.payload?.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(markup?.inline_keyboard).toHaveLength(8);
    expect(markup?.inline_keyboard.map((row) => row[0]?.text)).toEqual([
      "➕ Nuevo gasto",
      "📅 Gasto previsto",
      "➕ Ingreso",
      "👥 Compartido",
      "🗂 Administrar categorías",
      "🧾 Administrar gastos",
      "📊 Reportes",
      "❓ Ayuda",
    ]);
    expect(markup?.inline_keyboard.map((row) => row[0]?.callback_data)).toEqual([
      "m:new",
      "m:prev",
      "m:inc",
      "m:shr",
      "m:cats",
      "m:adm",
      "m:rep",
      "m:help",
    ]);
  });

  it("processes an owner text update with zero network calls", async () => {
    await expect(h.bot.handleUpdate(textUpdate())).resolves.toBeUndefined();

    expect(h.mockRecord).toHaveBeenCalledWith("123456789", "42", ownerId);
    // "café 2500" is capture-shaped in idle: it redirects, never registers.
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
  });

  it("processes the same update with a different chat id as a distinct message", async () => {
    await h.bot.handleUpdate(textUpdate({ messageId: 777, chatId: 111111111, text: "pan 100" }));
    await h.bot.handleUpdate(textUpdate({ messageId: 777, chatId: 222222222, text: "leche 200" }));

    expect(h.mockRecord).toHaveBeenCalledTimes(2);
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
  });

  it("does nothing for an edited_message update", async () => {
    const edited: Update = {
      update_id: 2,
      edited_message: {
        message_id: 42,
        from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
        chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" },
        date: 1712803046,
        edit_date: 1712803047,
        text: "café 2500",
      },
    };

    await expect(h.bot.handleUpdate(edited)).resolves.toBeUndefined();

    expect(h.mockRecord).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.recorded).toHaveLength(0);
  });

  it("does nothing for a non-text message", async () => {
    const photo: Update = {
      update_id: 3,
      message: {
        message_id: 43,
        from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
        chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" },
        date: 1712803046,
        photo: [{ file_id: "photo_1", file_unique_id: "pu_1", width: 100, height: 100 }],
      },
    };

    await expect(h.bot.handleUpdate(photo)).resolves.toBeUndefined();

    expect(h.mockRecord).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.recorded).toHaveLength(0);
  });

  it("stops cleanly when the polling loop is not running", async () => {
    await expect(h.bot.stop()).resolves.toBeUndefined();
    expect(h.bot.isRunning()).toBe(false);
  });

  it("logs a redacted error from the error handler without leaking the token", async () => {
    const boom = new Error(`Telegram API 401: https://api.telegram.org/bot${TOKEN}/getUpdates`);
    h.mockRecord.mockRejectedValue(boom);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const botError = await h.bot.handleUpdate(textUpdate()).catch((err: unknown) => err);
    expect(botError).toBeInstanceOf(BotError);

    await h.bot.errorHandler(botError as BotError);

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(`api.telegram.org/bot${TOKEN}`);
    errorSpy.mockRestore();
  });
});

describe("createTelegramBot callback wiring (D4)", () => {
  let h: BotHarness;

  beforeEach(() => {
    h = makeBotHarness();
  });

  it("routes a callback through handleCallback, sends the reply and answers the callback query", async () => {
    await expect(h.bot.handleUpdate(callbackUpdate({ data: "zz:1" }))).resolves.toBeUndefined();

    // The unknown action is answered honestly AND the callback is answered.
    const sendMessage = h.recorded.find((call) => call.method === "sendMessage");
    expect(sendMessage).toBeDefined();
    expect(String(sendMessage?.payload?.text)).toContain("no está disponible");
    expect(h.recorded.some((call) => call.method === "answerCallbackQuery")).toBe(true);
  });

  it("ignores a callback from an unknown chat with zero API calls", async () => {
    await expect(h.bot.handleUpdate(callbackUpdate({ fromId: 999999999, chatId: 999999999 }))).resolves.toBeUndefined();

    expect(h.recorded).toHaveLength(0);
  });

  it("maps a keyboard reply to reply_markup on the sendMessage (offline keyboard assertion)", async () => {
    const recorded: RecordedApiCall[] = [];
    const service = {
      handleUpdate: async () => undefined,
      handleCallback: async (
        _update: unknown,
        reply: (text: string, keyboard?: { text: string; callback_data: string }[][]) => Promise<void>,
      ) => {
        await reply("Elegí una opción", [[{ text: "Nuevo", callback_data: "m:new" }]]);
        return true;
      },
    } as unknown as TelegramService;
    const bot = buildOfflineBot(service, recorded);

    await expect(bot.handleUpdate(callbackUpdate({ data: "m:new" }))).resolves.toBeUndefined();

    const sendMessage = recorded.find((call) => call.method === "sendMessage");
    expect(sendMessage).toBeDefined();
    expect(String(sendMessage?.payload?.text)).toContain("Elegí una opción");
    const markup = sendMessage?.payload?.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(markup?.inline_keyboard).toEqual([[{ text: "Nuevo", callback_data: "m:new" }]]);
    expect(recorded.some((call) => call.method === "answerCallbackQuery")).toBe(true);
  });

  it("falls back to a new message when editMessageText fails (spec: Edit failure falls back to a new message)", async () => {
    const recorded: RecordedApiCall[] = [];
    const service = {
      handleUpdate: async () => undefined,
      handleCallback: async (
        _update: unknown,
        reply: (text: string, keyboard?: { text: string; callback_data: string }[][], editMessageId?: number) => Promise<void>,
      ) => {
        await reply("Preview actualizado", [[{ text: "Guardar", callback_data: "pv:save:abc" }]], 77);
        return true;
      },
    } as unknown as TelegramService;
    const bot = buildOfflineBot(service, recorded);
    // Make editMessageText fail (original message deleted) and record the rest.
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === "editMessageText") {
        throw new Error("message to edit not found");
      }
      recorded.push({ method, payload });
      return { ok: true, result: { message_id: 1, date: 0, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, text: "" } } as never;
    });

    await expect(bot.handleUpdate(callbackUpdate())).resolves.toBeUndefined();

    // The fallback sends a NEW message with the same text and keyboard.
    const sendMessage = recorded.find((call) => call.method === "sendMessage");
    expect(sendMessage).toBeDefined();
    expect(String(sendMessage?.payload?.text)).toContain("Preview actualizado");
    const markup = sendMessage?.payload?.reply_markup as { inline_keyboard: unknown };
    expect(markup?.inline_keyboard).toBeDefined();
    expect(recorded.some((call) => call.method === "editMessageText")).toBe(false);
  });
});

describe("startTelegramBot (D12)", () => {
  it("registers exactly the four owner-visible commands, never the text CRUD commands", async () => {
    const recorded: RecordedApiCall[] = [];
    const service = {
      handleUpdate: async () => undefined,
      handleCallback: async () => false,
    } as unknown as TelegramService;
    const bot = buildOfflineBot(service, recorded);
    const setMyCommandsSpy = vi.spyOn(bot.api, "setMyCommands").mockResolvedValue(true as never);
    const startSpy = vi.spyOn(bot, "start").mockResolvedValue(undefined as never);

    await startTelegramBot(bot);

    expect(setMyCommandsSpy).toHaveBeenCalledWith([...BOT_COMMANDS]);
    const commands = (setMyCommandsSpy.mock.calls[0]?.[0] as unknown as { command: string }[]).map((entry) => entry.command);
    expect(commands).toEqual(["menu", "ayuda", "listar_categorias", "configurar_categorias"]);
    // Text category CRUD commands are NOT registered (button-driven admin).
    expect(commands).not.toContain("registrar categoria:");
    expect(commands).not.toContain("renombrar categoria:");
    expect(commands).not.toContain("asociar palabra:");
    expect(startSpy).toHaveBeenCalled();
  });

  it("logs a setMyCommands failure and still starts the polling loop (spec: Registration failure tolerated)", async () => {
    const recorded: RecordedApiCall[] = [];
    const service = {
      handleUpdate: async () => undefined,
      handleCallback: async () => false,
    } as unknown as TelegramService;
    const bot = buildOfflineBot(service, recorded);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(bot.api, "setMyCommands").mockRejectedValue(new Error("Unauthorized: token invalid"));
    const startSpy = vi.spyOn(bot, "start").mockResolvedValue(undefined as never);

    await startTelegramBot(bot);

    expect(errorSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("graceful stop on shutdown", () => {
  it("stops the bot when the Fastify app closes via the onClose hook", async () => {
    const app = buildApp({ logger: false });
    const recorded: RecordedApiCall[] = [];
    const bot = buildOfflineBot(app.telegramService, recorded);
    registerGracefulStop(app, bot);
    const stopSpy = vi.spyOn(bot, "stop");

    await app.ready();
    await app.close();

    expect(stopSpy).toHaveBeenCalled();
    expect(bot.isRunning()).toBe(false);
  });
});