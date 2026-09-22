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