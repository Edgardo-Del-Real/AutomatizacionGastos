import type { SavingsOverride } from "../savings/savings.types";
import type { TelegramMessage } from "./telegram.types";

/**
 * AD6 — the `compartido:` prefix is parsed ONCE at arrival and is
 * authoritative: it works without the bot brain and wins over the brain's
 * `shared` flag by construction (the stripped text the brain sees never
 * carries the prefix). Strips the prefix (case-insensitive) and trims the rest.
 */
export function parseSharedPrefix(text: string): { text: string; shared: boolean } {
  const match = /^compartido\s*:\s*/i.exec(text);
  if (match === null) {
    return { text, shared: false };
  }
  return { text: text.slice(match[0].length).trim(), shared: true };
}

/**
 * D10 — the arrival prefixes (`compartido:` and `previsto:`) are parsed ONCE
 * at arrival by a loop that strips them in ANY order. Both are authoritative
 * (they work without the bot brain and win over brain signals) and composable:
 * "compartido: previsto: 2500 alquiler" and "previsto: compartido: 2500
 * alquiler" produce the same { text, shared, planned } result.
 */
export type ArrivalPrefixes = { text: string; shared: boolean; planned: boolean };

const ARRIVAL_PREFIXES: readonly { re: RegExp; apply: (prefixes: ArrivalPrefixes) => void }[] = [
  { re: /^compartido\s*:\s*/i, apply: (prefixes) => void (prefixes.shared = true) },
  { re: /^previsto\s*:\s*/i, apply: (prefixes) => void (prefixes.planned = true) },
];

export function parseArrivalPrefixes(text: string): ArrivalPrefixes {
  let remaining = text;
  const prefixes: ArrivalPrefixes = { text: "", shared: false, planned: false };
  let changed = true;
  while (changed) {
    changed = false;
    for (const { re, apply } of ARRIVAL_PREFIXES) {
      const match = re.exec(remaining);
      if (match !== null) {
        apply(prefixes);
        remaining = remaining.slice(match[0].length).trim();
        changed = true;
      }
    }
  }
  prefixes.text = remaining;
  return prefixes;
}

export type SavingsOverrideParseResult =
  | { ok: true; override: SavingsOverride; text: string }
  | { ok: false; error: "invalid_percent"; percent: number };

const SIN_AHORRO_RE = /^sin ahorro\s*:?\s*/i;
const CON_PERCENT_RE = /^con\s+(-?\d+(?:[.,]\d+)?)\s*%/i;

/**
 * D6 — deterministic savings overrides parsed ONCE at arrival, right after the
 * `compartido:` prefix. "sin ahorro" disables the split; "con X%" replaces the
 * rule percent for this message only (0 < X <= 100, otherwise the registration
 * is rejected and nothing is stored). The prefix is stripped from the text that
 * flows to the parser and the brain.
 */
export function parseSavingsOverride(text: string): SavingsOverrideParseResult {
  if (SIN_AHORRO_RE.test(text)) {
    return { ok: true, override: { kind: "disabled" }, text: text.replace(SIN_AHORRO_RE, "").trim() };
  }
  const match = CON_PERCENT_RE.exec(text);
  if (match !== null) {
    const percent = Number(match[1]!.replace(",", "."));
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { ok: false, error: "invalid_percent", percent };
    }
    return {
      ok: true,
      override: { kind: "percent", percent },
      text: text.slice(match[0].length).trim(),
    };
  }
  return { ok: true, override: { kind: "none" }, text };
}

export function normalizeTelegramMessage(update: unknown): TelegramMessage | null {
  if (!isRecord(update)) return null;
  if ("edited_message" in update) return null;

  const message = update.message;
  if (!isRecord(message)) return null;

  const chat = message.chat;
  if (!isRecord(chat) || typeof chat.id !== "number" || chat.type !== "private") return null;

  const from = message.from;
  if (!isRecord(from) || typeof from.id !== "number") return null;

  if (typeof message.message_id !== "number") return null;
  if (typeof message.text !== "string") return null;

  return {
    chatId: String(chat.id),
    messageId: String(message.message_id),
    fromId: from.id,
    text: message.text,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}