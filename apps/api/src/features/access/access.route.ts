import { accessStatusSchema } from "@rita/contracts";
import type { FastifyPluginAsync } from "fastify";

import { sessionOwnerId } from "../auth/auth.identity";
import type { AccessService } from "./access.service";

export type AccessRouteOptions = { access: AccessService };

function iso(value: Date): string {
  return value.toISOString();
}

/**
 * household-isolation: the dashboard's side of the permission. Decisions never
 * come through here — they arrive from the target's Telegram chat.
 */
export const accessRoute: FastifyPluginAsync<AccessRouteOptions> = async (app, options) => {
  const { access } = options;

  app.post("/access/requests", async (request, reply) => {
    const ownerId = sessionOwnerId(request);
    const result = await access.requestAccess(ownerId);
    return reply.status(201).send({
      requestId: result.requestId,
      targetOwnerId: result.targetOwnerId,
      expiresAt: iso(result.expiresAt),
    });
  });

  app.get("/access", async (request, reply) => {
    const ownerId = sessionOwnerId(request);
    const status = await access.status(ownerId);
    return reply.send(
      accessStatusSchema.parse({
        grant:
          status.grant === null
            ? null
            : { targetOwnerId: status.grant.targetOwnerId, expiresAt: iso(status.grant.expiresAt) },
        pending:
          status.pending === null
            ? null
            : {
                requestId: status.pending.requestId,
                targetOwnerId: status.pending.targetOwnerId,
                expiresAt: iso(status.pending.expiresAt),
              },
      }),
    );
  });

  app.delete("/access", async (request, reply) => {
    const ownerId = sessionOwnerId(request);
    await access.revoke(ownerId);
    return reply.status(204).send();
  });

  app.get("/access/history", async (request, reply) => {
    const ownerId = sessionOwnerId(request);
    const grants = await access.history(ownerId);
    return reply.send(
      grants.map((grant) => ({
        requesterId: grant.requesterId,
        createdAt: iso(grant.createdAt),
        expiresAt: iso(grant.expiresAt),
        revokedAt: grant.revokedAt === null ? null : iso(grant.revokedAt),
      })),
    );
  });
};
