import { describe, expect, it } from "vitest";
import { normalizeTelegramMessage } from "./telegram.parser";
import type { TelegramMessage } from "./telegram.types";

const OWNER_ID = 123456789;

function textUpdate(overrides?: { fromId?: number; chatId?: number; messageId?: number; text?: string; chatType?: string }): unknown {
  const fromId = overrides?.fromId ?? OWNER_ID;
  return {
    update_id: 8000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: fromId, is_bot: false, first_name: "Rita" },
      chat: { id: overrides?.chatId ?? fromId, type: overrides?.chatType ?? "private", first_name: "Rita" },
      date: 1712803046,
      text: overrides?.text ?? "café 2500",
    },
  };
}

describe("normalizeTelegramMessage", () => {
  it("returns a TelegramMessage for a private text message from a user", () => {
    const expected: TelegramMessage = { chatId: "123456789", messageId: "42", fromId: OWNER_ID, text: "café 2500" };

    expect(normalizeTelegramMessage(textUpdate())).toEqual(expected);
  });

  it("keeps a message id that is not numeric-safe as the raw chat-scoped id", () => {
    const update = textUpdate({ messageId: 987654321, chatId: 111111111, text: "pan 100" });

    expect(normalizeTelegramMessage(update)).toEqual({
      chatId: "111111111",
      messageId: "987654321",
      fromId: OWNER_ID,
      text: "pan 100",
    });
  });

  it("returns null for an update without a message (callback_query)", () => {
    expect(normalizeTelegramMessage({ update_id: 1, callback_query: { id: "cb_1" } })).toBeNull();
  });

  it("returns null for an edited_message update", () => {
    expect(
      normalizeTelegramMessage({
        update_id: 2,
        edited_message: { message_id: 42, from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: "private" }, text: "café 2500" },
      }),
    ).toBeNull();
  });

  it("returns null for a message in a group chat", () => {
    expect(normalizeTelegramMessage(textUpdate({ chatType: "group", chatId: -100123456789 }))).toBeNull();
  });

  it("returns null for a message in a supergroup chat", () => {
    expect(normalizeTelegramMessage(textUpdate({ chatType: "supergroup", chatId: -100987654321 }))).toBeNull();
  });

  it("returns null for a message without text (photo)", () => {
    const photoUpdate = {
      update_id: 3,
      message: {
        message_id: 43,
        from: { id: OWNER_ID, is_bot: false, first_name: "Rita" },
        chat: { id: OWNER_ID, type: "private" },
        date: 1712803046,
        photo: [{ file_id: "photo_1" }],
      },
    };

    expect(normalizeTelegramMessage(photoUpdate)).toBeNull();
  });

  it("returns null for a message without a sender (missing from)", () => {
    const update = {
      update_id: 4,
      message: { message_id: 44, chat: { id: OWNER_ID, type: "private" }, text: "café 2500" },
    };

    expect(normalizeTelegramMessage(update)).toBeNull();
  });

  it("returns null for a channel_post update", () => {
    expect(
      normalizeTelegramMessage({
        update_id: 5,
        channel_post: { message_id: 45, chat: { id: -100123, type: "channel" }, text: "café 2500" },
      }),
    ).toBeNull();
  });

  it("returns null for a non-object update", () => {
    expect(normalizeTelegramMessage(null)).toBeNull();
    expect(normalizeTelegramMessage("nope")).toBeNull();
  });
});