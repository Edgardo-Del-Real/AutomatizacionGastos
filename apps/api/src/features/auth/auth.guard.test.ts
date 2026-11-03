import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { AuthService } from "./auth.service";
import { registerAuthGuard } from "./auth.route";

/**
 * household-isolation: the granted view must apply to reads only. This is the
 * security boundary of the feature, so it is asserted on the guard itself
 * instead of through a route that would need a database.
 */
const auth = new AuthService({ secret: "s".repeat(32) });

function makeApp(activeTarget: (requesterId: string) => Promise<string | null>) {
  const app = Fastify();
  registerAuthGuard(app, auth, { activeTarget });
  const echo = async (request: FastifyRequest) =>
    (request as unknown as { viewer?: unknown }).viewer;
  app.get("/view", echo);
  app.post("/view", echo);
  app.delete("/view", echo);
  return app;
}

const cookie = `rita_session=${auth.issueToken("default")}`;

describe("registerAuthGuard", () => {
  it("decorates the session owner and the granted view on reads", async () => {
    const app = makeApp(async () => "rita");
    const response = await app.inject({ method: "GET", url: "/view", headers: { cookie } });
    expect(response.json()).toEqual({ ownerId: "default", viewAs: "rita" });
  });

  it("never grants a view on writes (read-only by construction)", async () => {
    const app = makeApp(async () => "rita");
    for (const method of ["POST", "DELETE"] as const) {
      const response = await app.inject({ method, url: "/view", headers: { cookie } });
      expect(response.json()).toEqual({ ownerId: "default", viewAs: null });
    }
  });

  it("does not ask for a grant when there is none", async () => {
    const app = makeApp(async () => null);
    const response = await app.inject({ method: "GET", url: "/view", headers: { cookie } });
    expect(response.json()).toEqual({ ownerId: "default", viewAs: null });
  });

  it("rejects a request without a session", async () => {
    const app = makeApp(async () => "rita");
    const response = await app.inject({ method: "GET", url: "/view" });
    expect(response.statusCode).toBe(401);
  });
});
