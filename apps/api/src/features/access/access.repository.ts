import type { PrismaClient } from "@prisma/client";

export type AccessRequestStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";

export type AccessRequestRow = {
  id: string;
  requesterId: string;
  targetOwnerId: string;
  status: AccessRequestStatus;
  telegramMessageId: number | null;
  createdAt: Date;
  decidedAt: Date | null;
  expiresAt: Date;
};

export type AccessGrantRow = {
  id: string;
  requesterId: string;
  targetOwnerId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type NewAccessRequest = {
  requesterId: string;
  targetOwnerId: string;
  expiresAt: Date;
};

export type NewAccessGrant = {
  requesterId: string;
  targetOwnerId: string;
  expiresAt: Date;
};

/**
 * household-isolation: persistence for the "may I see your dashboard?" flow.
 * The request and the grant are separate rows on purpose: a request expires in
 * 10 minutes, a grant lasts 30 and can be revoked.
 */
export interface AccessRepository {
  createRequest(input: NewAccessRequest): Promise<AccessRequestRow>;
  findRequestById(id: string): Promise<AccessRequestRow | null>;
  findPendingRequest(requesterId: string): Promise<AccessRequestRow | null>;
  setRequestMessageId(id: string, messageId: number): Promise<void>;
  decideRequest(id: string, status: AccessRequestStatus, decidedAt: Date): Promise<void>;
  createGrant(input: NewAccessGrant): Promise<AccessGrantRow>;
  findActiveGrant(requesterId: string, now: Date): Promise<AccessGrantRow | null>;
  revokeGrants(requesterId: string, revokedAt: Date): Promise<void>;
  listGrantsByTarget(targetOwnerId: string, limit: number): Promise<AccessGrantRow[]>;
}

export class PrismaAccessRepository implements AccessRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createRequest(input: NewAccessRequest): Promise<AccessRequestRow> {
    return this.prisma.accessRequest.create({ data: input });
  }

  async findRequestById(id: string): Promise<AccessRequestRow | null> {
    return this.prisma.accessRequest.findUnique({ where: { id } });
  }

  async findPendingRequest(requesterId: string): Promise<AccessRequestRow | null> {
    return this.prisma.accessRequest.findFirst({
      where: { requesterId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  }

  async setRequestMessageId(id: string, messageId: number): Promise<void> {
    await this.prisma.accessRequest.update({
      where: { id },
      data: { telegramMessageId: messageId },
    });
  }

  async decideRequest(
    id: string,
    status: AccessRequestStatus,
    decidedAt: Date,
  ): Promise<void> {
    await this.prisma.accessRequest.update({ where: { id }, data: { status, decidedAt } });
  }

  async createGrant(input: NewAccessGrant): Promise<AccessGrantRow> {
    return this.prisma.accessGrant.create({ data: input });
  }

  async findActiveGrant(requesterId: string, now: Date): Promise<AccessGrantRow | null> {
    return this.prisma.accessGrant.findFirst({
      where: { requesterId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { expiresAt: "desc" },
    });
  }

  async revokeGrants(requesterId: string, revokedAt: Date): Promise<void> {
    await this.prisma.accessGrant.updateMany({
      where: { requesterId, revokedAt: null, expiresAt: { gt: revokedAt } },
      data: { revokedAt },
    });
  }

  async listGrantsByTarget(targetOwnerId: string, limit: number): Promise<AccessGrantRow[]> {
    return this.prisma.accessGrant.findMany({
      where: { targetOwnerId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
