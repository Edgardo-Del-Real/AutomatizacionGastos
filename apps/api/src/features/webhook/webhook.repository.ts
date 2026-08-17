import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export interface ProcessedMessageRepository {
  recordProcessed(messageId: string, ownerId: string): Promise<void>;
}

export class PrismaProcessedMessageRepository implements ProcessedMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordProcessed(messageId: string, ownerId: string): Promise<void> {
    await this.prisma.processedMessage.create({ data: { messageId, ownerId } });
  }
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
