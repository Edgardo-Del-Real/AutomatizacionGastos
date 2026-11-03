import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "../../infra/errors";
import type { HouseholdService } from "../household/household.service";
import { movementsRoute } from "../movements/movements.route";

/**
 * online-access regression: the route used to read `?ownerId=` straight from
 * the query. With a session that is impersonation, so the wiring is asserted
 * here with a stub service (no DB) — the exact bug that shipped once already.
 */
const household = {
  partnerOf: () => "rita",
} as unknown as HouseholdService;

function makeApp(captured: { call?: unknown }) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  // Stand-in for the auth guard: decorates the session owner.
  app.decorateRequest("viewer", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as { viewer: { ownerId: string } }).viewer = { ownerId: "default" };
  });
  const movementService = {
    listMovements: vi.fn(async (scope: unknown, filters: unknown) => {
      captured.call = { scope, filters };
      return [];
    }),
    getSummary: vi.fn(async () => ({})),
  };
  void app.register(movementsRoute, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    movementService: movementService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categoryService: { listCategories: vi.fn(async () => []) } as any,
    householdService: household,
  });
  return app;
}

describe("movements route with a session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores ?ownerId= and scopes the list to the session owner", async () => {
    const captured: { call?: unknown } = {};
    const app = makeApp(captured);

    const response = await app.inject({
      method: "GET",
      url: "/movements?ownerId=rita&visibility=mine&month=2026-11",
    });

    expect(response.statusCode).toBe(200);
    const call = captured.call as { scope: { viewerId: string; partnerId: string } };
    expect(call.scope.viewerId).toBe("default");
    expect(call.scope.partnerId).toBe("rita");
    await app.close();
  });

  it("ignores ?ownerId= on the summary too", async () => {
    const captured: { call?: unknown } = {};
    const app = makeApp(captured);
    const summaryApp = Fastify();
    summaryApp.setErrorHandler(errorHandler);
    summaryApp.decorateRequest("viewer", null);
    const getSummary = vi.fn(async (scope: unknown) => {
      captured.call = { scope };
      return {
        kpis: {
          income: 0,
          expenses: 0,
          balance: 0,
          savings: 0,
          manualSavings: 0,
          avgPerMonth: 0,
          avgPerMovement: 0,
          maxAmount: 0,
          count: 0,
        },
        daily: [],
        categories: [],
        top: { expenses: [], income: [] },
        planned: { total: 0, movements: [] },
      };
    });
    summaryApp.addHook("onRequest", async (request) => {
      (request as unknown as { viewer: { ownerId: string } }).viewer = { ownerId: "default" };
    });
    void summaryApp.register(movementsRoute, {
      movementService: { getSummary } as never,
      categoryService: { listCategories: vi.fn(async () => []) } as never,
      householdService: household,
    });

    const response = await summaryApp.inject({
      method: "GET",
      url: "/movements/summary?ownerId=rita&month=2026-11",
    });

    expect(response.statusCode).toBe(200);
    const call = captured.call as { scope: { viewerId: string } };
    expect(call.scope.viewerId).toBe("default");
    expect(getSummary).toHaveBeenCalledTimes(1);
    await app.close();
    await summaryApp.close();
  });
});
