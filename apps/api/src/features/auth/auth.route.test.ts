import { describe, expect, it } from "vitest";

import { buildApp } from "../../app";
import { AuthService, SESSION_COOKIE, hashPassword } from "./auth.service";

const credentials = [
  { ownerId: "rita", salt: "aa11", hash: hashPassword("clave-rita", "aa11") },
  { ownerId: "default", salt: "bb22", hash: hashPassword("clave-edgardo", "bb22") },
];
const auth = new AuthService({ credentials, secret: "s".repeat(32) });

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const raw = Array.isArray(header) ? header[0] : String(header);
  return raw.split(";")[0]!;
}

describe("auth guard", () => {
  const app = buildApp({ auth });

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

  it("logs in, opens a data route and logs out", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ownerId: "rita", password: "clave-rita" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ownerId: "rita" });
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
    expect(session.json()).toEqual({ ownerId: "rita" });

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
