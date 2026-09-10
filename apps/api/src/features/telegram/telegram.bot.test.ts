import { Bot, BotError } from "grammy";
import type { Update } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import { createTelegramBot, redactToken, registerGracefulStop } from "./telegram.bot";
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

function buildOfflineBot(service: TelegramService): Bot {
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
  bot.api.config.use(() => {
    throw new Error("network call in offline test");
  });
  return bot;
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

describe("createTelegramBot", () => {
  let messageRepository: ProcessedMessageRepository;
  let expenseService: ExpenseService;
  let mockRecord: ReturnType<typeof vi.fn>;
  let mockCreateExpense: ReturnType<typeof vi.fn>;
  let service: TelegramService;
  let bot: Bot;

  beforeEach(() => {
    messageRepository = { recordProcessed: vi.fn() } as unknown as ProcessedMessageRepository;
    expenseService = { createExpense: vi.fn() } as unknown as ExpenseService;
    mockRecord = vi.mocked(messageRepository.recordProcessed);
    mockCreateExpense = vi.mocked(expenseService.createExpense);
    mockCreateExpense.mockResolvedValue(undefined);
    service = new TelegramService({ messageRepository, expenseService, ownerChatId: OWNER_CHAT_ID, ownerId });
    bot = buildOfflineBot(service);
  });

  it("processes an owner text update with zero network calls", async () => {
    await expect(bot.handleUpdate(textUpdate())).resolves.toBeUndefined();

    expect(mockRecord).toHaveBeenCalledWith("123456789", "42", ownerId);
    expect(mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, currency: "ARS", note: "café" }),
      ownerId,
    );
  });

  it("processes the same update with a different chat id as a distinct message", async () => {
    await bot.handleUpdate(textUpdate({ messageId: 777, chatId: 111111111, text: "pan 100" }));
    await bot.handleUpdate(textUpdate({ messageId: 777, chatId: 222222222, text: "leche 200" }));

    expect(mockCreateExpense).toHaveBeenCalledTimes(2);
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

    await expect(bot.handleUpdate(edited)).resolves.toBeUndefined();

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
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

    await expect(bot.handleUpdate(photo)).resolves.toBeUndefined();

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("stops cleanly when the polling loop is not running", async () => {
    await expect(bot.stop()).resolves.toBeUndefined();
    expect(bot.isRunning()).toBe(false);
  });

  it("logs a redacted error from the error handler without leaking the token", async () => {
    const boom = new Error(`Telegram API 401: https://api.telegram.org/bot${TOKEN}/getUpdates`);
    mockRecord.mockRejectedValue(boom);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Middleware errors propagate as BotError (grammY handleUpdate rethrows)
    const botError = await bot.handleUpdate(textUpdate()).catch((err: unknown) => err);
    expect(botError).toBeInstanceOf(BotError);

    // The long-polling loop routes that BotError to the registered catch handler
    await bot.errorHandler(botError as BotError);

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
    const bot = buildOfflineBot(app.telegramService);
    registerGracefulStop(app, bot);
    const stopSpy = vi.spyOn(bot, "stop");

    await app.ready();
    await app.close();

    expect(stopSpy).toHaveBeenCalled();
    expect(bot.isRunning()).toBe(false);
  });
});