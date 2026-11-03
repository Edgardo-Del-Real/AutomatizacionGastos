import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "./infra/db/prisma";
import { errorHandler } from "./infra/errors";
import { env } from "./config/env";
import { PrismaExpenseRepository } from "./features/expenses/expenses.repository";
import { ExpenseService } from "./features/expenses/expenses.service";
import { expensesRoute } from "./features/expenses/expenses.route";
import { PrismaMovementRepository } from "./features/movements/movements.repository";
import { MovementService } from "./features/movements/movements.service";
import { movementsRoute } from "./features/movements/movements.route";
import { PrismaProcessedMessageRepository } from "./features/messages/message.repository";
import { PrismaCategoryRepository } from "./features/categories/categories.repository";
import { CategoryService } from "./features/categories/categories.service";
import { PrismaBotStateRepository } from "./features/telegram/bot-state.repository";
import { GroqBotBrain } from "./features/telegram/bot-brain";
import { TelegramService } from "./features/telegram/telegram.service";
import { PrismaSavingsRuleRepository } from "./features/savings/savings.repository";
import { SavingsRuleService } from "./features/savings/savings.service";
import { parseHouseholdMembers, type HouseholdMember } from "./features/household/household.config";
import { HouseholdService } from "./features/household/household.service";
import { householdRoute } from "./features/household/household.route";
import { registerAuthGuard, authRoute } from "./features/auth/auth.route";
import type { AuthService } from "./features/auth/auth.service";
import { PrismaUserRepository } from "./features/auth/user.repository";
import { UserService } from "./features/auth/user.service";

export type AppOptions = {
  prisma?: PrismaClient;
  logger?: boolean;
  /**
   * online-access: when present, every data route requires a session. Tests
   * omit it and keep using the legacy ownerId inputs; server.ts always passes
   * it, so production can never run unauthenticated.
   */
  auth?: AuthService | null;
  /** Credential service; defaults to the Prisma-backed one. */
  users?: UserService;
  /** Household members; defaults to HOUSEHOLD_MEMBERS (tests / degraded mode). */
  members?: HouseholdMember[];
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const prisma = options.prisma ?? prismaClient;
  const expenseRepository = new PrismaExpenseRepository(prisma);
  const movementRepository = new PrismaMovementRepository(prisma);
  const categoryRepository = new PrismaCategoryRepository(prisma);
  const categoryService = new CategoryService(categoryRepository);
  // manual-savings (D6): ExpenseService takes CategoryService as a required
  // 2nd constructor param — the category wiring must sit above it.
  const expenseService = new ExpenseService(expenseRepository, categoryService);
  const savingsRepository = new PrismaSavingsRuleRepository(prisma);
  const savingsService = new SavingsRuleService(savingsRepository);
  const movementService = new MovementService(movementRepository, categoryService);
  const messageRepository = new PrismaProcessedMessageRepository(prisma);
  const botStateRepository = new PrismaBotStateRepository(prisma);
  const userRepository = new PrismaUserRepository(prisma);
  const userService = options.users ?? new UserService(userRepository);
  // household-isolation: the members come from the DB (seeded at boot). Tests
  // and the degraded single-user mode fall back to the env.
  const householdMembers =
    options.members ??
    parseHouseholdMembers(env.HOUSEHOLD_MEMBERS, {
      ownerId: env.OWNER_ID,
      // Env validation guarantees TELEGRAM_OWNER_CHAT_ID is present whenever
      // HOUSEHOLD_MEMBERS is unset (degraded single-user mode).
      chatId: env.TELEGRAM_OWNER_CHAT_ID!,
    });
  const householdService = new HouseholdService(householdMembers);
  const telegramService = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    savingsService,
    botStateRepository,
    // AD9: the household registry gates and attributes every chat; in
    // single-user mode it holds only the `default` member with the owner chat.
    household: householdService,
    logger: (message: string) => console.log(message),
    // Deterministic-only when no key: no brain is constructed and
    // `interpret`/`reply` are never invoked (spec "Missing key means no brain").
    ...(env.GROQ_API_KEY !== undefined
      ? {
          brain: new GroqBotBrain({
            apiKey: env.GROQ_API_KEY,
            model: env.LLM_MODEL,
            baseUrl: env.LLM_BASE_URL,
            timeoutMs: env.LLM_TIMEOUT_MS,
          }),
        }
      : {}),
  });

  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler(errorHandler);
  void app.register(cors, { origin: true });

  // online-access: with an AuthService every data route requires a session, and
  // the owner id comes from the cookie — `?ownerId=` stops meaning anything.
  if (options.auth !== undefined && options.auth !== null) {
    registerAuthGuard(app, options.auth);
    void app.register(authRoute, { auth: options.auth, users: userService });
  }

  // Render pings this; it must not require a session.
  app.get("/health", async (_request, reply) => reply.send({ status: "ok" }));

  void app.register(expensesRoute, { expenseService });
  void app.register(movementsRoute, { movementService, categoryService, householdService });
  void app.register(householdRoute, { householdService });
  app.decorate("telegramService", telegramService);

  return app;
}
