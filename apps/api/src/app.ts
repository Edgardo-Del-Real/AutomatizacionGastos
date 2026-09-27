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
import { parseHouseholdMembers } from "./features/household/household.config";
import { HouseholdService } from "./features/household/household.service";
import { householdRoute } from "./features/household/household.route";

export type AppOptions = {
  prisma?: PrismaClient;
  logger?: boolean;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const prisma = options.prisma ?? prismaClient;
  const expenseRepository = new PrismaExpenseRepository(prisma);
  const expenseService = new ExpenseService(expenseRepository);
  const movementRepository = new PrismaMovementRepository(prisma);
  const categoryRepository = new PrismaCategoryRepository(prisma);
  const categoryService = new CategoryService(categoryRepository);
  const savingsRepository = new PrismaSavingsRuleRepository(prisma);
  const savingsService = new SavingsRuleService(savingsRepository);
  const movementService = new MovementService(movementRepository, categoryService);
  const messageRepository = new PrismaProcessedMessageRepository(prisma);
  const botStateRepository = new PrismaBotStateRepository(prisma);
  const householdMembers = parseHouseholdMembers(env.HOUSEHOLD_MEMBERS, {
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
  void app.register(expensesRoute, { expenseService });
  void app.register(movementsRoute, { movementService, categoryService, householdService });
  void app.register(householdRoute, { householdService });
  app.decorate("telegramService", telegramService);

  return app;
}
