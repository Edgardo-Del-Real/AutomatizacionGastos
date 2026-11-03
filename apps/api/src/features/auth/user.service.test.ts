import { describe, expect, it } from "vitest";

import { hashPassword } from "./auth.service";
import type { StoredUser, UserRepository } from "./user.repository";
import { UserService } from "./user.service";

class MemoryRepository implements UserRepository {
  constructor(public users: StoredUser[]) {}

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

function ritaRow(): StoredUser {
  return {
    ownerId: "rita",
    name: "Rita",
    chatId: "8692918962",
    salt: "aa11",
    hash: hashPassword("clave-rita", "aa11"),
  };
}

describe("UserService.authenticate", () => {
  it("returns the user on the right password", async () => {
    const service = new UserService(new MemoryRepository([ritaRow()]));
    const user = await service.authenticate("rita", "clave-rita");
    expect(user?.name).toBe("Rita");
  });

  it("returns null on a wrong password", async () => {
    const service = new UserService(new MemoryRepository([ritaRow()]));
    expect(await service.authenticate("rita", "otra")).toBeNull();
  });

  it("returns null for an unknown owner", async () => {
    const service = new UserService(new MemoryRepository([ritaRow()]));
    expect(await service.authenticate("nadie", "clave-rita")).toBeNull();
  });
});

describe("UserService.changePassword", () => {
  it("updates the stored hash and keeps the name", async () => {
    const repository = new MemoryRepository([ritaRow()]);
    const service = new UserService(repository);

    expect(await service.changePassword("rita", "clave-rita", "clave-nueva-1")).toBe("ok");

    expect(await service.authenticate("rita", "clave-rita")).toBeNull();
    const updated = await service.authenticate("rita", "clave-nueva-1");
    expect(updated?.name).toBe("Rita");
  });

  it("rejects a wrong current password without touching the row", async () => {
    const repository = new MemoryRepository([ritaRow()]);
    const service = new UserService(repository);
    const before = repository.users[0]!.hash;

    expect(await service.changePassword("rita", "otra", "clave-nueva-1")).toBe("wrong-current");
    expect(repository.users[0]!.hash).toBe(before);
  });

  it("rejects reusing the same password", async () => {
    const service = new UserService(new MemoryRepository([ritaRow()]));
    expect(await service.changePassword("rita", "clave-rita", "clave-rita")).toBe("same-password");
  });

  it("reports a missing user", async () => {
    const service = new UserService(new MemoryRepository([]));
    expect(await service.changePassword("rita", "clave-rita", "clave-nueva-1")).toBe("missing");
  });
});

describe("UserService.listPublic", () => {
  it("never exposes the hash, salt or chatId", async () => {
    const service = new UserService(new MemoryRepository([ritaRow()]));
    const [user] = await service.listPublic();
    expect(user).toEqual({ ownerId: "rita", name: "Rita" });
  });
});
