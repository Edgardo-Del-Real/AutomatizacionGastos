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
import { TelegramService } from "./features/telegram/telegram.service";

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
  const movementService = new MovementService(movementRepository, categoryService);
  const messageRepository = new PrismaProcessedMessageRepository(prisma);
  const botStateRepository = new PrismaBotStateRepository(prisma);
  const telegramService = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    botStateRepository,
    ownerChatId: env.TELEGRAM_OWNER_CHAT_ID,
    ownerId: env.OWNER_ID,
    logger: (message: string) => console.log(message),
  });

  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler(errorHandler);
  void app.register(cors, { origin: true });
  void app.register(expensesRoute, { expenseService });
  void app.register(movementsRoute, { movementService, categoryService });
  app.decorate("telegramService", telegramService);

  return app;
}
