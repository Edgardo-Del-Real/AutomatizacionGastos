import type { WebhookMessage } from "./webhook.types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}