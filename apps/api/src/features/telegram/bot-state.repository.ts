import type { PrismaClient } from "@prisma/client";

/**
 * v2 state machine (spec telegram-bot "Per-Owner State Machine"): the three
 * dialog states (`awaiting_category`, `awaiting_registration`,
 * `awaiting_amount_confirmation`) are removed. A persisted payload in any of
 * the removed states (e.g. from a rollback) fails v2 enum membership and
 * recovers to `idle` through the generic corrupt-payload discipline.
 */
export const BOT_STATES = [
  "idle",
  "awaiting_setup",
  "awaiting_capture",
  "awaiting_preview",
  "awaiting_category_name",
  "awaiting_movement_selection",
  "awaiting_category_selection",
  "awaiting_delete_confirmation",
] as const;

export type BotStateName = (typeof BOT_STATES)[number];

/**
 * Persisted-record state type: the DB column may still hold one of the
 * removed dialog states until a v2 recovery pass normalizes it to `idle`
 * (design "normalizeState" / corrupt-payload discipline). The `BOT_STATES`
 * enum above remains the authoritative v2 contract — the widened read type
 * only models what the store can physically contain during rollback.
 */
export type PersistedBotStateName =
  | BotStateName
  | "awaiting_category"
  | "awaiting_registration"
  | "awaiting_amount_confirmation";

export type BotStateRecord = {
  ownerId: string;
  state: PersistedBotStateName;
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