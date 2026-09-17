import { normalizeForMatch } from "../categories/matcher";

/** Spanish prose-number tokens, longer-first so alternation prefers full words. */
const PROSE_NUMBER_WORDS = [
  "millones",
  "millon",
  "mil",
  "k",
  "ciento",
  "cien",
  "doscientos",
  "doscientas",
  "trescientos",
  "trescientas",
  "cuatrocientos",
  "cuatrocientas",
  "quinientos",
  "quinientas",
  "seiscientos",
  "seiscientas",
  "setecientos",
  "setecientas",
  "ochocientos",
  "ochocientas",
  "novecientos",
  "novecientas",
];

/**
 * Boundary convention follows matcher.ts (normalizeForMatch + word boundaries),
 * adapted so a digit prefix matches ("5mil", "2k") while "kiosco"/"Millka"
 * cannot.
 */
const PROSE_NUMBER_WORD_REGEX = new RegExp(`(?:^|[^a-z])(?:${PROSE_NUMBER_WORDS.join("|")})(?![a-z0-9])`);

/**
 * Fires only in the conflict path (detAmount ≠ brainAmount, both non-null).
 * A bare small integer beside a prose-number word is the known-broken
 * deterministic parse of a prose amount ("5 mil"→5, "15 mil"→15, "2k"→2,
 * "500 mil"→500): the brain amount wins directly, no conflict question.
 * Integers ≥ 1000 beside prose words are likelier genuine amounts
 * ("2500, mil gracias") → keep the question.
 */
export function isMilStance(body: string, deterministicAmount: number | null): boolean {
  if (
    deterministicAmount === null ||
    !Number.isInteger(deterministicAmount) ||
    deterministicAmount < 1 ||
    deterministicAmount > 999
  ) {
    return false;
  }
  return PROSE_NUMBER_WORD_REGEX.test(normalizeForMatch(body));
}