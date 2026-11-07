import { Bot, type Context } from "grammy";
import type { Transformer } from "grammy";
import type { FastifyInstance } from "fastify";
import type { TelegramService } from "./telegram.service";
import { unexpectedErrorReply } from "./reply-text";
import { ACCESS_CALLBACK_PREFIX, type AccessService } from "../access/access.service";
import type { InlineKeyboard } from "./telegram.parser";

export type RecordedApiCall = {
  method: string;
  payload: Record<string, unknown>;
};

const FAKE_MESSAGE = {
  message_id: 1,
  date: 0,
  chat: { id: 0, type: "private" as const, first_name: "Rita" },
  text: "",
};

/**
 * Offline middleware (D9): records every outbound Telegram API call as
 * `{ method, payload }` and returns a fake ok response instead of throwing on
 * network access. Lets reply behavior be asserted with zero network calls.
 */
export function recordApiCalls(record: RecordedApiCall[]): Transformer {
  return async (_prev, method, payload) => {
    record.push({ method, payload });
    return { ok: true, result: FAKE_MESSAGE } as never;
  };
}

export function redactToken(value: string, token: string): string {
  return value.replaceAll(token, "[REDACTED]");
}

/** Owner-visible command list registered via setMyCommands at boot (spec bot-main-menu). */
export const BOT_COMMANDS = [
  { command: "menu", description: "Abrí el menú principal" },
  { command: "ayuda", description: "Ayuda y ejemplos de captura" },
  { command: "listar_categorias", description: "Listá tus categorías" },
  { command: "configurar_categorias", description: "Creá, borrá y renombrá categorías" },
  // savings-config (design D10): the parser normalizes `_` → space, so the
  // descriptions teach the full syntax the owner types.
  { command: "registrar_ahorro", description: "Registrá una regla: registrar ahorro: <palabra> al <X>%" },
  // manual-savings (D9): registered alongside the rule commands — the slash
  // form normalizes to "registrar ahorro manual: <monto> [nota]".
  { command: "registrar_ahorro_manual", description: "Registrá un ahorro manual: registrar ahorro manual: <monto> [nota]" },
  { command: "listar_ahorros", description: "Listá tus reglas de ahorro" },
  { command: "borrar_ahorro", description: "Borrá una regla: borrar ahorro: <palabra>" },
] as const;

/**
 * D2 — maps the service's plain reply-port call to grammy's reply/edit
 * mechanisms: a `keyboard` renders as an inline keyboard, an `editMessageId`
 * edits the existing message (falling back to a NEW message with the same
 * content when the edit fails because the original message is gone — spec
 * bot-inline-interactions "Edit failure falls back to a new message").
 * Returns the message id of a newly sent message (undefined when editing) so
 * the service can track the two-step confirmation message.
 */
/**
 * Sentence case: capitalize the first letter of the message and of every new
 * sentence (after . ! ? or a line break). Everything else keeps the case it was
 * written in, so the bot does not shout. The first LETTER is what gets
 * capitalized, so a line that starts with an emoji or an amount still reads
 * properly.
 */
export function sentenceCase(text: string): string {
  return text.replace(
    /(^|[\n]|[.!?] +)(\P{L}*)(\p{L})/gu,
    (_match, boundary: string, skipped: string, letter: string) =>
      `${boundary}${skipped}${letter.toUpperCase()}`,
  );
}

/**
 * The single evolving message per chat: the bot rewrites THIS instead of
 * sending a new one for every step, so a capture leaves no trail of stale
 * menus behind it. In memory on purpose — after a restart the next reply
 * starts a fresh message, which is exactly what you want then.
 */
const surfaces = new Map<number, number>();

/** Tests share the module: this keeps each case starting with a clean chat. */
export function resetReplySurfaces(): void {
  surfaces.clear();
}

/** Telegram throws when an edit would not change anything; that is success for us. */
function isNotModified(error: unknown): boolean {
  const description =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return description.toLowerCase().includes("message is not modified");
}

