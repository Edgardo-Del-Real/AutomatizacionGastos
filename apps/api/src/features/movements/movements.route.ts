import type { IncomingHttpHeaders } from "node:http";
import type { FastifyPluginAsync } from "fastify";
import {
  movementFiltersSchema,
  monthKeySchema,
  visibilityFilterSchema,
  type VisibilityFilter,
} from "@rita/contracts";
import { z } from "zod";
import { ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { HouseholdService } from "../household/household.service";
import type { MovementService } from "./movements.service";
import type { ViewerScope } from "./movements.types";

// monthly-dashboard: `month` is the ONE period concept. A malformed key is a
// 422 instead of a silent unscoped read; omitting the key is the explicit
// lifetime request (the bot's balance query).
const summaryQuerySchema = z
  .object({
    ownerId: z.string().min(1),
    month: monthKeySchema.optional(),
    visibility: visibilityFilterSchema.optional(),
  })
  .strict();

export type MovementsRouteOptions = {
  movementService: MovementService;
  categoryService: CategoryService;
  householdService: HouseholdService;
};

/**
 * Builds the viewer scope from the ownerId query param: the household answers
 * the partner lookup, and the visibility filter defaults to `mine` (the
 * viewer's own movements) per the viewer-scoped read predicate.
 */
function buildViewerScope(
  household: HouseholdService,
  viewerId: string,
  visibility: VisibilityFilter = "mine",
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
    // monthly-dashboard: previstos carry no date, so they cannot belong to a
    // month; the monthly table is PAID-only by construction. The PENDING rows
    // stay reachable through summary.planned and the mark-paid window.
    const movements = await movementService.listMovements(scope, {
      ...filters,
      status: "PAID",
    });
    return reply.send(movements);
  });

  app.get("/movements/summary", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid summary query", parsed.error.issues);
    }
    const { ownerId, month, visibility } = parsed.data;
    const scope = buildViewerScope(householdService, ownerId, visibility);
    const summary = await movementService.getSummary(scope, month);
    return reply.send(summary);
  });

  app.get("/movements/categories", async (request, reply) => {
    const ownerId = readQueryOwnerId(request.query);
    const categories = await categoryService.listCategories(ownerId);
    return reply.send(categories.map(({ name, keywords, type }) => ({ name, keywords, type })));
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