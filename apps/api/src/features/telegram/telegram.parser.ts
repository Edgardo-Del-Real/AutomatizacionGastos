import type { SavingsOverride } from "../savings/savings.types";
import { matchCategory, type KeywordRule } from "../categories/matcher";
import { parseAmountAndNote } from "../messages/message.parser";
import type { TelegramMessage } from "./telegram.types";

/**
 * D2/D4 — inline keyboard DTOs. Plain data-transfer objects (never grammy
 * types inside the service): `InlineKeyboard` is rows of buttons, at most 8
 * rows per Telegram's limit. The production wiring maps these to grammy's
 * `reply_markup`; the offline harness records them as-is.
 */
export type InlineButton = { text: string; callback_data: string };
export type InlineKeyboard = InlineButton[][]; // rows, ≤ 8

/**
 * D4 — normalized callback payload from a `callback_query` update: the sender
 * id (owner resolution gate), the source chat, the source message id (edit
 * target) and the `data` action string. Produced by `normalizeTelegramCallback`.
 */
export type TelegramCallback = {
  fromId: number;
  chatId: string;
  messageId: number;
  data: string;
};

/**
 * D4 — deterministic quick-capture result: the amount parsed by the shared
 * amount parsers and the category resolved by keyword matching against the
 * owner's CLOSED category set. A miss returns null and falls through to
 * normal routing (spec quick-capture "Deterministic Capture Parser").
 */
export type QuickCapture = { amount: number; note: string | null; category: string };

/**
 * D4 — pure quick-capture parser. Extracts the amount via `parseAmountAndNote`
 * and resolves the category via `matchCategory(note ?? text, rules)` against
 * the owner's closed-set keyword rules. Never creates categories, never calls
 * the LLM, never writes state. Misses when there is no amount or no keyword in
 * the closed set matches.
 */
export function quickCaptureParse(text: string, rules: KeywordRule[]): QuickCapture | null {
  const parsed = parseAmountAndNote(text);
  if (parsed === null) {
    return null;
  }
  const category = matchCategory(parsed.note ?? text, rules);
  if (category === null) {
    return null;
  }
  return { amount: parsed.amount, note: parsed.note, category };
}

/**
 * D4 — normalizes a `callback_query` update into the `TelegramCallback` DTO.
 * Only private chats with a string `data` and a numeric `from.id` qualify;
 * `edited_message`, group chats, missing data and non-object updates return
 * null (spec telegram-bot "Update Filtering", bot-inline-interactions
 * "Callback Query Routing").
 */
export function normalizeTelegramCallback(update: unknown): TelegramCallback | null {
  if (!isRecord(update)) return null;

  const callback = update.callback_query;
  if (!isRecord(callback)) return null;

  const from = callback.from;
  if (!isRecord(from) || typeof from.id !== "number") return null;

  const message = callback.message;
  if (!isRecord(message) || typeof message.message_id !== "number") return null;

  const chat = message.chat;
  if (!isRecord(chat) || typeof chat.id !== "number" || chat.type !== "private") return null;

  if (typeof callback.data !== "string") return null;

  return {
    fromId: from.id,
    chatId: String(chat.id),
    messageId: message.message_id,
    data: callback.data,
  };
}

/**
 * D4 — builds a `callback_data` payload from colon-joined action parts and
 * asserts the Telegram limits: ASCII-only and at most 64 bytes. A violation
 * throws (a payload that would break the bot must never be built silently).
 */
export function buildCallbackData(parts: string[]): string {
  const data = parts.join(":");
  if (!/^[\x20-\x7E]*$/.test(data)) {
    throw new Error(`callback_data must be ASCII-only, got: ${data}`);
  }
  if (Buffer.byteLength(data, "utf8") > 64) {
    throw new Error(`callback_data exceeds 64 bytes: ${data}`);
  }
  return data;
}

/**
 * v2 — pure capture parser (spec quick-capture "Deterministic Capture Parser"):
 * extracts `{amount, note}` via the shared amount parsers and NEVER resolves,
 * infers or matches a category — the category is chosen by button at the
 * preview. Text with no parseable amount yields null. Never calls the LLM,
 * never writes state. Replaces `quickCaptureParse` once the service stops
 * consuming keyword rules (the keyword data stays intact for the dashboard).
 */
export type CaptureParse = { amount: number; note: string | null };

export function captureParse(text: string): CaptureParse | null {
  return parseAmountAndNote(text);
}

/**
 * D10 — the arrival prefixes (`compartido:` and `previsto:`) are parsed ONCE
 * at arrival by a loop that strips them in ANY order. Both are authoritative
 * (they work without the bot brain and win over brain signals): "compartido:
 * previsto: 2500 alquiler" and "previsto: compartido: 2500 alquiler" produce
 * the same { text, shared, planned } result. A message carrying BOTH flags is
 * rejected by the service with an educational redirect — planned expenses are
 * INDIVIDUAL by design and never combine with `compartido:`.
 */
export type ArrivalPrefixes = { text: string; shared: boolean; planned: boolean };

const ARRIVAL_PREFIXES: readonly { re: RegExp; apply: (prefixes: ArrivalPrefixes) => void }[] = [
  { re: /^compartido\s*:\s*/i, apply: (prefixes) => void (prefixes.shared = true) },
  {
    // D12 — the previsto marker is tolerant: "previsto" with or without the
    // colon, plus the product phrasings "gasto previsto" / "gasto fijo
    // previsto". It requires CONTENT after the marker (a marker alone is not a
    // registration, and a lone "previsto" answer in a dialog stays a category
    // answer). The brake: a plain "gasto fijo" WITHOUT the previsto word is a
    // normal paid expense and never marks planned.
    re: /^(?:gasto\s+fijo\s+|gasto\s+)?previsto\s*:?\s+/i,
    apply: (prefixes) => void (prefixes.planned = true),
  },
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
const COMPARTIDO_PREFIX_RE = /^compartido\s*:\s*/i;
const PREVISTO_PREFIX_RE = /^(?:gasto\s+fijo\s+|gasto\s+)?previsto\s*:?\s+/i;

/**
 * v2 — detection-only legacy-prefix classifier (design D8, spec
 * bot-free-text-routing "Legacy Prefix Redirect"): classifies the legacy
 * `previsto:`, `compartido:` and savings-override ("sin ahorro" / "con X%")
 * text surfaces so idle routing can reply with the matching educational
 * redirect. Never strips, never parses amounts, never changes state, never
 * calls the LLM. The "previsto" marker requires trailing content (a lone
 * "previsto" / "previsto:" is not a legacy message); "compartido" requires
 * the colon; a plain "gasto fijo" without the previsto word is not a prefix
 * (the brake, mirroring the legacy arrival-parser semantics).
 */
export type LegacyPrefixKind = "previsto" | "compartido" | "savings-override";

export function legacyPrefixKind(text: string): LegacyPrefixKind | null {
  if (COMPARTIDO_PREFIX_RE.test(text)) {
    return "compartido";
  }
  if (PREVISTO_PREFIX_RE.test(text)) {
    return "previsto";
  }
  if (SIN_AHORRO_RE.test(text) || CON_PERCENT_RE.test(text)) {
    return "savings-override";
  }
  return null;
}

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