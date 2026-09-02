import { UnauthorizedError } from "../../infra/errors";
import type { ExpenseService } from "../expenses/expenses.service";
import { classifyMovementType, parseAmountAndNote } from "../messages/message.parser";
import { extractMessages } from "./webhook.parser";
import { verifyWebhookSignature } from "./webhook.signature";
import { isUniqueConstraintViolation, type ProcessedMessageRepository } from "./webhook.repository";
import type { WebhookMessage } from "./webhook.types";

export type WebhookServiceDeps = {
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  appSecret: string;
  ownerPhone: string;
  ownerId: string;
  logger?: (message: string) => void;
};

export class WebhookService {
  constructor(private readonly deps: WebhookServiceDeps) {}

  async handleIncoming(payload: unknown, rawBody: string | Buffer, signature: string | undefined): Promise<void> {
    if (!verifyWebhookSignature(rawBody, signature, this.deps.appSecret)) {
      throw new UnauthorizedError("Invalid or missing X-Hub-Signature-256");
    }

    const messages = extractMessages(payload);
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: WebhookMessage): Promise<void> {
    try {
      await this.deps.messageRepository.recordProcessed(message.id, this.deps.ownerId);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        this.deps.logger?.(`Webhook: message ${message.id} already processed, skipping`);
        return;
      }
      throw error;
    }

    if (message.from !== this.deps.ownerPhone) {
      this.deps.logger?.(`Webhook: ignoring message ${message.id} from non-owner ${message.from}`);
      return;
    }

    const body = message.text?.body;
    if (body === undefined || body.trim().length === 0) {
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
      this.deps.logger?.(`Webhook: failed to create expense for message ${message.id}: ${String(error)}`);
    }
  }
}
