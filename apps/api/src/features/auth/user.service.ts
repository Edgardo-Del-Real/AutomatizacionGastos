import { hashPassword, newSalt } from "./auth.service";
import type { StoredUser, UserRepository } from "./user.repository";

export type PublicUser = { ownerId: string; name: string };

export type ChangePasswordResult = "ok" | "missing" | "wrong-current" | "same-password";

/** Minimum length for a new password (the profile form mirrors this). */
export const MIN_PASSWORD_LENGTH = 8;

function hashesMatch(stored: StoredUser, password: string): boolean {
  const expected = Buffer.from(stored.hash, "hex");
  const actual = Buffer.from(hashPassword(password, stored.salt), "hex");
  if (expected.length !== actual.length) return false;
  // hashPassword is scrypt; compare without leaking timing.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected[i]! ^ actual[i]!;
  return diff === 0;
}

/**
 * household-isolation: credential handling over the database.
 *
 * Login reads the user row on every attempt (no in-memory cache) so a password
 * change takes effect immediately on every instance.
 */
export class UserService {
  constructor(private readonly repository: UserRepository) {}

  async authenticate(ownerId: string, password: string): Promise<StoredUser | null> {
    const user = await this.repository.findById(ownerId);
    if (user === null) {
      // Spend the same work on an unknown user: a fast path is a login oracle.
      hashPassword(password, newSalt());
      return null;
    }
    return hashesMatch(user, password) ? user : null;
  }

  async changePassword(
    ownerId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<ChangePasswordResult> {
    const user = await this.repository.findById(ownerId);
    if (user === null) return "missing";
    if (!hashesMatch(user, currentPassword)) return "wrong-current";
    if (currentPassword === nextPassword) return "same-password";
    const salt = newSalt();
    await this.repository.updateCredentials(ownerId, salt, hashPassword(nextPassword, salt));
    return "ok";
  }

  async findPublic(ownerId: string): Promise<PublicUser | null> {
    const user = await this.repository.findById(ownerId);
    return user === null ? null : { ownerId: user.ownerId, name: user.name };
  }

  async listPublic(): Promise<PublicUser[]> {
    const users = await this.repository.list();
    return users.map(({ ownerId, name }) => ({ ownerId, name }));
  }
}
