import type { PrismaClient } from "@prisma/client";

/** The row every auth decision reads. Passwords are stored as scrypt hashes. */
export type StoredUser = {
  ownerId: string;
  name: string;
  chatId: string;
  salt: string;
  hash: string;
};

/**
 * household-isolation: the database is the source of truth for who exists and
 * what their password is. The deploy env only seeds this table once.
 */
export interface UserRepository {
  list(): Promise<StoredUser[]>;
  findById(ownerId: string): Promise<StoredUser | null>;
  /** Inserts the user when absent; NEVER overwrites (a changed password survives restarts). */
  insertIfMissing(user: StoredUser): Promise<void>;
  updateCredentials(ownerId: string, salt: string, hash: string): Promise<void>;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<StoredUser[]> {
    const rows = await this.prisma.user.findMany({ orderBy: { ownerId: "asc" } });
    return rows.map(toStoredUser);
  }

  async findById(ownerId: string): Promise<StoredUser | null> {
    const row = await this.prisma.user.findUnique({ where: { ownerId } });
    return row === null ? null : toStoredUser(row);
  }

  async insertIfMissing(user: StoredUser): Promise<void> {
    await this.prisma.user.upsert({
      where: { ownerId: user.ownerId },
      create: user,
      // Empty update: upsert needs one, and we must not touch an existing row.
      update: {},
    });
  }

  async updateCredentials(ownerId: string, salt: string, hash: string): Promise<void> {
    await this.prisma.user.update({ where: { ownerId }, data: { salt, hash } });
  }
}

function toStoredUser(row: {
  ownerId: string;
  name: string;
  chatId: string;
  salt: string;
  hash: string;
}): StoredUser {
  return {
    ownerId: row.ownerId,
    name: row.name,
    chatId: row.chatId,
    salt: row.salt,
    hash: row.hash,
  };
}
