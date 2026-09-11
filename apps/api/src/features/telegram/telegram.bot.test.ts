import { Bot, BotError } from "grammy";
import type { Update } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import type { CategoryService } from "../categories/categories.service";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { BotStateRepository } from "./bot-state.repository";
import {
  createTelegramBot,
  recordApiCalls,
  redactToken,
  registerGracefulStop,
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
  } as unknown as MovementService;
  const categoryService = {
    listCategories: vi.fn(async () => [
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]),
    matchNote: vi.fn(async () => null),
    createCategory: vi.fn(async (_owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId,
      name,
      createdAt: new Date(),
    })),
    associateKeyword: vi.fn(async () => undefined),
    renameCategory: vi.fn(async () => null),
    ensureOtro: vi.fn(async () => ({
      id: "otro-id",
      ownerId,
      name: "otro",
      createdAt: new Date(),
    })),
    assertOwnerCategory: vi.fn(async () => undefined),
  } as unknown as CategoryService;
  const botStateRepository = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  } as unknown as BotStateRepository;

  const service = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    botStateRepository,
    ownerChatId: OWNER_CHAT_ID,
    ownerId,
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

  it("records the reply payload offline instead of throwing (D9 bundle)", async () => {
    // "hola" has no amount -> help reply flows through ctx.reply -> bot.api.sendMessage.
    await expect(h.bot.handleUpdate(textUpdate({ text: "hola" }))).resolves.toBeUndefined();

    expect(h.recorded.some((call) => call.method === "sendMessage")).toBe(true);
    const sendMessage = h.recorded.find((call) => call.method === "sendMessage");
    expect(String(sendMessage?.payload?.chat_id)).toBe(String(OWNER_CHAT_ID));
    expect(String(sendMessage?.payload?.text)).toContain("No entendí");
  });

  it("records the correction question when a movement falls back to 'otro'", async () => {
    await expect(h.bot.handleUpdate(textUpdate({ text: "$2000 supermercado" }))).resolves.toBeUndefined();

    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
    const sendMessage = h.recorded.find((call) => call.method === "sendMessage");
    expect(sendMessage).toBeDefined();
    expect(String(sendMessage?.payload?.text)).toContain("supermercado");
  });

  it("processes an owner text update with zero network calls", async () => {
    await expect(h.bot.handleUpdate(textUpdate())).resolves.toBeUndefined();

    expect(h.mockRecord).toHaveBeenCalledWith("123456789", "42", ownerId);
    expect(h.mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, currency: "ARS", note: "café", category: "otro" }),
      ownerId,
    );
  });

  it("processes the same update with a different chat id as a distinct message", async () => {
    await h.bot.handleUpdate(textUpdate({ messageId: 777, chatId: 111111111, text: "pan 100" }));
    await h.bot.handleUpdate(textUpdate({ messageId: 777, chatId: 222222222, text: "leche 200" }));

    expect(h.mockCreateExpense).toHaveBeenCalledTimes(2);
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