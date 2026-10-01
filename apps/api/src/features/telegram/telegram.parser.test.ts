import { describe, expect, it } from "vitest";
import type { KeywordRule } from "../categories/matcher";
import {
  buildCallbackData,
  captureParse,
  legacyPrefixKind,
  normalizeTelegramCallback,
  normalizeTelegramMessage,
  parseArrivalPrefixes,
  parseSavingsOverride,
  quickCaptureParse,
} from "./telegram.parser";
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

describe("captureParse (v2 pure parser)", () => {
  it("extracts amount and note without resolving any category", () => {
    expect(captureParse("30000 gym")).toEqual({ amount: 30000, note: "gym" });
  });

  it("parses a multi-word note and keeps it whole", () => {
    expect(captureParse("1500 cafe con leche")).toEqual({ amount: 1500, note: "cafe con leche" });
  });

  it("yields null when no amount is present", () => {
    expect(captureParse("gym")).toBeNull();
  });

  it("yields null on empty or whitespace text", () => {
    expect(captureParse("")).toBeNull();
    expect(captureParse("   ")).toBeNull();
  });

  it("never infers a category: the result carries no category key", () => {
    const result = captureParse("30000 alquiler");
    expect(result).toEqual({ amount: 30000, note: "alquiler" });
    expect(result).not.toHaveProperty("category");
  });
});

describe("legacyPrefixKind (v2 detection-only)", () => {
  it("detects the previsto: prefix", () => {
    expect(legacyPrefixKind("previsto: 2500 alquiler")).toBe("previsto");
  });

  it("detects the 'gasto previsto' and 'gasto fijo previsto' markers with or without the colon", () => {
    expect(legacyPrefixKind("gasto previsto alquiler 2500")).toBe("previsto");
    expect(legacyPrefixKind("gasto fijo previsto: alquiler 2500")).toBe("previsto");
  });

  it("detects the compartido: prefix", () => {
    expect(legacyPrefixKind("compartido: 2000 super")).toBe("compartido");
  });

  it("detects savings-override text (sin ahorro / con X%)", () => {
    expect(legacyPrefixKind("sin ahorro cobro sueldo de entrenuts 1000")).toBe("savings-override");
    expect(legacyPrefixKind("con 5% cobro 1000")).toBe("savings-override");
  });

  it("returns null for plain capture-shaped text", () => {
    expect(legacyPrefixKind("2500 alquiler")).toBeNull();
  });

  it("does not match a lone previsto marker without trailing content", () => {
    expect(legacyPrefixKind("previsto")).toBeNull();
    expect(legacyPrefixKind("previsto:")).toBeNull();
  });

  it("does not match compartido without the colon", () => {
    expect(legacyPrefixKind("compartido el gasto")).toBeNull();
  });

  it("keeps the brake: a plain 'gasto fijo' without the previsto signal is not planned", () => {
    expect(legacyPrefixKind("gasto fijo alquiler 2500")).toBeNull();
  });
});

