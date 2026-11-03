import { describe, expect, it, vi } from "vitest";

import { ConflictError } from "../../infra/errors";
import type { StoredUser, UserRepository } from "../auth/user.repository";
import type {
  AccessGrantRow,
  AccessRepository,
  AccessRequestRow,
  AccessRequestStatus,
  NewAccessGrant,
  NewAccessRequest,
} from "./access.repository";
import { AccessService, type Notifier } from "./access.service";

class FakeAccessRepository implements AccessRepository {
  requests: AccessRequestRow[] = [];
  grants: AccessGrantRow[] = [];
  private sequence = 0;

  async createRequest(input: NewAccessRequest): Promise<AccessRequestRow> {
    this.sequence += 1;
    const row: AccessRequestRow = {
      id: `req-${this.sequence}`,
      requesterId: input.requesterId,
      targetOwnerId: input.targetOwnerId,
      status: "PENDING",
      telegramMessageId: null,
      createdAt: new Date(),
      decidedAt: null,
      expiresAt: input.expiresAt,
    };
    this.requests.push(row);
    return row;
  }

  async findRequestById(id: string): Promise<AccessRequestRow | null> {
    return this.requests.find((row) => row.id === id) ?? null;
  }

  async findPendingRequest(requesterId: string): Promise<AccessRequestRow | null> {
    return (
      this.requests.find((row) => row.requesterId === requesterId && row.status === "PENDING") ??
      null
    );
  }

  async setRequestMessageId(id: string, messageId: number): Promise<void> {
    this.requests = this.requests.map((row) =>
      row.id === id ? { ...row, telegramMessageId: messageId } : row,
    );
  }

  async decideRequest(id: string, status: AccessRequestStatus, decidedAt: Date): Promise<void> {
    this.requests = this.requests.map((row) =>
      row.id === id ? { ...row, status, decidedAt } : row,
    );
  }

  async createGrant(input: NewAccessGrant): Promise<AccessGrantRow> {
    this.sequence += 1;
    const row: AccessGrantRow = {
      id: `grant-${this.sequence}`,
      requesterId: input.requesterId,
      targetOwnerId: input.targetOwnerId,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.grants.push(row);
    return row;
  }

  async findActiveGrant(requesterId: string, now: Date): Promise<AccessGrantRow | null> {
    return (
      this.grants.find(
        (row) => row.requesterId === requesterId && row.revokedAt === null && row.expiresAt > now,
      ) ?? null
    );
  }

  async revokeGrants(requesterId: string, revokedAt: Date): Promise<void> {
    this.grants = this.grants.map((row) =>
      row.requesterId === requesterId ? { ...row, revokedAt } : row,
    );
  }

  async listGrantsByTarget(targetOwnerId: string, limit: number): Promise<AccessGrantRow[]> {
    return this.grants.filter((row) => row.targetOwnerId === targetOwnerId).slice(0, limit);
  }
}

class FakeUsers implements UserRepository {
  constructor(private users: StoredUser[]) {}

  async list(): Promise<StoredUser[]> {
    return this.users;
  }

  async findById(ownerId: string): Promise<StoredUser | null> {
    return this.users.find((user) => user.ownerId === ownerId) ?? null;
  }

  async insertIfMissing(): Promise<void> {}

