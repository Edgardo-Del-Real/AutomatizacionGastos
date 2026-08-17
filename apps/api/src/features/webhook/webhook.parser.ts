import type { WebhookMessage } from "./webhook.types";

export type ParsedAmount = {
  amount: number;
  note: string | null;
};

const NUMBER_TOKEN_REGEX = /\d[\d.,]*/g;

export function parseAmount(body: string): number | null {
  const tokens = body.match(NUMBER_TOKEN_REGEX) ?? [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    const amount = parseNumberToken(token);
    if (amount !== null) return amount;
  }
  return null;
}

export function extractNote(body: string): string | null {
  const tokens = body.match(NUMBER_TOKEN_REGEX) ?? [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (parseNumberToken(token) === null) continue;
    const index = body.lastIndexOf(token);
    const cleaned = `${body.slice(0, index)}${body.slice(index + token.length)}`
      .replace(/\s{2,}/g, " ")
      .trim();
    return cleaned.length > 0 ? cleaned : null;
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAmountAndNote(body: string): ParsedAmount | null {
  const amount = parseAmount(body);
  if (amount === null) return null;
  return { amount, note: extractNote(body) };
}

export function extractMessages(payload: unknown): WebhookMessage[] {
  if (!isRecord(payload)) return [];
  const entries = payload.entry;
  if (!Array.isArray(entries)) return [];
  const messages: WebhookMessage[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const changes = entry.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!isRecord(change)) continue;
      const value = isRecord(change.value) ? change.value : {};
      const rawMessages = value.messages;
      if (!Array.isArray(rawMessages)) continue;
      for (const rawMessage of rawMessages) {
        const message = isRecord(rawMessage) ? rawMessage : {};
        if (typeof message.id !== "string" || message.id.length === 0) continue;
        const text = isRecord(message.text) && typeof message.text.body === "string" ? { body: message.text.body } : null;
        messages.push({
          id: message.id,
          from: typeof message.from === "string" ? message.from : "",
          type: typeof message.type === "string" ? message.type : "",
          text,
        });
      }
    }
  }
  return messages;
}

function parseNumberToken(token: string): number | null {
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) return Number(token.replaceAll(".", ""));
  if (/^\d{1,3}(?:,\d{3})+$/.test(token)) return Number(token.replaceAll(",", ""));
  if (/^\d+$/.test(token)) return Number(token);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
