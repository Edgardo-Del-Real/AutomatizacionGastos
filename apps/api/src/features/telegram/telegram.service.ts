import { z } from "zod";
import type { CategoryService } from "../categories/categories.service";
import { normalizeForMatch } from "../categories/matcher";
import type { CategoryWithKeywords } from "../categories/categories.types";
import type { ExpenseService } from "../expenses/expenses.service";
import {
  classifyMovementType,
  extractNote,
  parseAmount,
  parseAmountAndNote,
  type ParsedAmount,
} from "../messages/message.parser";
import { isUniqueConstraintViolation, type ProcessedMessageRepository } from "../messages/message.repository";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { MovementService } from "../movements/movements.service";
import type { BotStateRecord, BotStateRepository } from "./bot-state.repository";
import { normalizeAmountString, type InterpretedNote, type NoteInterpreter } from "./note-interpreter";
import { parseCommand, type TelegramCommand } from "./telegram.commands";
import { normalizeTelegramMessage } from "./telegram.parser";
import {
  amountConfirmationAbandonedReply,
  amountConflictReply,
  categoryCreatedReply,
  categoryErrorReply,
  categoryListReply,
  categoryNotFoundReply,
  categoryRenamedReply,
  correctionAbandonedReply,
  correctionDoneReply,
  correctionOfferReply,
  duplicateCategoryReply,
  helpReply,
  keywordAssociatedReply,
  missingCategoryReply,
  movementMissingReply,
  otroKeptReply,
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
  /** Optional LLM interpreter; when absent the bot runs deterministic-only. */
  interpreter?: NoteInterpreter;
};

const IDLE = "idle";
const AWAITING_SETUP = "awaiting_setup";
const AWAITING_CATEGORY = "awaiting_category";
const AWAITING_AMOUNT_CONFIRMATION = "awaiting_amount_confirmation";

/**
 * Stored payload of an open amount-conflict question. Lives in
 * `BotState.pendingNote` (a String column) so it survives restarts.
 */
export const amountConfirmationPayloadSchema = z.object({
  body: z.string().min(1),
  note: z.string().nullable(),
  amounts: z.tuple([z.number().positive(), z.number().positive()]),
  category: z.string().min(1).nullable(),
});

export type AmountConfirmationPayload = z.infer<typeof amountConfirmationPayloadSchema>;

