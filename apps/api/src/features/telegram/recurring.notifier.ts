import type { Bot } from "grammy";

import type { RecurringConfirmationRecord, RecurringRule } from "../recurring/recurring.repository";
import type { RecurringNotifier } from "../recurring/recurring.service";
import { recurringAskReply, recurringReminderReply, recurringResolvedReply } from "./reply-text";

/** Callback prefix for the two buttons of the recurring question. */
export const RECURRING_CALLBACK_PREFIX = "rf";

export function recurringKeyboard(confirmationId: string) {
  return [
    [
      { text: "✅ OK", callback_data: `${RECURRING_CALLBACK_PREFIX}:ok:${confirmationId}` },
      { text: "✏️ Corregir monto", callback_data: `${RECURRING_CALLBACK_PREFIX}:fix:${confirmationId}` },
    ],
  ];
}

/**
 * The bot side of recurring-fixed-expense: it owns the chat, so the service only
 * describes what happened. `chatIdOf` resolves the owner's chat from the User
 * table — the notifier never guesses a chat.
 */
export function createRecurringNotifier(
  bot: Bot,
  chatIdOf: (ownerId: string) => Promise<string | null>,
): RecurringNotifier {
  async function chatIdFor(ownerId: string): Promise<string | null> {
    return chatIdOf(ownerId);
  }

  return {
    async ask({ confirmation, rule }: { confirmation: RecurringConfirmationRecord; rule: RecurringRule }) {
      const chatId = await chatIdFor(confirmation.ownerId);
      if (chatId === null) return undefined;
      const sent = await bot.api.sendMessage(chatId, recurringAskReply(confirmation.amount, rule.note), {
        reply_markup: { inline_keyboard: recurringKeyboard(confirmation.id) },
      });
      return sent.message_id;
    },

    async remind({ confirmation, rule }: { confirmation: RecurringConfirmationRecord; rule: RecurringRule }) {
      const chatId = await chatIdFor(confirmation.ownerId);
      if (chatId === null) return;
      await bot.api.sendMessage(chatId, recurringReminderReply(confirmation.amount, rule.note), {
        reply_markup: { inline_keyboard: recurringKeyboard(confirmation.id) },
      });
    },

    async resolved({
      confirmation,
      rule,
      amount,
    }: {
      confirmation: RecurringConfirmationRecord;
      rule: RecurringRule;
      amount: number;
    }) {
      const chatId = await chatIdFor(confirmation.ownerId);
      if (chatId === null || confirmation.messageId === null) return;
      try {
        await bot.api.editMessageText(
          chatId,
          confirmation.messageId,
          recurringResolvedReply(amount, rule.note),
        );
      } catch {
        // The message is gone: the decision still stands, nothing else to do.
      }
    },
  };
}
