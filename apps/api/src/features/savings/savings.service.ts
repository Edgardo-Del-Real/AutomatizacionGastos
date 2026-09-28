import { Prisma } from "@prisma/client";
import { ValidationFailedError } from "../../infra/errors";
import { boundaryRegex, normalizeForMatch, normalizeForMatchTolerant } from "../categories/matcher";
import type { SavingsRuleRepository } from "./savings.repository";
import type { SavingsOverride, SavingsRuleEntity, SplitResult } from "./savings.types";

/**
 * Vertical-slice service for the savings capability (D4): keyword→percent
 * rules scoped to an owner, note matching (normalizeForMatch + boundaryRegex,
 * oldest-wins), and the Decimal-safe split arithmetic.
 */
export class SavingsRuleService {
  constructor(private readonly repository: SavingsRuleRepository) {}

  /**
   * Creates or upserts the rule for [ownerId, keyword]. `percent` MUST satisfy
   * `0 < percent <= 100` (contract); anything else is a validation error and
   * nothing is stored.
   */
  async defineRule(ownerId: string, keyword: string, percent: number): Promise<SavingsRuleEntity> {
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new ValidationFailedError("Savings rule percent must satisfy 0 < percent <= 100");
    }
    const normalized = normalizeForMatch(keyword.trim());
    if (normalized.length === 0) {
      throw new ValidationFailedError("Savings rule keyword must not be empty");
    }
    return this.repository.upsert(ownerId, normalized, percent);
  }

  /**
   * Matches a note against the owner's savings rules. Matching is
   * diacritic-insensitive, word-boundary based, oldest-learned wins
   * (repository orders createdAt ASC), and singular/plural variants fold on
   * BOTH sides through `normalizeForMatchTolerant` (shared matcher semantics).
   * Returns the matching rule percent, or null when no rule matches.
   */
  async matchNote(ownerId: string, note: string): Promise<number | null> {
    const rules = await this.repository.listByOwner(ownerId);
    const normalized = normalizeForMatchTolerant(note);
    for (const rule of rules) {
      if (boundaryRegex(normalizeForMatchTolerant(rule.keyword)).test(normalized)) {
        return rule.percent;
      }
    }
    return null;
  }

  /**
   * Resolves the effective split for an income registration (D5/D7/D8):
   * "sin ahorro" → whole; "con X%" → split with X for this message only
   * (replaces a matching rule's percent, D8); no override → rule match
   * decides, and no rule → whole.
   */
  async resolveSplit(ownerId: string, note: string, override: SavingsOverride): Promise<SplitResult> {
    if (override.kind === "disabled") {
      return { kind: "whole" };
    }
    const percent = override.kind === "percent" ? override.percent : await this.matchNote(ownerId, note);
    if (percent === null) {
      return { kind: "whole" };
    }
    return { kind: "split", percent };
  }

  /**
   * Rounding invariant (D7): savings = round2(gross × pct / 100); net = gross
   * − savings, so net + savings === gross exactly. Decimal arithmetic avoids
   * float drift; results convert to numbers for the wire.
   */
  computeSplit(gross: number, percent: number): { net: number; savings: number } {
    const savings = new Prisma.Decimal(gross).times(percent).div(100).toDecimalPlaces(2);
    const net = new Prisma.Decimal(gross).minus(savings);
    return { net: net.toNumber(), savings: savings.toNumber() };
  }
}