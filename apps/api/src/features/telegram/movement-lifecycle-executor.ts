import type { Movement } from "@rita/contracts";
import { ConflictError, NotFoundError } from "../../infra/errors";
import { normalizeForMatchTolerant } from "../categories/matcher";
import type { ExpenseService } from "../expenses/expenses.service";
import type { MovementService } from "../movements/movements.service";

/**
 * Deterministic movement-lifecycle executor (design D3/D4, spec
 * bot-expense-lifecycle): resolves the referenced movement by fixed cue order
 * (category → amount → recency default) and acts through the existing REST
 * services — `MovementService.markMovementPaid` and
 * `ExpenseService.deleteExpense` — with zero duplicated business logic.
 *
 * - `markPaid` considers ONLY the owner's PENDING EXPENSE movements (10 most
 *   recent); with no PENDING cue match it re-filters the PAID EXPENSE window
 *   (D4) so an already-paid reference surfaces the honest 409 conflict.
 * - `delete` scores ALL owner movements in the corrector-style 10-row window.
 * - Ambiguity (multiple matches, or a recency tie with no cues) returns
 *   `ask` with the tied candidates; the controller persists the selection
 *   payload and the owner picks deterministically.
 * - The executor never guesses and never creates anything.
 */
export type LifecycleCues = { category: string | null; amount: number | null };

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
  | { status: "missing" }
  | { status: "nothing_pending" } // mark_paid only
  | { status: "no_match" } // delete only
  | { status: "ask"; candidates: LifecycleCandidate[] };

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

type Resolution =
  | { kind: "unique"; candidate: LifecycleCandidate }
  | { kind: "ask"; candidates: LifecycleCandidate[] }
  | { kind: "none" };

/**
 * D3 resolution: explicit cues are conjunctive filters (category folded on both
 * sides, amount exact) and recency NEVER breaks a cue tie; when both cues are
 * absent the most-recent candidate is the default and a tie asks (spec "two
 * PENDING in same category → ask", "borra ese gasto" → most recent).
 */
function resolveCueMatch(window: LifecycleCandidate[], cues: LifecycleCues): Resolution {
  const hasCategory = cues.category !== null;
  const hasAmount = cues.amount !== null;
  if (hasCategory || hasAmount) {
    const filtered = window.filter(
      (candidate) =>
        (!hasCategory ||
          normalizeForMatchTolerant(candidate.category) === normalizeForMatchTolerant(cues.category as string)) &&
        (!hasAmount || candidate.amount === cues.amount),
    );
    if (filtered.length === 1) {
      return { kind: "unique", candidate: filtered[0] as LifecycleCandidate };
    }
    if (filtered.length > 1) {
      return { kind: "ask", candidates: filtered };
    }
    return { kind: "none" };
  }
  // No cues: unique most-recent (the window is ordered occurredAt DESC); a
  // recency tie asks instead of guessing.
  if (window.length === 0) {
    return { kind: "none" };
  }
  const mostRecentMs = window[0]!.occurredAtMs;
  const tied = window.filter((candidate) => candidate.occurredAtMs === mostRecentMs);
  if (tied.length === 1) {
    return { kind: "unique", candidate: tied[0] as LifecycleCandidate };
  }
  return { kind: "ask", candidates: tied };
}

export class MovementLifecycleExecutor {
  constructor(
    private readonly deps: { movementService: MovementService; expenseService: ExpenseService },
  ) {}

  /**
   * Mark-paid resolution: PENDING EXPENSE window only. A unique match executes;
   * multiple matches ask; zero PENDING matches fall back to the PAID EXPENSE
   * window (D4) so an already-paid reference returns the 409 conflict; nothing
   * anywhere → `nothing_pending`.
   */
  async markPaid(ownerId: string, cues: LifecycleCues): Promise<LifecycleResult> {
    const movements = await this.deps.movementService.listMovements(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
    const window = movements
      .filter((movement) => movement.type === "EXPENSE" && movement.status === "PENDING")
      .slice(0, WINDOW_SIZE)
      .map(toCandidate);

    const resolved = resolveCueMatch(window, cues);
    if (resolved.kind === "unique") {
      return this.markPaidById(ownerId, resolved.candidate);
    }
    if (resolved.kind === "ask") {
      return { status: "ask", candidates: resolved.candidates };
    }

    // D4 fallback: 0 PENDING cue matches → re-filter the EXPENSE non-PENDING
    // window with the same cues; a unique match calls markMovementPaid which
    // 409s on the already-PAID row (honest "ya estaba pagado" reply).
    const paidWindow = movements
      .filter((movement) => movement.type === "EXPENSE" && movement.status !== "PENDING")
      .slice(0, WINDOW_SIZE)
      .map(toCandidate);
    const fallback = resolveCueMatch(paidWindow, cues);
    if (fallback.kind === "unique") {
      return this.markPaidById(ownerId, fallback.candidate);
    }
    return { status: "nothing_pending" };
  }

  /** Delete resolution: ALL owner movements in the 10-row window (D7). */
  async delete(ownerId: string, cues: LifecycleCues): Promise<LifecycleResult> {
    const movements = await this.deps.movementService.listMovements(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
    const window = movements.slice(0, WINDOW_SIZE).map(toCandidate);

    const resolved = resolveCueMatch(window, cues);
    if (resolved.kind === "unique") {
      return this.deleteById(ownerId, resolved.candidate);
    }
    if (resolved.kind === "ask") {
      return { status: "ask", candidates: resolved.candidates };
    }
    return { status: "no_match" };
  }

  /** Executes the mark-paid transition for an already-picked candidate (selection pick). */
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

  /** Executes the delete for an already-picked candidate (selection pick). */
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