  async updateCredentials(): Promise<void> {}
}

function user(ownerId: string, name: string, chatId: string): StoredUser {
  return { ownerId, name, chatId, salt: "aa", hash: "bb" };
}

const edgardo = user("default", "Edgardo", "111");
const rita = user("rita", "Rita", "222");

function makeService(overrides: { now?: () => Date; users?: StoredUser[] } = {}) {
  const repository = new FakeAccessRepository();
  const users = new FakeUsers(overrides.users ?? [edgardo, rita]);
  type SendFn = (
    chatId: string,
    text: string,
    keyboard: { text: string; data: string }[][],
  ) => Promise<number | undefined>;
  const send = vi.fn<SendFn>(async () => 555);
  const edit = vi.fn(async () => undefined);
  const notifier: Notifier = { send, edit };
  const service = new AccessService(repository, users, notifier, {
    now: overrides.now ?? (() => new Date("2026-11-03T20:00:00Z")),
  });
  return { service, repository, send, edit };
}

const ownerOfChat = (chatId: number): string | null =>
  chatId === 222 ? "rita" : chatId === 111 ? "default" : null;

describe("AccessService.requestAccess", () => {
  it("creates a request and asks the partner with two buttons", async () => {
    const { service, repository, send } = makeService();

    const result = await service.requestAccess("default");

    expect(result.targetOwnerId).toBe("rita");
    expect(send).toHaveBeenCalledTimes(1);
    const [chatId, text, keyboard] = send.mock.calls[0]!;
    expect(chatId).toBe("222");
    expect(text).toContain("Edgardo quiere ver tu dashboard");
    expect(keyboard[0]!.map((button) => button.text)).toEqual(["Dar acceso", "Denegar"]);
    expect(repository.requests[0]?.telegramMessageId).toBe(555);
  });

  it("does not spam when a grant is already active", async () => {
    const { service, repository, send } = makeService();
    await repository.createGrant({
      requesterId: "default",
      targetOwnerId: "rita",
      expiresAt: new Date("2026-11-03T20:30:00Z"),
    });

    const result = await service.requestAccess("default");

    expect(result.targetOwnerId).toBe("rita");
    expect(send).not.toHaveBeenCalled();
  });

  it("reuses a pending request instead of creating another", async () => {
    const { service, repository, send } = makeService();
    const first = await service.requestAccess("default");
    const second = await service.requestAccess("default");

    expect(second.requestId).toBe(first.requestId);
    expect(repository.requests).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses when there is nobody else in the household", async () => {
    const { service } = makeService({ users: [edgardo] });
    await expect(service.requestAccess("default")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("AccessService.decideFromCallback", () => {
  it("approves: marks the request, creates the grant and edits the message", async () => {
    const { service, repository, edit } = makeService();
    const { requestId } = await service.requestAccess("default");

    const outcome = await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 222);

    expect(outcome).toEqual({ requesterId: "default", approved: true });
    expect(repository.requests[0]?.status).toBe("APPROVED");
    expect(repository.grants).toHaveLength(1);
    expect(repository.grants[0]?.expiresAt).toEqual(new Date("2026-11-03T20:30:00Z"));
    expect(edit).toHaveBeenCalledWith("222", 555, expect.stringContaining("Le diste acceso a Edgardo"));
  });

  it("denies without creating a grant", async () => {
    const { service, repository, edit } = makeService();
    const { requestId } = await service.requestAccess("default");

    const outcome = await service.decideFromCallback(`ac:no:${requestId}`, ownerOfChat, 222);

    expect(outcome).toEqual({ requesterId: "default", approved: false });
    expect(repository.requests[0]?.status).toBe("DENIED");
    expect(repository.grants).toHaveLength(0);
    expect(edit).toHaveBeenCalledWith("222", 555, expect.stringContaining("Denegaste el acceso"));
  });

  it("rejects a decision from the wrong chat", async () => {
    const { service } = makeService();
    const { requestId } = await service.requestAccess("default");

    const outcome = await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 111);

    expect(outcome).toBe("No autorizado");
  });

  it("expires a request nobody answered", async () => {
    let clock = new Date("2026-11-03T20:00:00Z");
    const { service, repository } = makeService({ now: () => clock });
    const { requestId } = await service.requestAccess("default");

    clock = new Date("2026-11-03T20:11:00Z");
    const outcome = await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 222);

    expect(outcome).toBe("El pedido venció");
    expect(repository.requests[0]?.status).toBe("EXPIRED");
    expect(repository.grants).toHaveLength(0);
  });

  it("does not answer the same request twice", async () => {
    const { service } = makeService();
    const { requestId } = await service.requestAccess("default");
    await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 222);

    const second = await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 222);

    expect(second).toBe("Este pedido ya fue respondido");
  });

  it("ignores callbacks that are not access decisions", async () => {
    const { service } = makeService();
    expect(await service.decideFromCallback("pv:save:abc", ownerOfChat, 222)).toBe("not-access");
  });
});

describe("AccessService.status / revoke", () => {
  it("reports the active grant and its expiry", async () => {
    const { service } = makeService();
    const { requestId } = await service.requestAccess("default");
    await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 222);

    const status = await service.status("default");

    expect(status.grant?.targetOwnerId).toBe("rita");
    expect(status.pending).toBeNull();
  });

  it("shows a pending request while waiting", async () => {
    const { service } = makeService();
    const { requestId } = await service.requestAccess("default");

    const status = await service.status("default");

    expect(status.grant).toBeNull();
    expect(status.pending?.requestId).toBe(requestId);
  });

  it("stops granting reads after revoking", async () => {
    const { service } = makeService();
    const { requestId } = await service.requestAccess("default");
    await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 222);
    expect(await service.activeTarget("default")).toBe("rita");

    await service.revoke("default");

    expect(await service.activeTarget("default")).toBeNull();
  });

  it("lists who viewed a dashboard", async () => {
    const { service } = makeService();
    const { requestId } = await service.requestAccess("default");
    await service.decideFromCallback(`ac:ok:${requestId}`, ownerOfChat, 222);

    const history = await service.history("rita");

    expect(history).toHaveLength(1);
    expect(history[0]?.requesterId).toBe("default");
  });
});