describe("parseArrivalPrefixes (D10)", () => {
  it("detects a previsto: prefix and strips it, trimming the rest", () => {
    expect(parseArrivalPrefixes("previsto: 2500 alquiler")).toEqual({
      text: "2500 alquiler",
      shared: false,
      planned: true,
    });
    expect(parseArrivalPrefixes("PREVISTO:  2500  alquiler  ")).toEqual({
      text: "2500  alquiler",
      shared: false,
      planned: true,
    });
  });

  it("keeps the compartido: prefix behavior and strips it", () => {
    expect(parseArrivalPrefixes("compartido: $2000 super")).toEqual({
      text: "$2000 super",
      shared: true,
      planned: false,
    });
  });

  it("strips compartido: and previsto: in either order, setting both flags", () => {
    expect(parseArrivalPrefixes("compartido: previsto: 2500 alquiler")).toEqual({
      text: "2500 alquiler",
      shared: true,
      planned: true,
    });
    expect(parseArrivalPrefixes("previsto: compartido: 2500 alquiler")).toEqual({
      text: "2500 alquiler",
      shared: true,
      planned: true,
    });
    // Both flags together are REJECTED downstream by the service (planned
    // expenses are INDIVIDUAL by design); the parser only reports the flags.
  });

  it("returns the text untouched with both flags false when no prefix is present", () => {
    expect(parseArrivalPrefixes("2500 alquiler")).toEqual({ text: "2500 alquiler", shared: false, planned: false });
  });

  it("accepts the previsto marker without the colon (D12)", () => {
    expect(parseArrivalPrefixes("previsto alquiler 2500")).toEqual({
      text: "alquiler 2500",
      shared: false,
      planned: true,
    });
    expect(parseArrivalPrefixes("PREVISTO 2500 alquiler")).toEqual({
      text: "2500 alquiler",
      shared: false,
      planned: true,
    });
  });

  it("accepts 'gasto previsto' and 'gasto fijo previsto' markers with or without the colon", () => {
    expect(parseArrivalPrefixes("gasto previsto alquiler 2500")).toEqual({
      text: "alquiler 2500",
      shared: false,
      planned: true,
    });
    expect(parseArrivalPrefixes("gasto fijo previsto: alquiler 2500")).toEqual({
      text: "alquiler 2500",
      shared: false,
      planned: true,
    });
    expect(parseArrivalPrefixes("Gasto Fijo Previsto alquiler 2500")).toEqual({
      text: "alquiler 2500",
      shared: false,
      planned: true,
    });
  });

  it("does not treat a plain 'gasto fijo' without the previsto signal as planned (the brake)", () => {
    expect(parseArrivalPrefixes("gasto fijo alquiler 2500")).toEqual({
      text: "gasto fijo alquiler 2500",
      shared: false,
      planned: false,
    });
  });

  it("does not treat a trailing previsto word as a planned marker", () => {
    expect(parseArrivalPrefixes("alquiler 2500 previsto")).toEqual({
      text: "alquiler 2500 previsto",
      shared: false,
      planned: false,
    });
  });

  it("does not treat a lone previsto marker as planned (dialog category answers stay intact)", () => {
    expect(parseArrivalPrefixes("previsto")).toEqual({ text: "previsto", shared: false, planned: false });
    expect(parseArrivalPrefixes("previsto:")).toEqual({ text: "previsto:", shared: false, planned: false });
  });

  it("strips the colon-less previsto marker together with compartido: in either order", () => {
    expect(parseArrivalPrefixes("compartido: previsto alquiler 2500")).toEqual({
      text: "alquiler 2500",
      shared: true,
      planned: true,
    });
    expect(parseArrivalPrefixes("previsto compartido: alquiler 2500")).toEqual({
      text: "alquiler 2500",
      shared: true,
      planned: true,
    });
  });
});

describe("parseSavingsOverride", () => {
  it("detects 'sin ahorro' as disabled and strips the prefix, trimming the rest", () => {
    expect(parseSavingsOverride("sin ahorro cobro sueldo de entrenuts 1000")).toEqual({
      ok: true,
      override: { kind: "disabled" },
      text: "cobro sueldo de entrenuts 1000",
    });
    expect(parseSavingsOverride("SIN AHORRO: cobro sueldo 1000")).toEqual({
      ok: true,
      override: { kind: "disabled" },
      text: "cobro sueldo 1000",
    });
  });

  it("detects 'con X%' as a percent override and strips the prefix", () => {
    expect(parseSavingsOverride("con 5% cobro sueldo de entrenuts 1000")).toEqual({
      ok: true,
      override: { kind: "percent", percent: 5 },
      text: "cobro sueldo de entrenuts 1000",
    });
    expect(parseSavingsOverride("con 12,5% cobro 1000")).toEqual({
      ok: true,
      override: { kind: "percent", percent: 12.5 },
      text: "cobro 1000",
    });
  });

  it("rejects an invalid percent override with an error (0 < X <= 100)", () => {
    expect(parseSavingsOverride("con 150% cobro sueldo de entrenuts 1000")).toEqual({
      ok: false,
      error: "invalid_percent",
      percent: 150,
    });
    expect(parseSavingsOverride("con 0% cobro 1000")).toEqual({ ok: false, error: "invalid_percent", percent: 0 });
    expect(parseSavingsOverride("con -5% cobro 1000")).toEqual({ ok: false, error: "invalid_percent", percent: -5 });
  });

  it("returns no override when neither prefix is present", () => {
    expect(parseSavingsOverride("cobro sueldo de entrenuts 1000")).toEqual({
      ok: true,
      override: { kind: "none" },
      text: "cobro sueldo de entrenuts 1000",
    });
  });
});

