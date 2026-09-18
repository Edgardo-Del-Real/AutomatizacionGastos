import type { Movement, MovementType } from "@rita/contracts";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import { normalizeForMatch } from "../categories/matcher";
import type { MovementService } from "../movements/movements.service";

export type MovementCandidate = {
  id: string;
  amount: number;
  note: string | null;
  date: string;
  type: MovementType;
};

export type MovementReference = { amount: number | null; note: string | null };

export type CorrectionResult =
  | { status: "reassigned"; movement: MovementCandidate; category: string }
  | { status: "ask"; reason: "ambiguous" | "no_reference"; candidates: MovementCandidate[]; category: string }
  | { status: "no_match" }
  /** The matched movement disappeared before the update (spec "Missing movement degrades"). */
  | { status: "missing" };

const WINDOW_SIZE = 10;
const RECENCY_HOT_MS = 48 * 60 * 60 * 1000;
const RECENCY_WARM_MS = 7 * 24 * 60 * 60 * 1000;
const SCORE_AMOUNT = 8;
const SCORE_NOTE_EXACT = 4;
const SCORE_NOTE_PARTIAL = 2;
const SCORE_RECENCY_HOT = 2;
const SCORE_RECENCY_WARM = 1;

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
 * Deterministic movement-correction matcher (spec movement-correction): given a
 * reference (amount and/or note) and a target category, resolves the target
 * category (exact normalized match else auto-create, D7), scores the owner's 10
 * most recent movements, and reassigns the unique best candidate. Ambiguity and
 * no-reference outcomes ask instead of guessing. It never touches bot state —
 * the controller persists the ask payload.
 */
export class MovementCorrector {
  constructor(
    private readonly movementService: MovementService,
    private readonly categoryService: CategoryService,
  ) {}

  /**
   * @param now Injectable clock so recency buckets are deterministic in tests.
   */
  async correct(
    ownerId: string,
    reference: MovementReference,
    targetCategory: string,
    now: Date = new Date(),
  ): Promise<CorrectionResult> {
    const category = await this.resolveTargetCategory(ownerId, targetCategory);
    const movements = await this.movementService.listMovements(ownerId, {});
    const window = movements.slice(0, WINDOW_SIZE).map(toCandidate);

    // No reference: the bot must ask which movement (spec "No reference asks").
    if (reference.amount === null && reference.note === null) {
      if (window.length === 0) {
        return { status: "no_match" };
      }
      return { status: "ask", reason: "no_reference", candidates: window, category };
    }

    const best = maxScore(window, reference, now);
    if (best === 0) {
      // Nothing matched (also covers the empty window).
      return { status: "no_match" };
    }
    const top = window.filter((candidate) => score(candidate, reference, now) === best);
    if (top.length > 1) {
      // A tie MUST ask; the bot never guesses (spec "Repeated amount without note asks").
      return { status: "ask", reason: "ambiguous", candidates: top, category };
    }
    const winner = top[0]!;
    try {
      await this.movementService.updateMovement(ownerId, winner.id, { category });
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationFailedError) {
        return { status: "missing" };
      }
      throw error;
    }
    return { status: "reassigned", movement: winner, category };
  }

  /**
   * D7: exact normalized match against the owner's categories; otherwise
   * auto-create the target. A duplicate race resolves to the existing category.
   */
  private async resolveTargetCategory(ownerId: string, targetCategory: string): Promise<string> {
    const trimmed = targetCategory.trim();
    const exact = (await this.categoryService.listCategories(ownerId)).find(
      (category) => normalizeForMatch(category.name) === normalizeForMatch(trimmed),
    );
    if (exact !== undefined) {
      return exact.name;
    }
    try {
      const created = await this.categoryService.createCategory(ownerId, trimmed);
      return created.name;
    } catch (error) {
      if (error instanceof ValidationFailedError) {
        const existing = (await this.categoryService.listCategories(ownerId)).find(
          (category) => normalizeForMatch(category.name) === normalizeForMatch(trimmed),
        );
        if (existing !== undefined) {
          return existing.name;
        }
      }
      throw error;
    }
  }
}

function maxScore(window: MovementCandidate[], reference: MovementReference, now: Date): number {
  let best = 0;
  for (const candidate of window) {
    const value = score(candidate, reference, now);
    if (value > best) {
      best = value;
    }
  }
  return best;
}

/**
 * Weighted scoring table (design D3): amount 8, note exact 4, note partial 2.
 * Recency (2 hot / 1 warm) breaks ties ONLY among candidates that already have
 * evidence — a reference that matches nothing scores 0 and is never reassigned
 * (spec "most recent wins ties").
 */
export function score(candidate: MovementCandidate, reference: MovementReference, now: Date): number {
  let evidence = 0;
  if (reference.amount !== null && candidate.amount === reference.amount) {
    evidence += SCORE_AMOUNT;
  }
  if (reference.note !== null) {
    const refNote = normalizeForMatch(reference.note);
    const candidateNote = normalizeForMatch(candidate.note ?? "");
    if (refNote.length > 0 && candidateNote === refNote) {
      evidence += SCORE_NOTE_EXACT;
    } else if (notePartialMatch(candidateNote, refNote)) {
      evidence += SCORE_NOTE_PARTIAL;
    }
  }
  if (evidence === 0) {
    return 0;
  }
  const ageMs = now.getTime() - new Date(candidate.date).getTime();
  if (ageMs >= 0 && ageMs <= RECENCY_HOT_MS) {
    evidence += SCORE_RECENCY_HOT;
  } else if (ageMs >= 0 && ageMs <= RECENCY_WARM_MS) {
    evidence += SCORE_RECENCY_WARM;
  }
  return evidence;
}

/** Every normalized reference token must appear inside the candidate note. */
function notePartialMatch(candidateNote: string, refNote: string): boolean {
  const tokens = refNote.split(/\s+/).filter((token) => token.length > 0);
  return tokens.length > 0 && tokens.every((token) => candidateNote.includes(token));
}