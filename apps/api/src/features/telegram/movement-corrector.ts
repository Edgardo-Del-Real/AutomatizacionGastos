import type { Movement, MovementType } from "@rita/contracts";
import type { MovementService } from "../movements/movements.service";

export type MovementCandidate = {
  id: string;
  amount: number;
  note: string | null;
  date: string;
  type: MovementType;
};

const WINDOW_SIZE = 10;

function toCandidate(movement: Movement): MovementCandidate {
  return {
    id: movement.id,
    amount: movement.amount,
    note: movement.note,
    date: movement.occurredAt.toISOString().slice(0, 10),
    type: movement.type,
  };
}

/**
 * v2 deterministic movement-correction window (spec movement-correction
 * "Movement Reference Matching"): the 10 most recent movements EXCLUDING
 * PENDING (planned expenses are not correctable until marked paid). The
 * conversational matcher (`correct`/`score`/`resolveTargetCategory`) is
 * REMOVED — correction is button-driven in v2: the expense admin lists this
 * window and the owner picks the candidate by button (Phase 6).
 */
export class MovementCorrector {
  constructor(private readonly movementService: MovementService) {}

  async correctionWindow(ownerId: string): Promise<MovementCandidate[]> {
    const movements = await this.movementService.listMovements(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
    return movements.filter((movement) => movement.status !== "PENDING").slice(0, WINDOW_SIZE).map(toCandidate);
  }
}