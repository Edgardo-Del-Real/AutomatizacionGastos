import { describe, expect, it } from "vitest";

import { hashPassword } from "./auth.service";
import type { StoredUser, UserRepository } from "./user.repository";
import { loadHousehold, seedUsers } from "./user.seed";

class MemoryRepository implements UserRepository {
  constructor(public users: StoredUser[] = []) {}

  async list(): Promise<StoredUser[]> {
    return this.users;
  }

  async findById(ownerId: string): Promise<StoredUser | null> {
    return this.users.find((user) => user.ownerId === ownerId) ?? null;
  }

  async insertIfMissing(user: StoredUser): Promise<void> {
    if (this.users.some((existing) => existing.ownerId === user.ownerId)) return;
    this.users.push(user);
  }

  async updateCredentials(ownerId: string, salt: string, hash: string): Promise<void> {
    this.users = this.users.map((user) =>
      user.ownerId === ownerId ? { ...user, salt, hash } : user,
    );
  }
}

const members = [
  { ownerId: "default", name: "Edgardo", chatId: 8677364917 },
  { ownerId: "rita", name: "Rita", chatId: 8692918962 },
];

const credentials = [
  { ownerId: "default", salt: "aa11", hash: hashPassword("uno", "aa11") },
  { ownerId: "rita", salt: "bb22", hash: hashPassword("dos", "bb22") },
];

describe("seedUsers", () => {
  it("inserts every household member with its chat id and credentials", async () => {
    const repository = new MemoryRepository();
    await seedUsers(repository, { members, credentials });

    expect(repository.users).toHaveLength(2);
    expect(repository.users[0]).toMatchObject({
      ownerId: "default",
      name: "Edgardo",
      chatId: "8677364917",
      salt: "aa11",
    });
  });

  it("never overwrites an existing row (a changed password survives boot)", async () => {
    const existing: StoredUser = {
      ownerId: "rita",
      name: "Rita",
      chatId: "8692918962",
      salt: "zz99",
      hash: hashPassword("clave-cambiada", "zz99"),
    };
    const repository = new MemoryRepository([existing]);

    await seedUsers(repository, { members, credentials });

    expect(repository.users).toHaveLength(2);
    expect(repository.users.find((user) => user.ownerId === "rita")).toEqual(existing);
  });

  it("fails loudly when a household member has no credentials", async () => {
    const repository = new MemoryRepository();
    await expect(
      seedUsers(repository, { members, credentials: [credentials[0]!] }),
    ).rejects.toThrow(/AUTH_USERS has no credentials for household member "rita"/);
  });
});

describe("loadHousehold", () => {
  it("maps database rows to household members", async () => {
    const repository = new MemoryRepository([
      {
        ownerId: "rita",
        name: "Rita",
        chatId: "8692918962",
        salt: "bb22",
        hash: hashPassword("dos", "bb22"),
      },
    ]);

    expect(await loadHousehold(repository, members)).toEqual([
      { ownerId: "rita", name: "Rita", chatId: 8692918962 },
    ]);
  });

  it("falls back to the given members when the table is empty", async () => {
    expect(await loadHousehold(new MemoryRepository(), members)).toEqual(members);
  });
});
