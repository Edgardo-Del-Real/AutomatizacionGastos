import { buildApp } from "./app";
import { env } from "./config/env";
import { parseAuthEnv } from "./features/auth/auth.env";
import { AuthService } from "./features/auth/auth.service";
import {
  createTelegramBot,
  redactToken,
  registerGracefulStop,
  startTelegramBot,
} from "./features/telegram/telegram.bot";

// online-access: parsing here throws when the auth env is missing or malformed,
// so the process refuses to start wide open.
const authEnv = parseAuthEnv(process.env);
const auth = new AuthService({ credentials: authEnv.users, secret: authEnv.secret });

const app = buildApp({ logger: true, auth });
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

// D12 — startTelegramBot registers setMyCommands (tolerating failures) and
// then starts the polling loop.
void startTelegramBot(bot).catch((error: unknown) => {
  app.log.error(redactToken(error instanceof Error ? error.message : String(error), env.TELEGRAM_BOT_TOKEN));
  process.exit(1);
});