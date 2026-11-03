import { buildApp } from "./app";
import { env } from "./config/env";
import { prismaClient } from "./infra/db/prisma";
import { parseHouseholdMembers } from "./features/household/household.config";
import { parseAuthEnv } from "./features/auth/auth.env";
import { AuthService } from "./features/auth/auth.service";
import { PrismaUserRepository } from "./features/auth/user.repository";
import { UserService } from "./features/auth/user.service";
import { loadHousehold, seedUsers } from "./features/auth/user.seed";
import {
  createTelegramBot,
  redactToken,
  registerGracefulStop,
  startTelegramBot,
} from "./features/telegram/telegram.bot";

// online-access: parsing here throws when the auth env is missing or malformed,
// so the process refuses to start wide open.
const authEnv = parseAuthEnv(process.env);
const auth = new AuthService({ secret: authEnv.secret });

// household-isolation: the env is only a bootstrap seed. The table is the
// source of truth, so a password changed from the profile survives deploys.
const userRepository = new PrismaUserRepository(prismaClient);
const fallbackMembers = parseHouseholdMembers(env.HOUSEHOLD_MEMBERS, {
  ownerId: env.OWNER_ID,
  chatId: env.TELEGRAM_OWNER_CHAT_ID!,
});
await seedUsers(userRepository, { members: fallbackMembers, credentials: authEnv.users });
const members = await loadHousehold(userRepository, fallbackMembers);
console.log(`users ready: ${members.map((member) => member.ownerId).join(", ")}`);

const app = buildApp({
  logger: true,
  auth,
  users: new UserService(userRepository),
  members,
});const bot = createTelegramBot(env.TELEGRAM_BOT_TOKEN, app.telegramService);

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

// D12 - startTelegramBot registers setMyCommands (tolerating failures) and
// then starts the polling loop, which runs until the bot stops.
//
// Deploy overlap (learned in production): Render starts the new instance
// BEFORE draining the old one, so for a few seconds two processes poll with
// the same token and Telegram answers 409 Conflict. That is not a reason to
// die: the HTTP API is already serving, and the old instance disappears on its
// own. Retry with a backoff instead of exiting, so a deploy never emails
// "server failed".
const BOT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

async function startBotWithRetry(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const delay = BOT_RETRY_DELAYS_MS[Math.min(attempt, BOT_RETRY_DELAYS_MS.length - 1)]!;
    try {
      await startTelegramBot(bot);
      app.log.info("telegram bot stopped polling");
      return;
    } catch (error) {
      const message = redactToken(
        error instanceof Error ? error.message : String(error),
        env.TELEGRAM_BOT_TOKEN,
      );
      app.log.error(`telegram bot failed to start (attempt ${attempt + 1}): ${message}`);
      app.log.info(`retrying in ${Math.round(delay / 1000)}s; the API keeps serving`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

void startBotWithRetry();
