import type { IncomingHttpHeaders } from "node:http";
import type { FastifyPluginAsync } from "fastify";
import { movementFiltersSchema, visibilityFilterSchema, type VisibilityFilter } from "@rita/contracts";
import { z } from "zod";
import { ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { HouseholdService } from "../household/household.service";
import type { MovementService } from "./movements.service";
import type { ViewerScope } from "./movements.types";

const summaryQuerySchema = z.object({
  ownerId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  visibility: visibilityFilterSchema.optional(),
});

export type MovementsRouteOptions = {
  movementService: MovementService;
  categoryService: CategoryService;
  householdService: HouseholdService;
};

/**
 * Builds the viewer scope from the ownerId query param: the household answers
 * the partner lookup, and the visibility filter defaults to `all` (own +
 * partner's SHARED) per the viewer-scoped read predicate.
 */
function buildViewerScope(
  household: HouseholdService,
  viewerId: string,
  visibility: VisibilityFilter = "all",
): ViewerScope {
  return { viewerId, partnerId: household.partnerOf(viewerId), visibility };
}

export const movementsRoute: FastifyPluginAsync<MovementsRouteOptions> = async (app, options) => {
  const { movementService, categoryService, householdService } = options;

  app.get("/movements", async (request, reply) => {
    const parsed = movementFiltersSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid movement filters", parsed.error.issues);
    }
    const { ownerId, visibility, ...filters } = parsed.data;
    const scope = buildViewerScope(householdService, ownerId, visibility);
    const movements = await movementService.listMovements(scope, filters);
    return reply.send(movements);
  });

  app.get("/movements/summary", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid summary query", parsed.error.issues);
    }
    const { ownerId, from, to, visibility } = parsed.data;
    const scope = buildViewerScope(householdService, ownerId, visibility);
    const summary = await movementService.getSummary(scope, from, to);
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

  // D5 — mark-paid transition: scoped by the x-owner-id header; the movement
  // must be a PENDING EXPENSE (404 missing/other owner, 409 otherwise).
  app.post("/movements/:id/paid", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = readOwnerId(request.headers);
    const paid = await movementService.markMovementPaid(ownerId, id);
    return reply.send(paid);
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