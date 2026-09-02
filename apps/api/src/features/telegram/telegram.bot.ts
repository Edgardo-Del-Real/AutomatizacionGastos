import { Bot } from "grammy";
import type { FastifyInstance } from "fastify";
import type { TelegramService } from "./telegram.service";

export function redactToken(value: string, token: string): string {
  return value.replaceAll(token, "[REDACTED]");
}

export function createTelegramBot(token: string, service: TelegramService): Bot {
  const bot = new Bot(token);

  bot.on("message", (ctx) => service.handleUpdate(ctx.update));

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