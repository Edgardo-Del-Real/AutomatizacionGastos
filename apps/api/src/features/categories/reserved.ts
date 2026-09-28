import { ValidationFailedError } from "../../infra/errors";
import { normalizeForMatchTolerant } from "./matcher";

/**
 * The folded reserved-concept set (design decision 3, research §8.1): creating
 * or renaming a category whose `normalizeForMatchTolerant` name is a member is
 * rejected on every creation path. Exact "ahorro" keeps the SAVINGS routing;
 * folded "ahorros" is rejected with a SAVINGS redirect, never upserted.
 */
export type ReservedConcept =
  | "previsto"
  | "gasto fijo"
  | "ahorro"
  | "compartido"
  | "compartida"
  | "otro";

const RESERVED_CONCEPTS: readonly ReservedConcept[] = [
  "previsto",
  "gasto fijo",
  "ahorro",
  "compartido",
  "compartida",
  "otro",
];

const RESERVED_FOLDED_SET: ReadonlySet<string> = new Set(RESERVED_CONCEPTS);

/**
 * Guard-only typo alias (research §8.2, C17): "provisto" (Damerau-Levenshtein
 * distance 1 from "previsto") is treated as the previsto concept INSIDE the
 * reserved guard only. It never applies to general matching.
 */
const RESERVED_ALIASES: Readonly<Record<string, ReservedConcept>> = {
  provisto: "previsto",
};

/**
 * Resolves a category name to its reserved concept by folding it through
 * `normalizeForMatchTolerant` and testing membership (after the guard-only
 * alias). Returns null for any non-reserved name.
 */
export function resolveReservedConcept(name: string): ReservedConcept | null {
  const folded = normalizeForMatchTolerant(name);
  const aliased = RESERVED_ALIASES[folded];
  if (aliased !== undefined) {
    return aliased;
  }
  return RESERVED_FOLDED_SET.has(folded) ? (folded as ReservedConcept) : null;
}

/**
 * 422 discriminator for reserved-concept violations (design decision 4):
 * extends `ValidationFailedError` so the generic error handler treats it as a
 * validation failure while executors and command paths route the exact
 * concept to a per-concept educational redirect.
 */
export class ReservedCategoryError extends ValidationFailedError {
  constructor(
    message: string,
    readonly concept: ReservedConcept,
  ) {
    super(message);
  }
}