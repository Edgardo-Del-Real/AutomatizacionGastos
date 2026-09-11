import type { PrismaClient } from "@prisma/client";

export const BOT_STATES = ["idle", "awaiting_setup", "awaiting_category"] as const;

export type BotStateName = (typeof BOT_STATES)[number];

export type BotStateRecord = {
  ownerId: string;
  state: BotStateName;
  pendingMovementId: string | null;
  pendingNote: string | null;
};

export interface BotStateRepository {
  get(ownerId: string): Promise<BotStateRecord | null>;
  set(state: BotStateRecord): Promise<void>;
  clear(ownerId: string): Promise<void>;
}

export class PrismaBotStateRepository implements BotStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(ownerId: string): Promise<BotStateRecord | null> {
    const row = await this.prisma.botState.findUnique({ where: { ownerId } });
    if (row === null) {
      return null;
    }
    return {
      ownerId: row.ownerId,
      state: row.state as BotStateName,
      pendingMovementId: row.pendingMovementId,
      pendingNote: row.pendingNote,
    };
  }

  async set(state: BotStateRecord): Promise<void> {
    await this.prisma.botState.upsert({
      where: { ownerId: state.ownerId },
      update: {
        state: state.state,
        pendingMovementId: state.pendingMovementId,
        pendingNote: state.pendingNote,
      },
      create: {
        ownerId: state.ownerId,
        state: state.state,
        pendingMovementId: state.pendingMovementId,
        pendingNote: state.pendingNote,
      },
    });
  }

  async clear(ownerId: string): Promise<void> {
    await this.prisma.botState.deleteMany({ where: { ownerId } });
  }
}