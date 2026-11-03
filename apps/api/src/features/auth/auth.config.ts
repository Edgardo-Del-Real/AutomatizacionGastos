import { z } from "zod";

/**
 * One credential entry: `<ownerId>:<saltHex>:<scryptHashHex>`.
 *
 * Passwords are never stored in the repo or the database: the deploy env
 * carries the derived hash, produced by `scripts/hash-password.mjs`.
 */
export const authUserEntrySchema = z.string().refine(
  (entry) => {
    const parts = entry.split(":");
    return parts.length === 3 && parts.every((part) => part.length > 0) && /^[0-9a-f]+$/.test(parts[1]!) && /^[0-9a-f]+$/.test(parts[2]!);
  },
  { message: "entry must be <ownerId>:<saltHex>:<hashHex>" },
);

export const authUsersEnvSchema = z
  .string()
  .min(1)
  .transform((value) => value.split(";").map((entry) => entry.trim()).filter((entry) => entry !== ""))
  .pipe(z.array(authUserEntrySchema).min(1));

export type AuthCredential = { ownerId: string; salt: string; hash: string };

/** Parses `AUTH_USERS` into credentials; duplicate ownerIds are rejected. */
export function parseAuthUsers(value: string): AuthCredential[] {
  const entries = authUsersEnvSchema.parse(value);
  const credentials = entries.map((entry) => {
    const [ownerId, salt, hash] = entry.split(":");
    return { ownerId: ownerId!, salt: salt!, hash: hash! };
  });
  const seen = new Set<string>();
  for (const credential of credentials) {
    if (seen.has(credential.ownerId)) {
      throw new Error(`AUTH_USERS has a duplicate ownerId: ${credential.ownerId}`);
    }
    seen.add(credential.ownerId);
  }
  return credentials;
}
