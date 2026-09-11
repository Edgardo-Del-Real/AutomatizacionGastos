import type { IncomingHttpHeaders } from "node:http";
import type { FastifyPluginAsync } from "fastify";
import { movementFiltersSchema } from "@rita/contracts";
import { z } from "zod";
import { ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { MovementService } from "./movements.service";

const summaryQuerySchema = z.object({
  ownerId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type MovementsRouteOptions = {
  movementService: MovementService;
  categoryService: CategoryService;
};

export const movementsRoute: FastifyPluginAsync<MovementsRouteOptions> = async (app, options) => {
  const { movementService, categoryService } = options;

  app.get("/movements", async (request, reply) => {
    const parsed = movementFiltersSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid movement filters", parsed.error.issues);
    }
    const { ownerId, ...filters } = parsed.data;
    const movements = await movementService.listMovements(ownerId, filters);
    return reply.send(movements);
  });

  app.get("/movements/summary", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid summary query", parsed.error.issues);
    }
    const { ownerId, from, to } = parsed.data;
    const summary = await movementService.getSummary(ownerId, from, to);
    return reply.send(summary);
  });

  app.get("/movements/categories", async (request, reply) => {
    const ownerId = readQueryOwnerId(request.query);
    const categories = await categoryService.listCategories(ownerId);
    return reply.send(categories.map(({ name, keywords }) => ({ name, keywords })));
  });

  app.patch("/movements/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = readOwnerId(request.headers);
    const updated = await movementService.updateMovement(ownerId, id, request.body);
    return reply.send(updated);
  });

  app.delete("/movements/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = readOwnerId(request.headers);
    await movementService.deleteMovement(ownerId, id);
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