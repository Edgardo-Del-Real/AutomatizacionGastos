import type { AuthCredential } from "./auth.config";
import type { HouseholdMember } from "../household/household.config";
import type { UserRepository } from "./user.repository";

export type SeedSource = {
  /** Parsed HOUSEHOLD_MEMBERS (or the degraded single-user fallback). */
  members: HouseholdMember[];
  /** Parsed AUTH_USERS. */
  credentials: AuthCredential[];
};

/**
 * household-isolation: one-time bootstrap from the deploy env into the `User`
 * table. Insert-if-missing, so a password changed from the profile survives
 * restarts and redeploys.
 *
 * A household member without credentials is a hard boot error: they would be
 * unreachable through the bot and unable to log in, and the operator would
 * only find out when they tried.
 */
export async function seedUsers(repository: UserRepository, source: SeedSource): Promise<void> {
  const credentials = new Map(source.credentials.map((entry) => [entry.ownerId, entry]));

  for (const member of source.members) {
    const credential = credentials.get(member.ownerId);
    if (credential === undefined) {
      throw new Error(
        `AUTH_USERS has no credentials for household member "${member.ownerId}". ` +
          "Generate them with: node scripts/hash-password.mjs <ownerId> <password>",
      );
    }
    await repository.insertIfMissing({
      ownerId: member.ownerId,
      name: member.name,
      chatId: String(member.chatId),
      salt: credential.salt,
      hash: credential.hash,
    });
  }
}

/**
 * The household the bot resolves chats against. It comes from the database, so
 * the env is only ever a seed — with the one exception of the degraded
 * single-user fallback, which the caller passes in when the table is empty.
 */
export async function loadHousehold(
  repository: UserRepository,
  fallback: HouseholdMember[],
): Promise<HouseholdMember[]> {
  const users = await repository.list();
  if (users.length === 0) return fallback;
  return users.map((user) => ({
    ownerId: user.ownerId,
    name: user.name,
    chatId: Number(user.chatId),
  }));
}
