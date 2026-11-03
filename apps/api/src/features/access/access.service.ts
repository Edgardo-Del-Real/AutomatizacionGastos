import { ConflictError, NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { UserRepository } from "../auth/user.repository";
import type {
  AccessGrantRow,
  AccessRepository,
  AccessRequestRow,
} from "./access.repository";

/** Outbound Telegram port: the access flow is the only sender outside a chat. */
export type Notifier = {
  send(chatId: string, text: string, keyboard: { text: string; data: string }[][]): Promise<number | undefined>;
  edit(chatId: string, messageId: number, text: string): Promise<void>;
};

export type AccessServiceOptions = {
  /** Request lifetime (default 10 minutes). */
  requestTtlMs?: number;
  /** Grant lifetime (default 30 minutes). */
  grantTtlMs?: number;
  now?: () => Date;
};

export type AccessStatus = {
  grant: { targetOwnerId: string; expiresAt: Date } | null;
  pending: { requestId: string; targetOwnerId: string; expiresAt: Date } | null;
};

const DEFAULT_REQUEST_TTL_MS = 10 * 60 * 1000;
const DEFAULT_GRANT_TTL_MS = 30 * 60 * 1000;
export const ACCESS_CALLBACK_PREFIX = "ac:";

export function accessRequestMessage(requesterName: string): string {
  return `👤 ${requesterName} quiere ver tu dashboard por 30 minutos.`;
}

export function accessDecisionMessage(requesterName: string, approved: boolean): string {
  return approved
    ? `✅ Le diste acceso a ${requesterName} por 30 minutos.`
    : `🚫 Denegaste el acceso a ${requesterName}.`;
}

/**
 * household-isolation: a read-only, time-boxed permission to view the other
 * person's dashboard. The permission is decided from the target's Telegram
 * chat (two inline buttons) so nobody has to copy a code.
 */
export class AccessService {
  private readonly requestTtlMs: number;
  private readonly grantTtlMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: AccessRepository,
    private readonly users: UserRepository,
    private readonly notifier: Notifier,
    options: AccessServiceOptions = {},
  ) {
    this.requestTtlMs = options.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS;
    this.grantTtlMs = options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
    this.now = options.now ?? (() => new Date());
  }

  /** The other member of the household (the only possible target today). */
  private async partnerOf(requesterId: string): Promise<{ ownerId: string; name: string; chatId: string }> {
    const users = await this.users.list();
    const partner = users.find((user) => user.ownerId !== requesterId);
    if (partner === undefined) {
      throw new ConflictError("No hay otra persona en el hogar para pedirle acceso");
    }
    return { ownerId: partner.ownerId, name: partner.name, chatId: partner.chatId };
  }

  async requestAccess(requesterId: string): Promise<{
    requestId: string;
    targetOwnerId: string;
    expiresAt: Date;
  }> {
    const requester = await this.users.findById(requesterId);
    if (requester === null) throw new NotFoundError("Usuario desconocido");
    const partner = await this.partnerOf(requesterId);

    const activeGrant = await this.repository.findActiveGrant(requesterId, this.now());
    if (activeGrant !== null) {
      // Already allowed: asking again would just spam the other person.
      return {
        requestId: "",
        targetOwnerId: activeGrant.targetOwnerId,
        expiresAt: activeGrant.expiresAt,
      };
    }

    const pending = await this.repository.findPendingRequest(requesterId);
    if (pending !== null && pending.expiresAt > this.now()) {
      return {
        requestId: pending.id,
        targetOwnerId: pending.targetOwnerId,
        expiresAt: pending.expiresAt,
      };
    }

    const expiresAt = new Date(this.now().getTime() + this.requestTtlMs);
    const request = await this.repository.createRequest({
      requesterId,
      targetOwnerId: partner.ownerId,
      expiresAt,
    });

    const messageId = await this.notifier.send(partner.chatId, accessRequestMessage(requester.name), [
      [
        { text: "Dar acceso", data: `${ACCESS_CALLBACK_PREFIX}ok:${request.id}` },
        { text: "Denegar", data: `${ACCESS_CALLBACK_PREFIX}no:${request.id}` },
      ],
    ]);
    if (messageId !== undefined) {
      await this.repository.setRequestMessageId(request.id, messageId);
    }

    return { requestId: request.id, targetOwnerId: partner.ownerId, expiresAt };
  }

  async status(requesterId: string): Promise<AccessStatus> {
    const now = this.now();
    const grant = await this.repository.findActiveGrant(requesterId, now);
    const pending = await this.repository.findPendingRequest(requesterId);
    return {
      grant: grant === null ? null : { targetOwnerId: grant.targetOwnerId, expiresAt: grant.expiresAt },
      pending:
        pending === null || pending.expiresAt <= now
          ? null
          : { requestId: pending.id, targetOwnerId: pending.targetOwnerId, expiresAt: pending.expiresAt },
    };
  }

  /** The target the requester may read right now, or null. */
  async activeTarget(requesterId: string): Promise<string | null> {
    const grant = await this.repository.findActiveGrant(requesterId, this.now());
    return grant?.targetOwnerId ?? null;
  }

  async revoke(requesterId: string): Promise<void> {
    await this.repository.revokeGrants(requesterId, this.now());
  }

  /** Who viewed this owner's dashboard (for the profile history). */
  async history(targetOwnerId: string, limit = 20): Promise<AccessGrantRow[]> {
    return this.repository.listGrantsByTarget(targetOwnerId, limit);
  }

  /**
   * Handles the Telegram buttons. Returns the text to show as a callback
   * answer, or null when the callback is not an access decision.
   */
  async decideFromCallback(
    data: string,
    ownerOfChat: (chatId: number) => string | null,
    chatId: number,
  ): Promise<{ requesterId: string; approved: boolean } | "not-access" | string> {
    if (!data.startsWith(ACCESS_CALLBACK_PREFIX)) return "not-access";
    const [decision, requestId] = data.slice(ACCESS_CALLBACK_PREFIX.length).split(":");
    if ((decision !== "ok" && decision !== "no") || requestId === undefined || requestId === "") {
      return "Consulta inválida";
    }
    const deciderOwnerId = ownerOfChat(chatId);
    if (deciderOwnerId === null) return "No autorizado";

    const request: AccessRequestRow | null = await this.repository.findRequestById(requestId);
    if (request === null) return "Este pedido ya no existe";
    if (request.targetOwnerId !== deciderOwnerId) return "No autorizado";
    if (request.status !== "PENDING") return "Este pedido ya fue respondido";

    const now = this.now();
    if (request.expiresAt <= now) {
      await this.repository.decideRequest(request.id, "EXPIRED", now);
      await this.editMessage(request, deciderOwnerId, "⏱ El pedido venció sin respuesta.");
      return "El pedido venció";
    }

    const approved = decision === "ok";
    await this.repository.decideRequest(request.id, approved ? "APPROVED" : "DENIED", now);

    const requester = await this.users.findById(request.requesterId);
    const requesterName = requester?.name ?? request.requesterId;

    if (approved) {
      await this.repository.createGrant({
        requesterId: request.requesterId,
        targetOwnerId: request.targetOwnerId,
        expiresAt: new Date(now.getTime() + this.grantTtlMs),
      });
    }

    await this.editMessage(request, deciderOwnerId, accessDecisionMessage(requesterName, approved));
    return { requesterId: request.requesterId, approved };
  }

  private async editMessage(
    request: AccessRequestRow,
    targetOwnerId: string,
    text: string,
  ): Promise<void> {
    if (request.telegramMessageId === null) return;
    const target = await this.users.findById(targetOwnerId);
    if (target === null) return;
    await this.notifier.edit(target.chatId, request.telegramMessageId, text);
  }
}

/** Route-level guard: only post a request for a real household member. */
export function assertRequester(ownerId: string | undefined): string {
  if (ownerId === undefined || ownerId === "") {
    throw new ValidationFailedError("Falta el usuario de la sesión");
  }
  return ownerId;
}