function buildReplyPort(ctx: Context): (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<number | undefined> {
  return async (text, keyboard, editMessageId) => {
    // The bot speaks in sentence case, never in caps; button labels keep the
    // casing they were authored with.
    const body = sentenceCase(text);
    const replyMarkup =
      keyboard === undefined ? undefined : { inline_keyboard: keyboard.map((row) => row.map((button) => ({ ...button }))) };

    const chatId = ctx.chat?.id;
    const target = editMessageId ?? (chatId === undefined ? undefined : surfaces.get(chatId));

    if (chatId !== undefined && target !== undefined) {
      try {
        await ctx.api.editMessageText(chatId, target, body, { reply_markup: replyMarkup });
        surfaces.set(chatId, target);
        return undefined;
      } catch (error) {
        if (isNotModified(error)) {
          surfaces.set(chatId, target);
          return undefined;
        }
        // The message is gone or not editable: fall through and send a new one,
        // which becomes the surface from now on.
      }
    }

    const sent = await ctx.reply(body, { reply_markup: replyMarkup });
    if (chatId !== undefined) {
      surfaces.set(chatId, sent.message_id);
    }
    return sent.message_id;
  };
}

export function createTelegramBot(
  token: string,
  service: TelegramService,
  access?: AccessService,
): Bot {
  const bot = new Bot(token);

  bot.on("message", async (ctx) => {
    // An unexpected throw used to leave the owner in silence: grammy logged it
    // and nobody answered. Now the failure is logged with its stack and the
    // owner gets an honest apology instead of a dead chat.
    try {
      await service.handleUpdate(ctx.update, buildReplyPort(ctx));
    } catch (error) {
      console.error(
        redactToken(
          error instanceof Error ? (error.stack ?? error.message) : String(error),
          token,
        ),
      );
      await ctx.reply(unexpectedErrorReply()).catch(() => undefined);
    } finally {
      // single-message UX: the bot answers by editing its ONE message, so the
      // owner's messages would pile up below it and the answer would be above
      // them. Removing the incoming text keeps the surface at the bottom of the
      // chat. A failure here is cosmetic and never surfaces.
      if (typeof ctx.message?.text === "string") {
        await ctx.deleteMessage().catch(() => undefined);
      }
    }
  });

  // D4 - the callback channel: parse the callback through the service's
  // handleCallback; every processed callback is answered so the spinner stops.
  //
  // household-isolation: the access decision buttons belong to the target's
  // chat, not to the capture flow, so they are handled here and never reach the
  // capture state machine.
  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data ?? "";
    if (access !== undefined && data.startsWith(ACCESS_CALLBACK_PREFIX)) {
      const outcome = await access.decideFromCallback(
        data,
        (chatId) => service.ownerOfChat(chatId),
        ctx.chat?.id ?? 0,
      );
      const answer = typeof outcome === "string" ? outcome : "Listo";
      await ctx.answerCallbackQuery({ text: answer === "not-access" ? undefined : answer }).catch(
        () => undefined,
      );
      return;
    }
    const processed = await service.handleCallback(ctx.update, buildReplyPort(ctx));
    if (processed) {
      await ctx.answerCallbackQuery().catch(() => undefined);
    }
  });

  bot.catch((err) => {
    const cause = err.error;
    console.error(
      redactToken(
        cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
        token,
      ),
    );
  });

  return bot;
}

/**
 * D12 — boots the bot: registers the owner-visible command list via
 * `setMyCommands` (a failure is logged and never crashes the polling loop —
 * spec bot-main-menu "Registration failure tolerated") and then starts the
 * long-polling loop. `server.ts` swaps `bot.start()` for this helper.
 */
export async function startTelegramBot(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([...BOT_COMMANDS]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  await bot.start();
}

/** Stops the bot when the Fastify app closes (graceful shutdown chain: signals → app.close() → onClose → bot.stop()). */
export function registerGracefulStop(app: FastifyInstance, bot: Bot): void {
  app.addHook("onClose", async () => {
    await bot.stop();
  });
}