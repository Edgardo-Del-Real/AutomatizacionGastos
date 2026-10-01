import { Bot, type Context } from "grammy";
import type { Transformer } from "grammy";
import type { FastifyInstance } from "fastify";
import type { TelegramService } from "./telegram.service";
import type { InlineKeyboard } from "./telegram.parser";

export type RecordedApiCall = {
  method: string;
  payload: Record<string, unknown>;
};

const FAKE_MESSAGE = {
  message_id: 1,
  date: 0,
  chat: { id: 0, type: "private" as const, first_name: "Rita" },
  text: "",
};

/**
 * Offline middleware (D9): records every outbound Telegram API call as
 * `{ method, payload }` and returns a fake ok response instead of throwing on
 * network access. Lets reply behavior be asserted with zero network calls.
 */
export function recordApiCalls(record: RecordedApiCall[]): Transformer {
  return async (_prev, method, payload) => {
    record.push({ method, payload });
    return { ok: true, result: FAKE_MESSAGE } as never;
  };
}

export function redactToken(value: string, token: string): string {
  return value.replaceAll(token, "[REDACTED]");
}

/** Owner-visible command list registered via setMyCommands at boot (spec bot-main-menu). */
export const BOT_COMMANDS = [
  { command: "menu", description: "Abrí el menú principal" },
  { command: "ayuda", description: "Ayuda y ejemplos de captura" },
  { command: "listar_categorias", description: "Listá tus categorías" },
  { command: "configurar_categorias", description: "Creá, borrá y renombrá categorías" },
] as const;

/**
 * D2 — maps the service's plain reply-port call to grammy's reply/edit
 * mechanisms: a `keyboard` renders as an inline keyboard, an `editMessageId`
 * edits the existing message (falling back to a NEW message with the same
 * content when the edit fails because the original message is gone — spec
 * bot-inline-interactions "Edit failure falls back to a new message").
 */
function buildReplyPort(ctx: Context): (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void> {
  return async (text, keyboard, editMessageId) => {
    const replyMarkup =
      keyboard === undefined ? undefined : { inline_keyboard: keyboard.map((row) => row.map((button) => ({ ...button }))) };
    if (editMessageId !== undefined && ctx.chat !== undefined) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, editMessageId, text, { reply_markup: replyMarkup });
        return;
      } catch {
        // The original message is gone: fall back to a new message with the
        // same text and keyboard (the failure never propagates to the caller).
      }
    }
    await ctx.reply(text, { reply_markup: replyMarkup });
  };
}

export function createTelegramBot(token: string, service: TelegramService): Bot {
  const bot = new Bot(token);

  bot.on("message", (ctx) =>
    service.handleUpdate(ctx.update, buildReplyPort(ctx)),
  );

  // D4 — the callback channel: parse the callback through the service's
  // handleCallback; every processed callback is answered so the spinner stops.
  bot.on("callback_query", async (ctx) => {
    const processed = await service.handleCallback(ctx.update, buildReplyPort(ctx));
    if (processed) {
      await ctx.answerCallbackQuery().catch(() => undefined);
    }
  });

  bot.catch((err) => {
    console.error(redactToken(err.message, token));
  });

  return bot;
}

/**
 * D12 — boots the bot: registers the owner-visible command list via
 * `setMyCommands` (a failure is logged and never crashes the polling loop —
 * spec bot-main-menu "Registration failure tolerated") and then starts the
 * long-polling loop. `server.ts` swaps `bot.start()` for this helper.
 */
export async function startTelegramBot(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([...BOT_COMMANDS]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  await bot.start();
}

/** Stops the bot when the Fastify app closes (graceful shutdown chain: signals → app.close() → onClose → bot.stop()). */
export function registerGracefulStop(app: FastifyInstance, bot: Bot): void {
  app.addHook("onClose", async () => {
    await bot.stop();
  });
}