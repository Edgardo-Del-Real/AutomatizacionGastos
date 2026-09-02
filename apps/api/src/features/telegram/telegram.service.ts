import type { ExpenseService } from "../expenses/expenses.service";
import { classifyMovementType, parseAmountAndNote } from "../messages/message.parser";
import { isUniqueConstraintViolation, type ProcessedMessageRepository } from "../messages/message.repository";
import { normalizeTelegramMessage } from "./telegram.parser";

export type TelegramServiceDeps = {
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  ownerChatId: number;
  ownerId: string;
  logger?: (message: string) => void;
};

export class TelegramService {
  constructor(private readonly deps: TelegramServiceDeps) {}

  async handleUpdate(update: unknown): Promise<void> {
    const message = normalizeTelegramMessage(update);
    if (message === null) {
      return;
    }

    try {
      await this.deps.messageRepository.recordProcessed(message.chatId, message.messageId, this.deps.ownerId);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        this.deps.logger?.(`Telegram: message ${message.messageId} already processed, skipping`);
        return;
      }
      throw error;
    }

    if (message.fromId !== this.deps.ownerChatId) {
      this.deps.logger?.(`Telegram: ignoring message ${message.messageId} from non-owner ${message.fromId}`);
      return;
    }

    const body = message.text;
    if (body.trim().length === 0) {
      return;
    }

    const parsed = parseAmountAndNote(body);
    if (parsed === null) {
      return;
    }

    try {
      await this.deps.expenseService.createExpense(
        {
          amount: parsed.amount,
          currency: "ARS",
          note: parsed.note,
          occurredAt: new Date(),
          type: classifyMovementType(body),
        },
        this.deps.ownerId,
      );
    } catch (error) {
      this.deps.logger?.(`Telegram: failed to create expense for message ${message.messageId}: ${String(error)}`);
    }
  }
}