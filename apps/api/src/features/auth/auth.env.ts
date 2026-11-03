import { parseAuthUsers, type AuthCredential } from "./auth.config";

/**
 * online-access: auth is mandatory at boot. A missing or malformed AUTH_USERS
 * must stop the process instead of silently serving the household data to
 * anyone who guesses the URL.
 */
export type AuthEnv = {
  users: AuthCredential[];
  secret: string;
};

export function parseAuthEnv(source: Record<string, string | undefined>): AuthEnv {
  const users = source.AUTH_USERS;
  const secret = source.AUTH_SECRET;
  if (users === undefined || users.trim() === "") {
    throw new Error(
      "AUTH_USERS is required. Generate entries with: node scripts/hash-password.mjs <ownerId> <password>",
    );
  }
  if (secret === undefined || secret.length < 32) {
    throw new Error("AUTH_SECRET is required and must be at least 32 characters");
  }
  return { users: parseAuthUsers(users), secret };
}
