import type { FastifyPluginAsync } from "fastify";
import {
  movementFiltersSchema,
  monthKeySchema,
  visibilityFilterSchema,
  type VisibilityFilter,
} from "@rita/contracts";
import { z } from "zod";
import { ValidationFailedError } from "../../infra/errors";
import { readOptionalOwnerId, readOptionalOwnerHeader, resolveOwnerId } from "../auth/auth.identity";
import type { CategoryService } from "../categories/categories.service";
import type { HouseholdService } from "../household/household.service";
import type { MovementService } from "./movements.service";
import type { ViewerScope } from "./movements.types";

// monthly-dashboard: `month` is the ONE period concept. A malformed key is a
// 422 instead of a silent unscoped read; omitting the key is the explicit
// lifetime request (the bot's balance query).
const summaryQuerySchema = z
  .object({
    ownerId: z.string().min(1).optional(),
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
    const { ownerId: legacyOwnerId, visibility, ...filters } = parsed.data;
    const ownerId = resolveOwnerId(request, legacyOwnerId);
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
    const { ownerId: legacyOwnerId, month, visibility } = parsed.data;
    const ownerId = resolveOwnerId(request, legacyOwnerId);
    const scope = buildViewerScope(householdService, ownerId, visibility);
    const summary = await movementService.getSummary(scope, month);
    return reply.send(summary);
  });

  app.get("/movements/categories", async (request, reply) => {
    const ownerId = resolveOwnerId(request, readOptionalOwnerId(request.query));
    const categories = await categoryService.listCategories(ownerId);
    return reply.send(categories.map(({ name, keywords, type }) => ({ name, keywords, type })));
  });

  app.patch("/movements/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = resolveOwnerId(request, readOptionalOwnerHeader(request.headers));
    const updated = await movementService.updateMovement(ownerId, id, request.body);
    return reply.send(updated);
  });

  // D5 — mark-paid transition: scoped by the x-owner-id header; the movement
  // must be a PENDING EXPENSE (404 missing/other owner, 409 otherwise).
  app.post("/movements/:id/paid", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = resolveOwnerId(request, readOptionalOwnerHeader(request.headers));
    const paid = await movementService.markMovementPaid(ownerId, id);
    return reply.send(paid);
  });

  app.delete("/movements/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = resolveOwnerId(request, readOptionalOwnerHeader(request.headers));
    await movementService.deleteMovement(ownerId, id);
    return reply.status(204).send();
  });
};

