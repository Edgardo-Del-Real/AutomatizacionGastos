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
 * v2 — pure capture parser (spec quick-capture "Deterministic Capture Parser"):
 * extracts `{amount, note}` via the shared amount parsers and NEVER resolves,
 * infers or matches a category — the category is chosen by button at the
 * preview. Text with no parseable amount yields null. Never calls the LLM,
 * never writes state. The pre-v2 keyword-based `quickCaptureParse` and the
 * arrival-prefix parsers are removed: keyword rules are NOT consulted by any
 * bot path (the data stays intact for the dashboard).
 */
export type CaptureParse = { amount: number; note: string | null };

export function captureParse(text: string): CaptureParse | null {
  return parseAmountAndNote(text);
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

const COMPARTIDO_PREFIX_RE = /^compartido\s*:\s*/i;
const PREVISTO_PREFIX_RE = /^(?:gasto\s+fijo\s+|gasto\s+)?previsto\s*:?\s+/i;
const SIN_AHORRO_RE = /^sin ahorro\s*:?\s*/i;
const CON_PERCENT_RE = /^con\s+(-?\d+(?:[.,]\d+)?)\s*%/i;

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