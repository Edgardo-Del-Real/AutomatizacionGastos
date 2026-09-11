import type { CategoryService } from "../categories/categories.service";
import { firstSignificantWord, normalizeForMatch } from "../categories/matcher";
import type { ExpenseService } from "../expenses/expenses.service";
import { classifyMovementType, parseAmountAndNote, type ParsedAmount } from "../messages/message.parser";
import { isUniqueConstraintViolation, type ProcessedMessageRepository } from "../messages/message.repository";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { MovementService } from "../movements/movements.service";
import type { BotStateRecord, BotStateRepository } from "./bot-state.repository";
import { parseCommand, type TelegramCommand } from "./telegram.commands";
import { normalizeTelegramMessage } from "./telegram.parser";
import {
  categoryCreatedReply,
  categoryErrorReply,
  categoryListReply,
  categoryRenamedReply,
  correctionDoneReply,
  correctionQuestionReply,
  duplicateCategoryReply,
  helpReply,
  keywordAssociatedReply,
  missingCategoryReply,
  movementMissingReply,
  setupDoneReply,
  setupQuestionReply,
  setupRetryReply,
  successReply,
} from "./reply-text";

export type ReplyPort = (text: string) => Promise<void>;

export type TelegramServiceDeps = {
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  movementService: MovementService;
  categoryService: CategoryService;
  botStateRepository: BotStateRepository;
  ownerChatId: number;
  ownerId: string;
  logger?: (message: string) => void;
};

const IDLE = "idle";
const AWAITING_SETUP = "awaiting_setup";
const AWAITING_CATEGORY = "awaiting_category";

export class TelegramService {
  constructor(private readonly deps: TelegramServiceDeps) {}

  async handleUpdate(update: unknown, reply?: ReplyPort): Promise<void> {
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

    // Commands are checked before state consumption in every state (D6).
    const command = parseCommand(body);
    if (command !== null) {
      await this.handleCommand(command, reply);
      return;
    }

    const ownerId = this.deps.ownerId;
    const state = await this.deps.botStateRepository.get(ownerId);

    if (state?.state === AWAITING_SETUP) {
      await this.handleSetupReply(body, reply);
      return;
    }

    if (state?.state === AWAITING_CATEGORY) {
      await this.handleAwaitingCategory(state, body, reply);
      return;
    }

    await this.handleRegistration(body, reply);
  }

  private async handleRegistration(body: string, reply?: ReplyPort): Promise<void> {
    const parsed = parseAmountAndNote(body);
    if (parsed === null) {
      await this.safeReply(reply, helpReply());
      return;
    }

    const ownerId = this.deps.ownerId;
    const categories = await this.deps.categoryService.listCategories(ownerId);

    // D7: an owner with no categories enters setup; the registration is not persisted.
    if (categories.length === 0) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_SETUP,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.safeReply(reply, setupQuestionReply());
      return;
    }

    const note = parsed.note ?? body;
    const matched = await this.deps.categoryService.matchNote(ownerId, note);

    if (matched !== null) {
      const movement = await this.createMovement(body, parsed, matched);
      if (movement !== null) {
        await this.deps.botStateRepository.set({
          ownerId,
          state: IDLE,
          pendingMovementId: null,
          pendingNote: null,
        });
        await this.safeReply(reply, successReply(parsed.amount, parsed.note, matched));
      }
      return;
    }

