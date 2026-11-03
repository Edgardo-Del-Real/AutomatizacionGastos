import type { FastifyRequest } from "fastify";

import { UnauthorizedError } from "../../infra/errors";

type ViewerRequest = FastifyRequest & {
  viewer?: { ownerId: string; viewAs: string | null } | null;
};

/**
 * household-isolation: the ONE place a route learns who is asking.
 *
 * With auth configured, the guard has already decorated `request.viewer` from
 * the session cookie and the legacy inputs are ignored — that is what stops
 * `?ownerId=rita` from impersonating anyone.
 *
 * `viewAs` is the OTHER member whose dashboard this requester was granted (a
 * live AccessGrant). It is only ever set on reads, so a granted view can never
 * write: the write routes resolve to the session owner.
 *
 * Without auth (unit/integration tests build the app without an AuthService)
 * the legacy value is used, so the existing suite keeps exercising the routes
 * without a login round-trip. `server.ts` refuses to boot without
 * `AUTH_USERS`, so production can never take that path by accident.
 */
export function resolveOwnerId(request: FastifyRequest, legacy: string | undefined): string {
  const viewer = (request as ViewerRequest).viewer;
  if (viewer !== null && viewer !== undefined) return viewer.viewAs ?? viewer.ownerId;
  if (legacy !== undefined && legacy !== "") return legacy;
  throw new UnauthorizedError("Missing session");
}

/**
 * The session owner, ignoring any granted view. Access management and profile
 * endpoints must always talk about the person who is logged in.
 */
export function sessionOwnerId(request: FastifyRequest): string {
  const viewer = (request as ViewerRequest).viewer;
  if (viewer === null || viewer === undefined) throw new UnauthorizedError("Missing session");
  return viewer.ownerId;
}

/** Soft read of the legacy query param: absent is fine now. */
export function readOptionalOwnerId(query: unknown): string | undefined {
  const ownerId = (query as { ownerId?: unknown }).ownerId;
  if (typeof ownerId !== "string" || ownerId.length === 0) return undefined;
  return ownerId;
}

/** Soft read of the legacy header: absent is fine now. */
export function readOptionalOwnerHeader(headers: Record<string, unknown>): string | undefined {
  const ownerId = headers["x-owner-id"];
  if (typeof ownerId !== "string" || ownerId.length === 0) return undefined;
  return ownerId;
}
