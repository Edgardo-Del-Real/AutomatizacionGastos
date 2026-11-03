import { describe, expect, it } from "vitest";

import { parseAuthUsers } from "./auth.config";
import { AuthService, hashPassword } from "./auth.service";

function makeService(overrides: Partial<{ ttlMs: number; now: () => number }> = {}) {
  const salt = "a1b2c3d4";
  const password = "secreto-de-rita";
  const service = new AuthService({
    credentials: [{ ownerId: "rita", salt, hash: hashPassword(password, salt) }],
    secret: "x".repeat(32),
    ...overrides,
  });
  return { service, password };
}

describe("AuthService.verifyPassword", () => {
  it("accepts the right password", () => {
    const { service, password } = makeService();
    expect(service.verifyPassword("rita", password)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const { service } = makeService();
    expect(service.verifyPassword("rita", "otra-cosa")).toBe(false);
  });

  it("rejects an unknown owner", () => {
    const { service, password } = makeService();
    expect(service.verifyPassword("desconocido", password)).toBe(false);
  });

  it("is not confused by an empty password", () => {
    const { service } = makeService();
    expect(service.verifyPassword("rita", "")).toBe(false);
  });
});

describe("AuthService tokens", () => {
  it("round-trips the owner id", () => {
    const { service } = makeService();
    const payload = service.readToken(service.issueToken("rita"));
    expect(payload?.ownerId).toBe("rita");
  });

  it("rejects a tampered signature", () => {
    const { service } = makeService();
    const token = service.issueToken("rita");
    const broken = `${token.slice(0, -2)}xx`;
    expect(service.readToken(broken)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const { service } = makeService();
    const [, signature] = service.issueToken("rita").split(".");
    const forged = Buffer.from(JSON.stringify({ ownerId: "default", expiresAt: Date.now() + 1000 })).toString("base64url");
    expect(service.readToken(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    let clock = 1_000_000;
    const { service } = makeService({ ttlMs: 1000, now: () => clock });
    const token = service.issueToken("rita");
    clock += 2000;
    expect(service.readToken(token)).toBeNull();
  });

  it("rejects a token for an owner that no longer exists", () => {
    const { service } = makeService();
    const token = service.issueToken("rita");
    const other = new AuthService({
      credentials: [{ ownerId: "default", salt: "aa", hash: hashPassword("x", "aa") }],
      secret: "x".repeat(32),
    });
    expect(other.readToken(token)).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    const { service } = makeService();
    for (const value of ["", "sin-punto", "a.b.c", "...."]) {
      expect(service.readToken(value)).toBeNull();
    }
  });
});

describe("parseAuthUsers", () => {
  it("parses entries into credentials", () => {
    const parsed = parseAuthUsers("rita:aa11:bb22;default:cc33:dd44");
    expect(parsed).toEqual([
      { ownerId: "rita", salt: "aa11", hash: "bb22" },
      { ownerId: "default", salt: "cc33", hash: "dd44" },
    ]);
  });

  it("rejects malformed entries", () => {
    expect(() => parseAuthUsers("rita:sin-hash")).toThrow();
    expect(() => parseAuthUsers("rita:zz:yy")).toThrow();
    expect(() => parseAuthUsers("")).toThrow();
  });

  it("rejects duplicate owners", () => {
    expect(() => parseAuthUsers("rita:aa:bb;rita:cc:dd")).toThrow(/duplicate/);
  });

  it("ignores whitespace around entries", () => {
    expect(parseAuthUsers(" rita:aa:bb ; default:cc:dd ")).toHaveLength(2);
  });
});
