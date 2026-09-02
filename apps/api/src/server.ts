import { buildApp } from "./app";
import { env } from "./config/env";
import { createTelegramBot, redactToken, registerGracefulStop } from "./features/telegram/telegram.bot";

const app = buildApp({ logger: true });
const bot = createTelegramBot(env.TELEGRAM_BOT_TOKEN, app.telegramService);

registerGracefulStop(app, bot);

process.on("SIGINT", () => {
  void app.close();
});
process.on("SIGTERM", () => {
  void app.close();
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

void bot.start().catch((error: unknown) => {
  app.log.error(redactToken(error instanceof Error ? error.message : String(error), env.TELEGRAM_BOT_TOKEN));
  process.exit(1);
});