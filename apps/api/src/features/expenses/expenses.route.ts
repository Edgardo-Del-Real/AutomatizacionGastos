import type { IncomingHttpHeaders } from "node:http";
import type { FastifyPluginAsync } from "fastify";
import { ValidationFailedError } from "../../infra/errors";
import type { ExpenseService } from "./expenses.service";

export type ExpensesRouteOptions = {
  expenseService: ExpenseService;
};

export const expensesRoute: FastifyPluginAsync<ExpensesRouteOptions> = async (app, options) => {
  const { expenseService } = options;

  app.post("/expenses", async (request, reply) => {
    const ownerId = readOwnerId(request.headers);
    const expense = await expenseService.createExpense(request.body, ownerId);
    return reply.status(201).send(expense);
  });

  app.get("/expenses", async (request, reply) => {
    const ownerId = readQueryOwnerId(request.query);
    const expenses = await expenseService.listExpenses(ownerId);
    return reply.send(expenses);
  });

  app.get("/expenses/summary", async (request, reply) => {
    const ownerId = readQueryOwnerId(request.query);
    const summary = await expenseService.getSummary(ownerId);
    return reply.send(summary);
  });

  app.get("/expenses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = readQueryOwnerId(request.query);
    const expense = await expenseService.getExpense(id, ownerId);
    return reply.send(expense);
  });

  app.delete("/expenses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = readOwnerId(request.headers);
    await expenseService.deleteExpense(id, ownerId);
    return reply.status(204).send();
  });
};

function readOwnerId(headers: IncomingHttpHeaders): string {
  const ownerId = headers["x-owner-id"];
  if (typeof ownerId !== "string" || ownerId.length === 0) {
    throw new ValidationFailedError("Missing or invalid x-owner-id header");
  }
  return ownerId;
}

function readQueryOwnerId(query: unknown): string {
  const ownerId = (query as { ownerId?: unknown }).ownerId;
  if (typeof ownerId !== "string" || ownerId.length === 0) {
    throw new ValidationFailedError("Missing or invalid ownerId query parameter");
  }
  return ownerId;
}
