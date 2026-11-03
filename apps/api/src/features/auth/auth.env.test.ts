import { describe, expect, it } from "vitest";

import { parseAuthEnv } from "./auth.env";
import { hashPassword } from "./auth.service";

const USERS = `rita:aa11:${hashPassword("clave-rita", "aa11")};default:bb22:${hashPassword("clave-edgardo", "bb22")}`;
const SECRET = "s".repeat(32);

describe("parseAuthEnv", () => {
  it("parses users and secret", () => {
    const parsed = parseAuthEnv({ AUTH_USERS: USERS, AUTH_SECRET: SECRET });
    expect(parsed.users.map((user) => user.ownerId)).toEqual(["rita", "default"]);
    expect(parsed.secret).toBe(SECRET);
  });

  it("refuses to boot without AUTH_USERS", () => {
    expect(() => parseAuthEnv({ AUTH_SECRET: SECRET })).toThrow(/AUTH_USERS is required/);
    expect(() => parseAuthEnv({ AUTH_USERS: "   ", AUTH_SECRET: SECRET })).toThrow(/AUTH_USERS/);
  });

  it("refuses a short secret", () => {
    expect(() => parseAuthEnv({ AUTH_USERS: USERS, AUTH_SECRET: "corto" })).toThrow(/AUTH_SECRET/);
    expect(() => parseAuthEnv({ AUTH_USERS: USERS })).toThrow(/AUTH_SECRET/);
  });

  it("propagates malformed entries", () => {
    expect(() => parseAuthEnv({ AUTH_USERS: "rita:roto", AUTH_SECRET: SECRET })).toThrow();
  });
});
