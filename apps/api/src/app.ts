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
import { PrismaProcessedMessageRepository } from "./features/webhook/webhook.repository";
import { WebhookService } from "./features/webhook/webhook.service";
import { webhookRoute } from "./features/webhook/webhook.route";

export type AppOptions = {
  prisma?: PrismaClient;
  logger?: boolean;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const prisma = options.prisma ?? prismaClient;
  const expenseRepository = new PrismaExpenseRepository(prisma);
  const expenseService = new ExpenseService(expenseRepository);
  const movementRepository = new PrismaMovementRepository(prisma);
  const movementService = new MovementService(movementRepository);
  const messageRepository = new PrismaProcessedMessageRepository(prisma);
  const webhookService = new WebhookService({
    messageRepository,
    expenseService,
    appSecret: env.WHATSAPP_APP_SECRET,
    ownerPhone: env.WHATSAPP_OWNER_PHONE,
    ownerId: env.OWNER_ID,
    logger: (message: string) => console.log(message),
  });

  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler(errorHandler);
  void app.register(cors, { origin: true });
  void app.register(expensesRoute, { expenseService });
  void app.register(movementsRoute, { movementService });
  void app.register(webhookRoute, {
    webhookService,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
  });

  return app;
}
