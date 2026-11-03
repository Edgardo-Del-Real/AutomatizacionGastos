import { changePasswordSchema, loginSchema, sessionSchema } from "@rita/contracts";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { UnauthorizedError, ValidationFailedError } from "../../infra/errors";
import { SESSION_COOKIE, type AuthService } from "./auth.service";
import type { UserService } from "./user.service";

export type AuthRouteOptions = { auth: AuthService; users: UserService };

/** Reads the session cookie without pulling a cookie plugin for 1 value. */
export function readSessionCookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function serializeCookie(value: string, options: ReturnType<AuthService["cookieOptions"]>): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The guard skips every `/auth/*` path, so the routes that need a session
 * resolve it themselves.
 */
function requireOwnerId(request: FastifyRequest, auth: AuthService): string {
  const payload = auth.readToken(readSessionCookie(request));
  if (payload === null) throw new UnauthorizedError("Sin sesión");
  return payload.ownerId;
}

export const authRoute: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  const { auth, users } = options;

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid login payload", parsed.error.issues);
    }
    const { ownerId, password } = parsed.data;
    const user = await users.authenticate(ownerId, password);
    if (user === null) {
      // One generic message: never reveal whether the owner exists.
      return reply.status(401).send({ code: "Unauthorized", message: "Credenciales inválidas" });
    }
    const token = auth.issueToken(user.ownerId);
    reply.header("set-cookie", serializeCookie(token, auth.cookieOptions()));
    return reply.send(sessionSchema.parse({ ownerId: user.ownerId, name: user.name }));
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.header("set-cookie", serializeCookie("", { ...auth.cookieOptions(), maxAge: 0 }));
    return reply.status(204).send();
  });

  app.get("/auth/session", async (request, reply) => {
    const ownerId = requireOwnerId(request, auth);
    // The row is the source of truth: a user that no longer exists has no session.
    const user = await users.findPublic(ownerId);
    if (user === null) {
      return reply.status(401).send({ code: "Unauthorized", message: "Sin sesión" });
    }
    return reply.send(sessionSchema.parse(user));
  });

  app.post("/auth/password", async (request, reply) => {
    const ownerId = requireOwnerId(request, auth);
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid password payload", parsed.error.issues);
    }
    const result = await users.changePassword(
      ownerId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (result === "missing") {
      return reply.status(401).send({ code: "Unauthorized", message: "Sin sesión" });
    }
    if (result === "wrong-current") {
      return reply
        .status(401)
        .send({ code: "Unauthorized", message: "La contraseña actual no es correcta" });
    }
    if (result === "same-password") {
      return reply
        .status(422)
        .send({ code: "ValidationFailed", message: "La nueva contraseña es igual a la actual" });
    }
    return reply.status(204).send();
  });
};

/**
 * Guard for every data route. `/health` and the auth routes stay open.
 * On success the owner id is decorated on the request, and the legacy
 * `?ownerId=` / `x-owner-id` inputs stop meaning anything.
 */
export function registerAuthGuard(app: FastifyInstance, auth: AuthService): void {
  app.decorateRequest("viewer", null);
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split("?")[0] ?? "";
    if (path === "/health" || path.startsWith("/auth/")) return;
    const payload = auth.readToken(readSessionCookie(request));
    if (payload === null) {
      await reply.status(401).send({ code: "Unauthorized", message: "Sesión requerida" });
      return;
    }
    (request as FastifyRequest & { viewer: { ownerId: string } }).viewer = { ownerId: payload.ownerId };
  });
}
