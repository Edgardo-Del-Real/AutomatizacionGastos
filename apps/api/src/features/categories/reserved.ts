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
  | "ahorro"
  | "compartido"
  | "compartida"
  | "otro";

const RESERVED_CONCEPTS: readonly ReservedConcept[] = [
  "previsto",
  "ahorro",
  "compartido",
  "compartida",
  "otro",
];

const RESERVED_FOLDED_SET: ReadonlySet<string> = new Set(RESERVED_CONCEPTS);

/**
 * Guard-only typo aliases (research §8.2, C17): "provisto" (Damerau-Levenshtein
 * distance 1 from "previsto") and "provisorio" (same family; the plural fold
 * already reduces "provisorios") are treated as the previsto concept INSIDE the
 * reserved guard only. They never apply to general matching.
 */
const RESERVED_ALIASES: Readonly<Record<string, ReservedConcept>> = {
  provisto: "previsto",
  provisorio: "previsto",
};

/**
 * Resolves a category name to its reserved concept by folding it through
 * `normalizeForMatchTolerant` and testing membership (after the guard-only
 * alias). A name CONTAINING a guard-only alias token ("gasto provisorio") is
 * the same concept attempt and is rejected too — the token check applies ONLY
 * to the misspelling aliases (provisto/provisorio), never to the general
 * reserved concepts ("otro", "previsto", ...), so legitimate owner category
 * names containing a real concept word ("un otro gasto") stay creatable.
 * Returns null for any non-reserved name.
 */
export function resolveReservedConcept(name: string): ReservedConcept | null {
  const folded = normalizeForMatchTolerant(name);
  const aliased = RESERVED_ALIASES[folded];
  if (aliased !== undefined) {
    return aliased;
  }
  if (RESERVED_FOLDED_SET.has(folded)) {
    return folded as ReservedConcept;
  }
  for (const token of folded.split(" ")) {
    const tokenAliased = RESERVED_ALIASES[token];
    if (tokenAliased !== undefined) {
      return tokenAliased;
    }
  }
  return null;
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