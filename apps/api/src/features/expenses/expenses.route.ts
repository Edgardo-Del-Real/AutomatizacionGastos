import type { FastifyPluginAsync } from "fastify";
import { readOptionalOwnerHeader, readOptionalOwnerId, resolveOwnerId } from "../auth/auth.identity";
import type { ExpenseService } from "./expenses.service";

export type ExpensesRouteOptions = {
  expenseService: ExpenseService;
};

export const expensesRoute: FastifyPluginAsync<ExpensesRouteOptions> = async (app, options) => {
  const { expenseService } = options;

  app.post("/expenses", async (request, reply) => {
    const ownerId = resolveOwnerId(request, readOptionalOwnerHeader(request.headers));
    // AD7 — POST /expenses never persists visibility: a `visibility` key in the
    // body is ignored (planned expenses are INDIVIDUAL by design). Only the
    // bot's internal path passes visibility explicitly through the service.
    const expense = await expenseService.createExpense(request.body, ownerId);
    return reply.status(201).send(expense);
  });

  app.get("/expenses", async (request, reply) => {
    const ownerId = resolveOwnerId(request, readOptionalOwnerId(request.query));
    const expenses = await expenseService.listExpenses(ownerId);
    return reply.send(expenses);
  });

  app.get("/expenses/summary", async (request, reply) => {
    const ownerId = resolveOwnerId(request, readOptionalOwnerId(request.query));
    const summary = await expenseService.getSummary(ownerId);
    return reply.send(summary);
  });

  app.get("/expenses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = resolveOwnerId(request, readOptionalOwnerId(request.query));
    const expense = await expenseService.getExpense(id, ownerId);
    return reply.send(expense);
  });

  app.delete("/expenses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = resolveOwnerId(request, readOptionalOwnerHeader(request.headers));
    await expenseService.deleteExpense(id, ownerId);
    return reply.status(204).send();
  });
};