/** Answers that keep the movement in "otro" and end the correction dialog. */
const KEEP_OTRO_ANSWERS = new Set(["no", "otro", "dejalo", "deja", "nada"]);

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

    if (state?.state === AWAITING_AMOUNT_CONFIRMATION) {
      await this.handleAwaitingAmountConfirmation(state, body, reply);
      return;
    }

    await this.handleRegistration(body, reply);
  }

  private async handleRegistration(body: string, reply?: ReplyPort): Promise<void> {
    const ownerId = this.deps.ownerId;
    const parsed = parseAmountAndNote(body);
    const categories = await this.deps.categoryService.listCategories(ownerId);

    // The setup gate wins BEFORE any interpreter call: the interpreter never
    // fires for owners without categories.
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

    if (parsed === null) {
      await this.handleAmountRescue(body, categories, reply);
      return;
    }

    const note = parsed.note ?? body;
    const matched = await this.deps.categoryService.matchNote(ownerId, note);

    // A user-authored keyword rule beats any interpreter suggestion.
    if (matched !== null) {
      await this.registerWithCategory(body, parsed.amount, parsed.note, matched, reply);
      return;
    }

    // Keyword miss → interpreter: category suggestion and amount-conflict check.
    const interpretation = await this.tryInterpret(body);
    if (interpretation === null) {
      await this.registerOtroWithCorrection(body, parsed.amount, parsed.note, reply);
      return;
    }
    if (interpretation.amount !== parsed.amount) {
      await this.askAmountConfirmation(body, parsed, note, interpretation, categories, reply);
      return;
    }
    const category = this.resolveSuggestion(interpretation.category, categories);
    if (category !== null) {
      await this.registerWithCategory(body, parsed.amount, parsed.note, category, reply);
      return;
    }
    await this.registerOtroWithCorrection(body, parsed.amount, parsed.note, reply);
  }

  /** No deterministic amount: ask the interpreter to rescue one. */
  private async handleAmountRescue(
    body: string,
    categories: CategoryWithKeywords[],
    reply?: ReplyPort,
  ): Promise<void> {
    const interpretation = await this.tryInterpret(body);
    if (interpretation === null) {
      await this.safeReply(reply, helpReply());
      return;
    }
    // extractNote's no-parseable-token fallback returns the full body.
    const note = extractNote(body);
    const category = this.resolveSuggestion(interpretation.category, categories);
    if (category !== null) {
      await this.registerWithCategory(body, interpretation.amount, note, category, reply);
      return;
    }
    await this.registerOtroWithCorrection(body, interpretation.amount, note, reply);
  }

  /** Amounts differ: persist the question and ask; nothing registers silently. */
  private async askAmountConfirmation(
    body: string,
    parsed: ParsedAmount,
    note: string | null,
    interpretation: InterpretedNote,
    categories: CategoryWithKeywords[],
    reply?: ReplyPort,
  ): Promise<void> {
    const payload: AmountConfirmationPayload = {
      body,
      note,
      amounts: [parsed.amount, interpretation.amount],
      category: this.resolveSuggestion(interpretation.category, categories),
    };
    await this.deps.botStateRepository.set({
      ownerId: this.deps.ownerId,
      state: AWAITING_AMOUNT_CONFIRMATION,
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    await this.safeReply(reply, amountConflictReply(parsed.amount, interpretation.amount));
  }

  private async handleAwaitingAmountConfirmation(
    state: BotStateRecord,
    body: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    const payload = this.decodeConfirmationPayload(state.pendingNote);

    // A corrupt or missing payload abandons the question like any non-answer.
    if (payload === null) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: IDLE,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.safeReply(reply, amountConfirmationAbandonedReply());
      await this.handleRegistration(body, reply);
      return;
    }

    // Normalize FIRST so "5 mil" → 5000 beats the lone-"5" parser trap;
    // parseAmount catches prose-wrapped replies like "es 5000".
    const replied = normalizeAmountString(body) ?? parseAmount(body);
    const chosen = payload.amounts.find((amount) => amount === replied);
    if (chosen === undefined) {
      // Abandon: clear the state first, then process the text as a new
      // registration — nothing registers from the conflicting message.
      await this.deps.botStateRepository.set({
        ownerId,
        state: IDLE,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.safeReply(reply, amountConfirmationAbandonedReply());
      await this.handleRegistration(body, reply);
      return;
    }

    // Register from the STORED context; a creation failure leaves the question open.
    if (payload.category !== null) {
      await this.registerWithCategory(payload.body, chosen, payload.note, payload.category, reply);
    } else {
      await this.registerOtroWithCorrection(payload.body, chosen, payload.note, reply);
    }
  }

  private decodeConfirmationPayload(pendingNote: string | null): AmountConfirmationPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = amountConfirmationPayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async tryInterpret(body: string): Promise<InterpretedNote | null> {
    if (this.deps.interpreter === undefined) {
      return null;
    }
    try {
      return await this.deps.interpreter.interpret(body);
    } catch (error) {
      // The port contract is never-throw; this wrapper is belt-and-braces so a
      // misbehaving client cannot kill the bot.
      this.deps.logger?.(`Telegram: interpreter failed: ${String(error)}`);
      return null;
    }
  }

  /**
   * Resolves an interpreter category suggestion against the owner's categories
   * by exact normalized equality. Never creates categories; "otro" is treated
   * as no suggestion so the normal correction flow follows.
   */
  private resolveSuggestion(suggestion: string | null, categories: CategoryWithKeywords[]): string | null {
    if (suggestion === null) {
      return null;
    }
    if (normalizeForMatch(suggestion) === "otro") {
      return null;
    }
    const match = categories.find((category) => normalizeForMatch(category.name) === normalizeForMatch(suggestion));
    return match === undefined ? null : match.name;
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

    // Keep the movement in "otro": explicit abandonment answers never dead-end.
    if (KEEP_OTRO_ANSWERS.has(normalizedText)) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: IDLE,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.safeReply(reply, otroKeptReply());
      return;
    }

    // D6 rule 1: exact normalized match on an existing category name → ANSWER
    // (multi-word names; a category named "500" beats an amount).
    const exactCategory = categories.find((category) => normalizeForMatch(category.name) === normalizedText);
    if (exactCategory !== undefined) {
      await this.answerCorrection(state, exactCategory.name, reply);
      return;
    }

    // D6 rule 2: parses as amount → NEW registration; the pending correction is abandoned.
    if (parseAmountAndNote(body) !== null) {
      await this.safeReply(reply, correctionAbandonedReply());
      await this.handleRegistration(body, reply);
      return;
    }

    // D6 rule 3: a single token → ANSWER + auto-create.
    if (trimmed.split(/\s+/).length === 1) {
      const created = await this.deps.categoryService.createCategory(ownerId, trimmed);
      await this.answerCorrection(state, created.name, reply);
      return;
    }

    // A multi-word non-category answer → DO NOT dead-end: list the existing
    // categories so the user can pick, keeping the state open (the movement is
    // already safe in "otro").
    await this.safeReply(reply, categoryNotFoundReply(trimmed, categories.map((category) => category.name)));
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
    amount: number,
    note: string | null,
    category: string,
  ): Promise<{ id: string } | null> {
    try {
      return await this.deps.expenseService.createExpense(
        {
          amount,
          currency: "ARS",
          note,
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

  /** Shared tail: register with a resolved category, confirm, go idle. */
  private async registerWithCategory(
    body: string,
    amount: number,
    note: string | null,
    category: string,
    reply?: ReplyPort,
  ): Promise<boolean> {
    const movement = await this.createMovement(body, amount, note, category);
    if (movement === null) {
      return false;
    }
    await this.deps.botStateRepository.set({
      ownerId: this.deps.ownerId,
      state: IDLE,
      pendingMovementId: null,
      pendingNote: null,
    });
    await this.safeReply(reply, successReply(amount, note, category));
    return true;
  }

  /** Shared tail: register in "otro", offer the category correction. */
  private async registerOtroWithCorrection(
    body: string,
    amount: number,
    note: string | null,
    reply?: ReplyPort,
  ): Promise<boolean> {
    await this.deps.categoryService.ensureOtro(this.deps.ownerId);
    const movement = await this.createMovement(body, amount, note, "otro");
    if (movement === null) {
      return false;
    }
    // The movement keeps the parsed note; the pending correction remembers the
    // whole body when no note was parsed (today's behavior).
    const displayNote = note ?? body;
    await this.deps.botStateRepository.set({
      ownerId: this.deps.ownerId,
      state: AWAITING_CATEGORY,
      pendingMovementId: movement.id,
      pendingNote: displayNote,
    });
    // The movement is already registered in "otro"; the reassignment is optional.
    await this.safeReply(reply, correctionOfferReply(amount, displayNote, "otro"));
    return true;
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