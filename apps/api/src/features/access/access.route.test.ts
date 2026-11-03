import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../app";
import { AuthService, hashPassword } from "../auth/auth.service";
import type { StoredUser, UserRepository } from "../auth/user.repository";
import { UserService } from "../auth/user.service";
import type { AccessService } from "./access.service";

const users: StoredUser[] = [
  {
    ownerId: "default",
    name: "Edgardo",
    chatId: "111",
    salt: "aa11",
    hash: hashPassword("clave", "aa11"),
  },
];

const userRepository: UserRepository = {
  list: async () => users,
  findById: async (ownerId) => users.find((user) => user.ownerId === ownerId) ?? null,
  insertIfMissing: async () => undefined,
  updateCredentials: async () => undefined,
};

const auth = new AuthService({ secret: "s".repeat(32) });

function makeAccessStub() {
  return {
    requestAccess: vi.fn(async () => ({
      requestId: "req-1",
      targetOwnerId: "rita",
      expiresAt: new Date("2026-11-03T20:10:00Z"),
    })),
    status: vi.fn(async () => ({
      grant: {
        targetOwnerId: "rita",
        expiresAt: new Date("2026-11-03T20:30:00Z"),
      },
      pending: null,
    })),
    revoke: vi.fn(async () => undefined),
    history: vi.fn(async () => [
      {
        id: "grant-1",
        requesterId: "default",
        targetOwnerId: "rita",
        createdAt: new Date("2026-11-03T20:00:00Z"),
        expiresAt: new Date("2026-11-03T20:30:00Z"),
        revokedAt: null,
      },
    ]),
    activeTarget: vi.fn(async () => null),
  };
}

async function makeApp() {
  const access = makeAccessStub();
  const app = buildApp({
    auth,
    users: new UserService(userRepository),
    access: access as unknown as AccessService,
  });
  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { ownerId: "default", password: "clave" },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  return { app, access, cookie };
}

describe("/access routes", () => {
  it("posts a request for the session owner", async () => {
    const { app, access, cookie } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/access/requests",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      requestId: "req-1",
      targetOwnerId: "rita",
      expiresAt: "2026-11-03T20:10:00.000Z",
    });
    expect(access.requestAccess).toHaveBeenCalledWith("default");
  });

  it("reports the active grant", async () => {
    const { app, cookie } = await makeApp();
    const response = await app.inject({ method: "GET", url: "/access", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      grant: { targetOwnerId: "rita", expiresAt: "2026-11-03T20:30:00.000Z" },
      pending: null,
    });
  });

  it("revokes with 204", async () => {
    const { app, access, cookie } = await makeApp();
    const response = await app.inject({ method: "DELETE", url: "/access", headers: { cookie } });
    expect(response.statusCode).toBe(204);
    expect(access.revoke).toHaveBeenCalledWith("default");
  });

  it("returns the viewing history", async () => {
    const { app, cookie } = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/access/history",
      headers: { cookie },
    });
    expect(response.json()).toEqual([
      {
        requesterId: "default",
        createdAt: "2026-11-03T20:00:00.000Z",
        expiresAt: "2026-11-03T20:30:00.000Z",
        revokedAt: null,
      },
    ]);
  });

  it("requires a session", async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: "GET", url: "/access" });
    expect(response.statusCode).toBe(401);
  });
});
