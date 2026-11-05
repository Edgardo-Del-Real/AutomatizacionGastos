import type { RecurringConfirmationRecord, RecurringRepository, RecurringRule } from "./recurring.repository";
import { nextRunAfter, baPeriodKey } from "./recurring.schedule";

/** The bot side of the feature: it sends the question and edits it afterwards. */
export interface RecurringNotifier {
  /** Sends the "¿confirmás este monto?" message; returns the Telegram message id. */
  ask(input: {
    confirmation: RecurringConfirmationRecord;
    rule: RecurringRule;
  }): Promise<number | undefined>;
  /** Second nudge, 24 h later, once. */
  remind(input: {
    confirmation: RecurringConfirmationRecord;
    rule: RecurringRule;
  }): Promise<void>;
  /** Rewrites the message once the owner decided. */
  resolved(input: {
    confirmation: RecurringConfirmationRecord;
    rule: RecurringRule;
    amount: number;
    created: boolean;
  }): Promise<void>;
}

/** The expense the confirmation turns into. */
export interface RecurringExpenseWriter {
  create(input: {
    ownerId: string;
    amount: number;
    note: string | null;
    category: string;
    occurredAt: Date;
  }): Promise<void>;
}

/**
 * A rule whose scheduled moment is older than this is skipped instead of
 * asked: sending "¿confirmás el alquiler de diciembre?" on December 27th is
 * worse than losing the month.
 */
const CATCH_UP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** The reminder fires one day after the question. */
const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;

export class RecurringService {
  constructor(
    private readonly repository: RecurringRepository,
    private readonly expenses: RecurringExpenseWriter,
    private readonly notifier: RecurringNotifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: {
    ownerId: string;
    amount: number;
    note: string | null;
    category: string;
    notifyDay: number;
  }): Promise<RecurringRule> {
    const next = nextRunAfter(this.now(), input.notifyDay);
    const rule = await this.repository.create({ ...input, nextRunAt: next });
    // A template created for a day that is still ahead (even today) must be
    // armed right away, not on the next natural wake-up.
    this.onCreated?.();
    return rule;
  }

  private onCreated: (() => void) | undefined;

  /** The scheduler registers here so a new rule re-arms the timer. */
  setCreatedHook(hook: () => void): void {
    this.onCreated = hook;
  }

  async listByOwner(ownerId: string): Promise<RecurringRule[]> {
    return this.repository.listByOwner(ownerId);
  }

  /**
   * Everything the scheduler needs, in one pass: creates this month's
   * confirmation for every due rule, asks, and moves the rule to its next
   * month. Idempotent by the (recurringId, period) unique key.
   */
  async processDue(): Promise<number> {
    const now = this.now();
    const due = await this.repository.findDue(now);
    let asked = 0;

    for (const rule of due) {
      const late = now.getTime() - rule.nextRunAt.getTime();
      if (late > CATCH_UP_WINDOW_MS) {
        // Too late to be useful: consume the month without asking.
        await this.repository.advance(rule.id, nextRunAfter(now, rule.notifyDay));
        continue;
      }

      const confirmation = await this.repository.createConfirmationIfMissing({
        recurringId: rule.id,
        ownerId: rule.ownerId,
        period: baPeriodKey(rule.nextRunAt),
        amount: rule.amount,
        scheduledAt: rule.nextRunAt,
      });

      if (confirmation !== null) {
        const messageId = await this.notifier.ask({ confirmation, rule });
        if (messageId !== undefined) {
          await this.repository.setMessageId(confirmation.id, messageId);
        }
        asked += 1;
      }

      await this.repository.advance(rule.id, nextRunAfter(rule.nextRunAt, rule.notifyDay));
    }

    return asked;
  }

  /** One reminder for every question still unanswered after 24 h. */
  async remindPending(): Promise<number> {
    const now = this.now();
    const cutoff = new Date(now.getTime() - REMIND_AFTER_MS);
    const pending = await this.repository.findPendingOlderThan(cutoff);
    let reminded = 0;

    for (const confirmation of pending) {
      const rules = await this.repository.listByOwner(confirmation.ownerId);
      const rule = rules.find((candidate) => candidate.id === confirmation.recurringId);
      await this.repository.markReminded(confirmation.id, now);
      if (rule === undefined) continue;
      await this.notifier.remind({ confirmation, rule });
      reminded += 1;
    }

    return reminded;
  }

  /**
   * The owner said the amount is right (or typed a new one). The expense lands
   * as a PAID movement on the day it was due, and the confirmation is closed.
   * Deciding twice is a no-op: only a PENDING confirmation can be resolved.
   */
  async confirm(confirmationId: string, amount?: number): Promise<boolean> {
    const confirmation = await this.repository.findConfirmation(confirmationId);
    if (confirmation === null || confirmation.status !== "PENDING") {
      return false;
    }
    const rules = await this.repository.listByOwner(confirmation.ownerId);
    const rule = rules.find((candidate) => candidate.id === confirmation.recurringId);
    if (rule === undefined) {
      return false;
    }

    const finalAmount = amount ?? confirmation.amount;
    await this.expenses.create({
      ownerId: confirmation.ownerId,
      amount: finalAmount,
      note: rule.note,
      category: rule.category,
      occurredAt: confirmation.scheduledAt,
    });
    await this.repository.markDecided(confirmation.id, "CONFIRMED", this.now());
    await this.notifier.resolved({
      confirmation,
      rule,
      amount: finalAmount,
      created: true,
    });
    return true;
  }

  /** The earliest moment the scheduler should wake for, or null. */
  async nextWakeAt(): Promise<Date | null> {
    return this.repository.nextWakeAt();
  }
}
