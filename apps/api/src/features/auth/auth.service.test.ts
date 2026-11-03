import { describe, expect, it } from "vitest";

import { parseAuthUsers } from "./auth.config";
import { AuthService, hashPassword, newSalt } from "./auth.service";

function makeService(overrides: Partial<{ ttlMs: number; now: () => number }> = {}) {
  return new AuthService({ secret: "x".repeat(32), ...overrides });
}

describe("AuthService tokens", () => {
  it("round-trips the owner id", () => {
    const service = makeService();
    const payload = service.readToken(service.issueToken("rita"));
    expect(payload?.ownerId).toBe("rita");
  });

  it("rejects a tampered signature", () => {
    const service = makeService();
    const token = service.issueToken("rita");
    const broken = `${token.slice(0, -2)}xx`;
    expect(service.readToken(broken)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const service = makeService();
    const [, signature] = service.issueToken("rita").split(".");
    const forged = Buffer.from(
      JSON.stringify({ ownerId: "default", expiresAt: Date.now() + 1000 }),
    ).toString("base64url");
    expect(service.readToken(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    let clock = 1_000_000;
    const service = makeService({ ttlMs: 1000, now: () => clock });
    const token = service.issueToken("rita");
    clock += 2000;
    expect(service.readToken(token)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const mine = makeService();
    const other = new AuthService({ secret: "y".repeat(32) });
    expect(other.readToken(mine.issueToken("rita"))).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    const service = makeService();
    for (const value of ["", "sin-punto", "a.b.c", "...."]) {
      expect(service.readToken(value)).toBeNull();
    }
  });
});

describe("password helpers", () => {
  it("derives a stable hash for the same password and salt", () => {
    expect(hashPassword("secreto", "aa11")).toBe(hashPassword("secreto", "aa11"));
  });

  it("derives different hashes for different salts", () => {
    expect(hashPassword("secreto", "aa11")).not.toBe(hashPassword("secreto", "bb22"));
  });

  it("generates a fresh 32-char salt", () => {
    const salt = newSalt();
    expect(salt).toHaveLength(32);
    expect(newSalt()).not.toBe(salt);
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