    await this.deps.categoryService.ensureOtro(ownerId);
    const movement = await this.createMovement(body, parsed, "otro");
    if (movement !== null) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_CATEGORY,
        pendingMovementId: movement.id,
        pendingNote: note,
      });
      await this.safeReply(reply, correctionQuestionReply(note));
    }
  }

  private async handleSetupReply(body: string, reply?: ReplyPort): Promise<void> {
    const ownerId = this.deps.ownerId;
    const names = this.extractCategoryNames(body);
    if (names.length === 0) {
      await this.safeReply(reply, setupRetryReply());
      return;
    }

    const existing = await this.deps.categoryService.listCategories(ownerId);
    const existingNormalized = new Set(existing.map((category) => normalizeForMatch(category.name)));

    const created: string[] = [];
    for (const name of names) {
      if (normalizeForMatch(name) === "otro") {
        continue; // the fallback is created by ensureOtro below
      }
      if (existingNormalized.has(normalizeForMatch(name))) {
        continue;
      }
      try {
        await this.deps.categoryService.createCategory(ownerId, name);
        created.push(name);
        existingNormalized.add(normalizeForMatch(name));
      } catch (error) {
        if (error instanceof ValidationFailedError) {
          continue; // duplicate raced in — skip
        }
        throw error;
      }
    }

    await this.deps.categoryService.ensureOtro(ownerId);
    const finalCreated = this.dedupeNames(created);
    if (!finalCreated.some((name) => normalizeForMatch(name) === "otro")) {
      finalCreated.push("otro");
    }

    await this.deps.botStateRepository.set({
      ownerId,
      state: IDLE,
      pendingMovementId: null,
      pendingNote: null,
    });
    await this.safeReply(reply, setupDoneReply(finalCreated));
  }

  private async handleAwaitingCategory(
    state: BotStateRecord,
    body: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const normalizedText = normalizeForMatch(body);
    const trimmed = body.trim();

    // D6 rule 1: exact normalized match on an existing category name → ANSWER
    // (multi-word names; a category named "500" beats an amount).
    const exactCategory = categories.find((category) => normalizeForMatch(category.name) === normalizedText);
    if (exactCategory !== undefined) {
      await this.answerCorrection(state, exactCategory.name, reply);
      return;
    }

    // D6 rule 2: parses as amount → NEW registration; the new pending replaces the old.
    if (parseAmountAndNote(body) !== null) {
      await this.handleRegistration(body, reply);
      return;
    }

    // D6 rule 3: a single token → ANSWER + auto-create.
    if (trimmed.split(/\s+/).length === 1) {
      const created = await this.deps.categoryService.createCategory(ownerId, trimmed);
      await this.answerCorrection(state, created.name, reply);
      return;
    }

    // D6 rule 4: everything else follows the registration path (unparseable → help).
    await this.handleRegistration(body, reply);
  }

  private async answerCorrection(
    state: BotStateRecord,
    category: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;

    if (state.pendingMovementId !== null) {
      try {
        await this.deps.movementService.updateMovement(ownerId, state.pendingMovementId, { category });
      } catch (error) {
        this.deps.logger?.(`Telegram: failed to reassign movement ${state.pendingMovementId}: ${String(error)}`);
        // D5: a deleted pending movement resets the state to idle with a reply.
        await this.deps.botStateRepository.set({
          ownerId,
          state: IDLE,
          pendingMovementId: null,
          pendingNote: null,
        });
        const text = error instanceof NotFoundError ? movementMissingReply() : categoryErrorReply("no se pudo actualizar el movimiento");
        await this.safeReply(reply, text);
        return;
      }

      const word = firstSignificantWord(state.pendingNote ?? "");
      if (word !== null) {
        try {
          await this.deps.categoryService.associateKeyword(ownerId, word, category);
        } catch (error) {
          this.deps.logger?.(`Telegram: failed to learn keyword: ${String(error)}`);
        }
      }
    }

    await this.deps.botStateRepository.set({
      ownerId,
      state: IDLE,
      pendingMovementId: null,
      pendingNote: null,
    });
    await this.safeReply(reply, correctionDoneReply(category));
  }

  private async handleCommand(command: TelegramCommand, reply?: ReplyPort): Promise<void> {
    const ownerId = this.deps.ownerId;

    switch (command.type) {
      case "register": {
        try {
          await this.deps.categoryService.createCategory(ownerId, command.name);
        } catch (error) {
          if (error instanceof ValidationFailedError) {
            await this.safeReply(reply, duplicateCategoryReply(command.name));
            return;
          }
          throw error;
        }
        await this.safeReply(reply, categoryCreatedReply(command.name));
        return;
      }

      case "rename": {
        try {
          const renamed = await this.deps.categoryService.renameCategory(ownerId, command.from, command.to);
          if (renamed === null) {
            await this.safeReply(reply, missingCategoryReply(command.from));
            return;
          }
        } catch (error) {
          if (error instanceof ValidationFailedError) {
            await this.safeReply(reply, duplicateCategoryReply(command.to));
            return;
          }
          throw error;
        }
        await this.safeReply(reply, categoryRenamedReply(command.from, command.to));
        return;
      }

      case "associate": {
        try {
          await this.deps.categoryService.associateKeyword(ownerId, command.keyword, command.category);
        } catch (error) {
          if (error instanceof NotFoundError) {
            await this.safeReply(reply, missingCategoryReply(command.category));
            return;
          }
          throw error;
        }
        await this.safeReply(reply, keywordAssociatedReply(command.keyword, command.category));
        return;
      }

      case "list": {
        const categories = await this.deps.categoryService.listCategories(ownerId);
        await this.safeReply(reply, categoryListReply(categories));
        return;
      }

      case "configurar": {
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_SETUP,
          pendingMovementId: null,
          pendingNote: null,
        });
        await this.safeReply(reply, setupQuestionReply());
        return;
      }
    }
  }

  private async createMovement(
    body: string,
    parsed: ParsedAmount,
    category: string,
  ): Promise<{ id: string } | null> {
    try {
      return await this.deps.expenseService.createExpense(
        {
          amount: parsed.amount,
          currency: "ARS",
          note: parsed.note,
          occurredAt: new Date(),
          type: classifyMovementType(body),
          category,
        },
        this.deps.ownerId,
      );
    } catch (error) {
      this.deps.logger?.(`Telegram: failed to create movement: ${String(error)}`);
      return null;
    }
  }

  private async safeReply(reply: ReplyPort | undefined, text: string): Promise<void> {
    if (reply === undefined) {
      return;
    }
    try {
      await reply(text);
    } catch (error) {
      this.deps.logger?.(`Telegram: reply failed: ${String(error)}`);
    }
  }

  private extractCategoryNames(body: string): string[] {
    const raw = body
      .split(/[\n,]+/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    return this.dedupeNames(raw);
  }

  private dedupeNames(names: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const name of names) {
      const key = normalizeForMatch(name);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(name);
    }
    return unique;
  }
}