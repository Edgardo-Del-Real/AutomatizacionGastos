import { Bot } from "grammy";
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