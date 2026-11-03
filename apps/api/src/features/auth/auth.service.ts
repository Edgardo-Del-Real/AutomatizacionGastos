import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { AuthCredential } from "./auth.config";

export const SESSION_COOKIE = "rita_session";
const SCRYPT_KEYLEN = 32;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionPayload = { ownerId: string; expiresAt: number };

export type AuthServiceOptions = {
  credentials: AuthCredential[];
  /** HMAC key for the session token. Must be long and secret. */
  secret: string;
  /** TTL in ms; defaults to 30 days. */
  ttlMs?: number;
  /** `now` is injectable so the token TTL is testable. */
  now?: () => number;
};

/** Derived hash for a password + salt, hex encoded (shared with the CLI script). */
export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Sessions are stateless: a signed payload in a httpOnly cookie. There is no
 * session table to migrate, and a logout is just clearing the cookie — fine
 * for a two-person household, and it keeps the deploy free tier stateless.
 */
export class AuthService {
  private readonly credentials: Map<string, AuthCredential>;
  private readonly secret: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: AuthServiceOptions) {
    this.credentials = new Map(options.credentials.map((c) => [c.ownerId, c]));
    this.secret = options.secret;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** True when the ownerId exists and the password derives the stored hash. */
  verifyPassword(ownerId: string, password: string): boolean {
    const credential = this.credentials.get(ownerId);
    if (credential === undefined) {
      // Still spend the work: a fast "unknown user" leak is a login oracle.
      hashPassword(password, newSalt());
      return false;
    }
    const expected = Buffer.from(credential.hash, "hex");
    const actual = Buffer.from(hashPassword(password, credential.salt), "hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  issueToken(ownerId: string): string {
    const payload: SessionPayload = { ownerId, expiresAt: this.now() + this.ttlMs };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${this.sign(encoded)}`;
  }

  /** Returns the payload of a valid, unexpired token; null otherwise. */
  readToken(token: string | undefined): SessionPayload | null {
    if (token === undefined || token === "") return null;
    const separator = token.lastIndexOf(".");
    if (separator <= 0) return null;
    const encoded = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = Buffer.from(this.sign(encoded));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      const { ownerId, expiresAt } = parsed as Partial<SessionPayload>;
      if (typeof ownerId !== "string" || typeof expiresAt !== "number") return null;
      if (expiresAt <= this.now()) return null;
      if (!this.credentials.has(ownerId)) return null;
      return { ownerId, expiresAt };
    } catch {
      return null;
    }
  }

  cookieOptions(): { httpOnly: true; sameSite: "lax"; path: "/"; secure: boolean; maxAge: number } {
    return {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Secure is required in production (HTTPS through Vercel) and would break
      // plain http on the local box, so it is opt-in through the env.
      secure: process.env.AUTH_COOKIE_SECURE === "true",
      maxAge: Math.floor(this.ttlMs / 1000),
    };
  }

  private sign(encoded: string): string {
    return createHmac("sha256", this.secret).update(encoded).digest("base64url");
  }
}
