import type { PartnerNoticeInput, TelegramService } from "./telegram.service";
import type { RecurringService } from "../recurring/recurring.service";
import type { RecurringNotifier } from "../recurring/recurring.service";

export type TelegramMessage = {
  chatId: string;
  messageId: string;
  fromId: number;
  text: string;
};

declare module "fastify" {
  interface FastifyInstance {
    telegramService: TelegramService;
    /** recurring-fixed-expense: the scheduler and the notifier wiring need it. */
    recurringService: RecurringService;
    /** Late-bound after the bot exists (the notifier needs its API client). */
    bindRecurringNotifier: (notifier: RecurringNotifier) => void;
    /** shared-expense-split: same, for the partner's notice. */
    bindPartnerNotifier: (fn: (input: PartnerNoticeInput) => Promise<void>) => void;
  }
}