import type { FastifyPluginAsync } from "fastify";
import { movementFiltersSchema } from "@rita/contracts";
import { z } from "zod";
import { ValidationFailedError } from "../../infra/errors";
import type { MovementService } from "./movements.service";

const summaryQuerySchema = z.object({
  ownerId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type MovementsRouteOptions = {
  movementService: MovementService;
};

export const movementsRoute: FastifyPluginAsync<MovementsRouteOptions> = async (app, options) => {
  const { movementService } = options;

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
};
