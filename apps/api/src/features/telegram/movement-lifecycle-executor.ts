import type { Movement } from "@rita/contracts";
import { ConflictError, NotFoundError } from "../../infra/errors";
import type { ExpenseService } from "../expenses/expenses.service";
import type { MovementService } from "../movements/movements.service";

/**
 * v2 deterministic movement-lifecycle executor (spec bot-manage-expenses): the
 * cue-driven `markPaid`/`delete` resolvers are REMOVED — every lifecycle
 * action is button-driven in v2. The windows and by-id executions remain for
 * the expense-admin chains (Phase 6): `deleteWindow` (10 most recent), the new
 * `pendingWindow` (PENDING EXPENSE list for mark-paid), `markPaidById` and
 * `deleteById`.
 */
export type LifecycleCandidate = {
  id: string;
  amount: number;
  note: string | null;
  date: string;
  category: string;
  occurredAtMs: number;
};

export type LifecycleResult =
  | { status: "executed"; action: "marked_paid" | "deleted_movement"; movement: LifecycleCandidate }
  | { status: "already_paid"; movement: LifecycleCandidate }
  | { status: "missing" };

const WINDOW_SIZE = 10;

function toCandidate(movement: Movement): LifecycleCandidate {
  return {
    id: movement.id,
    amount: movement.amount,
    note: movement.note,
    date: movement.occurredAt.toISOString().slice(0, 10),
    category: movement.category ?? "",
    occurredAtMs: movement.occurredAt.getTime(),
  };
}

export class MovementLifecycleExecutor {
  constructor(
    private readonly deps: { movementService: MovementService; expenseService: ExpenseService },
  ) {}

  /**
   * The delete window for the expense admin (design D9): the 10-row
   * all-movements window, rendered as `dk:<id>` buttons so the owner picks the
   * target BEFORE any gate opens. Never deletes anything.
   */
  async deleteWindow(ownerId: string): Promise<LifecycleCandidate[]> {
    const movements = await this.deps.movementService.listMovements(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
    return movements.slice(0, WINDOW_SIZE).map(toCandidate);
  }

  /**
   * The mark-paid window for the expense admin (design "am:pay →
   * pendingWindow"): the owner's PENDING EXPENSE movements, rendered as
   * `mp:<id>` buttons. Never mutates anything.
   */
  async pendingWindow(ownerId: string): Promise<LifecycleCandidate[]> {
    const movements = await this.deps.movementService.listMovements(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
    return movements
      .filter((movement) => movement.type === "EXPENSE" && movement.status === "PENDING")
      .slice(0, WINDOW_SIZE)
      .map(toCandidate);
  }

  /** Executes the mark-paid transition for an already-picked candidate (mp:<id> pick). */
  async markPaidById(ownerId: string, movement: LifecycleCandidate): Promise<LifecycleResult> {
    try {
      await this.deps.movementService.markMovementPaid(ownerId, movement.id);
    } catch (error) {
      if (error instanceof ConflictError) {
        return { status: "already_paid", movement };
      }
      if (error instanceof NotFoundError) {
        return { status: "missing" };
      }
      throw error;
    }
    return { status: "executed", action: "marked_paid", movement };
  }

  /** Executes the delete for an already-picked candidate (dc:ok gate confirm). */
  async deleteById(ownerId: string, movement: LifecycleCandidate): Promise<LifecycleResult> {
    try {
      await this.deps.expenseService.deleteExpense(movement.id, ownerId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { status: "missing" };
      }
      throw error;
    }
    return { status: "executed", action: "deleted_movement", movement };
  }
}