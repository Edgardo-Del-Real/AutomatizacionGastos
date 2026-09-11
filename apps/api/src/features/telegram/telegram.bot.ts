import { Bot } from "grammy";
import type { Transformer } from "grammy";
import type { FastifyInstance } from "fastify";
import type { TelegramService } from "./telegram.service";

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

export function createTelegramBot(token: string, service: TelegramService): Bot {
  const bot = new Bot(token);

  bot.on("message", (ctx) =>
    service.handleUpdate(ctx.update, async (text) => {
      await ctx.reply(text);
    }),
  );

  bot.catch((err) => {
    console.error(redactToken(err.message, token));
  });

  return bot;
}

/** Stops the bot when the Fastify app closes (graceful shutdown chain: signals → app.close() → onClose → bot.stop()). */
export function registerGracefulStop(app: FastifyInstance, bot: Bot): void {
  app.addHook("onClose", async () => {
    await bot.stop();
  });
}