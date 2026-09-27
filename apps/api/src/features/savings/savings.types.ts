export type SavingsRuleEntity = {
  id: string;
  ownerId: string;
  keyword: string;
  percent: number;
  createdAt: Date;
};

/**
 * Deterministic per-message savings override (D6): parsed once at arrival.
 * - "none": no override; the rule match decides.
 * - "disabled": "sin ahorro" — register the whole gross.
 * - "percent": "con X%" — replaces the rule percent for this message only.
 */
export type SavingsOverride = { kind: "none" } | { kind: "disabled" } | { kind: "percent"; percent: number };

/**
 * Effective split for an income registration (D5/D7): "whole" registers a
 * single movement; "split" carries the effective percent the tail feeds to
 * `computeSplit` to derive net and savings amounts.
 */
export type SplitResult = { kind: "whole" } | { kind: "split"; percent: number };