describe("quickCaptureParse (D4 fast path)", () => {
  const gymRule: KeywordRule = { keyword: "gym", category: "Gimnasio", createdAt: new Date("2026-09-01T10:00:00Z") };
  const cafeRule: KeywordRule = { keyword: "cafe", category: "Cafe", createdAt: new Date("2026-09-01T10:00:01Z") };

  it("parses amount plus a closed-set keyword into {amount, note, category}", () => {
    expect(quickCaptureParse("30000 gym", [gymRule])).toEqual({
      amount: 30000,
      note: "gym",
      category: "Gimnasio",
    });
  });

  it("parses a keyword embedded in a longer note and keeps the note", () => {
    expect(quickCaptureParse("1500 cafe con leche", [cafeRule])).toEqual({
      amount: 1500,
      note: "cafe con leche",
      category: "Cafe",
    });
  });

  it("matches the note against the keyword rules when no note was extracted", () => {
    // "2500 gym" → note "gym"; the category resolution uses the note text.
    expect(quickCaptureParse("2500 gym", [gymRule, cafeRule])).toEqual({
      amount: 2500,
      note: "gym",
      category: "Gimnasio",
    });
  });

  it("misses when there is no amount", () => {
    expect(quickCaptureParse("gym", [gymRule])).toBeNull();
  });

  it("misses when no keyword in the closed set matches the note", () => {
    expect(quickCaptureParse("30000 alquiler", [gymRule])).toBeNull();
  });

  it("misses on empty or whitespace text", () => {
    expect(quickCaptureParse("", [gymRule])).toBeNull();
    expect(quickCaptureParse("   ", [gymRule])).toBeNull();
  });
});

describe("normalizeTelegramCallback (D4 callback channel)", () => {
  function callbackUpdate(overrides?: {
    fromId?: number;
    chatId?: number;
    chatType?: string;
    messageId?: number;
    data?: unknown;
  }): unknown {
    const fromId = overrides?.fromId ?? OWNER_ID;
    return {
      update_id: 9000,
      callback_query: {
        id: "cb_1",
        from: { id: fromId, is_bot: false, first_name: "Rita" },
        message: {
          message_id: overrides?.messageId ?? 77,
          chat: { id: overrides?.chatId ?? fromId, type: overrides?.chatType ?? "private", first_name: "Rita" },
          date: 1712803046,
          text: "preview",
        },
        data: overrides?.data ?? "m:new",
      },
    };
  }

  it("normalizes a private-chat callback with a string data payload", () => {
    expect(normalizeTelegramCallback(callbackUpdate())).toEqual({
      fromId: OWNER_ID,
      chatId: String(OWNER_ID),
      messageId: 77,
      data: "m:new",
    });
  });

  it("returns null for a message update (no callback_query)", () => {
    expect(normalizeTelegramCallback(textUpdate())).toBeNull();
  });

  it("returns null for an edited_message update", () => {
    expect(
      normalizeTelegramCallback({
        update_id: 2,
        edited_message: { message_id: 42, from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: "private" }, text: "x" },
      }),
    ).toBeNull();
  });

  it("returns null for a callback from a group chat", () => {
    expect(normalizeTelegramCallback(callbackUpdate({ chatType: "group", chatId: -100123456789 }))).toBeNull();
  });

  it("returns null when the callback data is missing", () => {
    const update = callbackUpdate() as { callback_query: Record<string, unknown> };
    delete update.callback_query.data;
    expect(normalizeTelegramCallback(update)).toBeNull();
  });

  it("returns null when the callback data is not a string", () => {
    expect(normalizeTelegramCallback(callbackUpdate({ data: 42 }))).toBeNull();
  });

  it("returns null when the callback has no from", () => {
    const update = callbackUpdate() as { callback_query: Record<string, unknown> };
    delete update.callback_query.from;
    expect(normalizeTelegramCallback(update)).toBeNull();
  });

  it("returns null for a non-object update", () => {
    expect(normalizeTelegramCallback(null)).toBeNull();
    expect(normalizeTelegramCallback("nope")).toBeNull();
  });
});

describe("buildCallbackData (D4 byte budget)", () => {
  it("joins the action parts with colons", () => {
    expect(buildCallbackData(["pv", "save", "a1b2c3d4"])).toBe("pv:save:a1b2c3d4");
  });

  it("keeps a 64-byte ASCII payload under the Telegram limit", () => {
    const data = buildCallbackData(["dc", "ok", "c".repeat(25)]); // 3 + 2 + 25 + 2 separators = 32
    expect(data.length).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });

  it("throws when the payload exceeds 64 bytes", () => {
    expect(() => buildCallbackData(["cat", "c".repeat(70)])).toThrow(/64/);
  });

  it("throws on non-ASCII callback data", () => {
    expect(() => buildCallbackData(["cat", "café"])).toThrow(/ASCII/);
  });
});