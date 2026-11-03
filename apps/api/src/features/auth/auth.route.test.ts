import { describe, expect, it } from "vitest";

import { buildApp } from "../../app";
import { AuthService, SESSION_COOKIE, hashPassword } from "./auth.service";
import type { StoredUser, UserRepository } from "./user.repository";
import { UserService } from "./user.service";

/** In-memory repository: these tests must not touch the database. */
class FakeUserRepository implements UserRepository {
  constructor(private users: StoredUser[]) {}

  async list(): Promise<StoredUser[]> {
    return this.users;
  }

  async findById(ownerId: string): Promise<StoredUser | null> {
    return this.users.find((user) => user.ownerId === ownerId) ?? null;
  }

  async insertIfMissing(user: StoredUser): Promise<void> {
    if (this.users.some((existing) => existing.ownerId === user.ownerId)) return;
    this.users.push(user);
  }

  async updateCredentials(ownerId: string, salt: string, hash: string): Promise<void> {
    this.users = this.users.map((user) =>
      user.ownerId === ownerId ? { ...user, salt, hash } : user,
    );
  }
}

const users = new FakeUserRepository([
  {
    ownerId: "rita",
    name: "Rita",
    chatId: "8692918962",
    salt: "aa11",
    hash: hashPassword("clave-rita", "aa11"),
  },
  {
    ownerId: "default",
    name: "Edgardo",
    chatId: "8677364917",
    salt: "bb22",
    hash: hashPassword("clave-edgardo", "bb22"),
  },
]);

const auth = new AuthService({ secret: "s".repeat(32) });

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const raw = Array.isArray(header) ? header[0] : String(header);
  return raw.split(";")[0]!;
}

function makeApp() {
  return buildApp({ auth, users: new UserService(users) });
}

describe("auth guard", () => {
  const app = makeApp();

  it("keeps /health open", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });

  it("rejects a data route without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/household/members" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a forged cookie", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/household/members",
      headers: { cookie: `${SESSION_COOKIE}=basura.basura` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a wrong password without revealing whether the owner exists", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "nadie", password: "x" },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "rita", password: "x" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
  });

  it("logs in, reads the session, opens a data route and logs out", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "rita", password: "clave-rita" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ownerId: "rita", name: "Rita" });
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);

    const cookie = cookieFrom(login);
    const session = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ ownerId: "rita", name: "Rita" });

    const members = await app.inject({
      method: "GET",
      url: "/household/members",
      headers: { cookie },
    });
    expect(members.statusCode).toBe(200);

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toMatch(/Max-Age=0/);
  });

  it("reports no session without a cookie", async () => {
    const response = await app.inject({ method: "GET", url: "/auth/session" });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /auth/password", () => {
  it("changes the password and the old one stops working", async () => {
    const app = makeApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "default", password: "clave-edgardo" },
    });
    const cookie = cookieFrom(login);

    const changed = await app.inject({
      method: "POST",
      url: "/auth/password",
      headers: { cookie },
      payload: { currentPassword: "clave-edgardo", newPassword: "nueva-clave-1" },
    });
    expect(changed.statusCode).toBe(204);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "default", password: "clave-edgardo" },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "default", password: "nueva-clave-1" },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("rejects a wrong current password", async () => {
    const app = makeApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "rita", password: "clave-rita" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/password",
      headers: { cookie: cookieFrom(login) },
      payload: { currentPassword: "otra", newPassword: "nueva-clave-1" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a new password shorter than 8 characters", async () => {
    const app = makeApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "rita", password: "clave-rita" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/password",
      headers: { cookie: cookieFrom(login) },
      payload: { currentPassword: "clave-rita", newPassword: "corta" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("requires a session", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/password",
      payload: { currentPassword: "clave-rita", newPassword: "nueva-clave-1" },
    });
    expect(response.statusCode).toBe(401);
  });
});
