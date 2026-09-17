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
import { normalizeAmountString, type BotBrain, type ConversationEnvelope, type ExecutionResult } from "./bot-brain";
import { CategoryExecutor } from "./category-executor";
import { isMilStance } from "./mil-stance";
import { QueryExecutor } from "./query-executor";
import { deriveQueryType, type QueryExecutionResult } from "./query.types";
import { parseCommand, type TelegramCommand } from "./telegram.commands";
import { normalizeTelegramMessage } from "./telegram.parser";
import {
  amountConfirmationAbandonedReply,
  amountConflictReply,
  associateKeywordRedirectReply,
  capabilitiesSummaryReply,
  categoryCommandReplyTemplate,
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
  offTopicRedirectReply,
  otroKeptReply,
  queryRedirectReply,
  queryReplyTemplate,
  setupDoneReply,
  setupQuestionReply,
  setupRetryReply,
  successReply,
} from "./reply-text";

export type ReplyPort = (text: string) => Promise<void>;

/** Brain-written branch sender: sends the LLM reply when active, else the fixed template. */
export type Sender = (result: ExecutionResult, fixed: string) => Promise<void>;

export type TelegramServiceDeps = {
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  movementService: MovementService;
  categoryService: CategoryService;
  botStateRepository: BotStateRepository;
  ownerChatId: number;
  ownerId: string;
  logger?: (message: string) => void;
  /** Optional LLM brain; when absent the bot runs deterministic-only. */
  brain?: BotBrain;
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
  private readonly queryExecutor: QueryExecutor;
  private readonly categoryExecutor: CategoryExecutor;

  constructor(private readonly deps: TelegramServiceDeps) {
    this.queryExecutor = new QueryExecutor(deps.movementService, deps.categoryService);
    this.categoryExecutor = new CategoryExecutor(deps.categoryService);
  }

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

    // The setup gate wins BEFORE any brain call: the brain never fires for
    // owners without categories.
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

    const envelope = await this.tryBrainInterpret(body);
    if (envelope === null) {
      // D5: interpret-null → full deterministic path, fixed replies, no reply call.
      await this.deterministicRegistration(body, parsed, categories, reply);
      return;
    }

    switch (envelope.intent) {
      case "query":
      case "query_recent":
      case "query_balance":
      case "query_month":
        await this.executeQuery(envelope, reply);
        return;
      case "associate_keyword":
        await this.sendRedirect("associate_keyword", associateKeywordRedirectReply(), reply);
        return;
      case "create_category":
      case "delete_category":
      case "rename_category":
        await this.executeCategoryCommand(envelope, reply);
        return;
      case "capabilities":
        await this.sendCapabilities(reply);
        return;
      case "off_topic":
        await this.sendRedirect("off_topic", offTopicRedirectReply(), reply);
        return;
      case "help":
      case "correct_amount":
      case "correct_category":
        await this.makeSender(true, reply)(
          { intent: envelope.intent, ok: true, action: "none", amount: null, category: null, note: null },
          helpReply(),
        );
        return;
      case "register_expense":
        await this.executeRegistration(body, parsed, envelope, categories, reply);
        return;
    }
  }

  private async sendRedirect(intent: ConversationEnvelope["intent"], fixed: string, reply?: ReplyPort): Promise<void> {
    await this.makeSender(true, reply)(
      { intent, ok: false, action: "redirected", amount: null, category: null, note: null },
      fixed,
    );
  }

  /**
   * Category CRUD executors: run the real CategoryService and feed the ACTUAL
   * result (created/deleted/renamed names, error messages) to the brain reply,
   * falling back to the fixed template that mirrors the same facts. Errors are
   * carried in the result — the executor never throws for domain failures.
   */
  private async executeCategoryCommand(envelope: ConversationEnvelope, reply?: ReplyPort): Promise<void> {
    const result = await this.categoryExecutor.execute(this.deps.ownerId, envelope);
    await this.makeSender(true, reply)(result, categoryCommandReplyTemplate(result));
  }

  /**
   * Capability questions: a deterministic summary listing what the bot can do,
   * available to the LLM via the reply flow and used as the fixed fallback.
   * Never reports "no action" for a capability question.
   */
  private async sendCapabilities(reply?: ReplyPort): Promise<void> {
    const result: ExecutionResult = {
      intent: "capabilities",
      ok: true,
      action: "capabilities",
      amount: null,
      category: null,
      note: null,
    };
    await this.makeSender(true, reply)(result, capabilitiesSummaryReply());
  }

  /**
   * Deterministic query executor: resolves the query_type from the envelope,
   * fetches the owner's real data, and passes the executed result to the brain
   * reply (falling back to the fixed template). Malformed envelopes and fetch
   * failures degrade to the honest redirect — never invent data.
   */
  private async executeQuery(envelope: ConversationEnvelope, reply?: ReplyPort): Promise<void> {
    const send = this.makeSender(true, reply);
    const queryType = deriveQueryType(envelope.intent, envelope.query_type ?? null);

    if (queryType === null) {
      await send(
        { intent: envelope.intent, ok: false, action: "redirected", amount: null, category: null, note: null },
        queryRedirectReply(),
      );
      return;
    }

    let result: QueryExecutionResult;
    try {
      result = await this.queryExecutor.execute(this.deps.ownerId, queryType);
    } catch (error) {
      this.deps.logger?.(`Telegram: query ${queryType} failed: ${String(error)}`);
      await send(
        {
          intent: envelope.intent,
          ok: false,
          action: "redirected",
          amount: null,
          category: null,
          note: null,
          query_type: queryType,
        },
        queryRedirectReply(),
      );
      return;
    }

    await send(
      {
        intent: envelope.intent,
        ok: true,
        action: "answered",
        amount: null,
        category: null,
        note: null,
        query_type: queryType,
        query: result,
      },
      queryReplyTemplate(result),
    );
  }

  /** Today's flow verbatim minus the brain: fixed replies only, no reply call. */
  private async deterministicRegistration(
    body: string,
    parsed: ParsedAmount | null,
    categories: CategoryWithKeywords[],
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    if (parsed === null) {
      await this.safeReply(reply, helpReply());
      return;
    }

    const note = parsed.note ?? body;
    const matched = await this.deps.categoryService.matchNote(ownerId, note);

    // A user-authored keyword rule beats any brain suggestion.
    if (matched !== null) {
      await this.registerWithCategory(body, parsed.amount, parsed.note, matched, this.makeSender(false, reply));
      return;
    }

    await this.registerOtroWithCorrection(body, parsed.amount, parsed.note, this.makeSender(false, reply));
  }

  /** register_expense envelope: amount → note → category, then register. */
  private async executeRegistration(
    body: string,
    parsed: ParsedAmount | null,
    envelope: ConversationEnvelope,
    categories: CategoryWithKeywords[],
    reply?: ReplyPort,
  ): Promise<void> {
    const send = this.makeSender(true, reply);
    const ownerId = this.deps.ownerId;
    const detAmount = parsed?.amount ?? null;
    const brainAmount = envelope.amount;

    if (detAmount === null && brainAmount === null) {
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        helpReply(),
      );
      return;
    }

    let amount: number;
    if (detAmount === null) {
      // Brain rescue: no deterministic amount.
      amount = brainAmount as number;
    } else if (brainAmount === null || brainAmount === detAmount) {
      // Deterministic amount is authoritative when present and equal.
      amount = detAmount;
    } else if (isMilStance(body, detAmount)) {
      // The deterministic parser trapped the digit part of a prose amount
      // ("5 mil" → 5): the brain amount wins directly, no conflict question.
      amount = brainAmount as number;
    } else {
      // Genuine disagreement: ask the owner, nothing registers silently.
      await this.askAmountConfirmation(body, detAmount, brainAmount, parsed, envelope, categories, send);
      return;
    }

    // Deterministic note wins; the brain fills the gap; never conflict-asks.
    const note = parsed !== null ? (parsed.note ?? envelope.note) : (envelope.note ?? extractNote(body));

    // Category: the keyword rule runs first and beats the brain suggestion;
    // otherwise the suggestion resolves by exact normalized match only.
    const matched = await this.deps.categoryService.matchNote(ownerId, note ?? body);
    const category = matched ?? this.resolveSuggestion(envelope.category, categories);
    if (category !== null) {
      await this.registerWithCategory(body, amount, note, category, send);
      return;
    }
    await this.registerOtroWithCorrection(body, amount, note, send);
  }

  /** Amounts differ: persist the question and ask; nothing registers silently. */
  private async askAmountConfirmation(
    body: string,
    detAmount: number,
    brainAmount: number,
    parsed: ParsedAmount | null,
    envelope: ConversationEnvelope,
    categories: CategoryWithKeywords[],
    send: Sender,
  ): Promise<void> {
    const note = parsed !== null ? (parsed.note ?? envelope.note) : (envelope.note ?? extractNote(body));
    const payload: AmountConfirmationPayload = {
      body,
      note,
      amounts: [detAmount, brainAmount],
      category: this.resolveSuggestion(envelope.category, categories),
    };
    await this.deps.botStateRepository.set({
      ownerId: this.deps.ownerId,
      state: AWAITING_AMOUNT_CONFIRMATION,
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    await send(
      { intent: "register_expense", ok: false, action: "asked_amount", amount: detAmount, category: null, note: body },
      amountConflictReply(detAmount, brainAmount),
    );
  }

  private async handleAwaitingAmountConfirmation(
    state: BotStateRecord,
    body: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    const send = this.makeSender(this.brainAvailable, reply);
    const payload = this.decodeConfirmationPayload(state.pendingNote);

    // A corrupt or missing payload abandons the question like any non-answer.
    if (payload === null) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: IDLE,
        pendingMovementId: null,
        pendingNote: null,
      });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        amountConfirmationAbandonedReply(),
      );
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
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        amountConfirmationAbandonedReply(),
      );
      await this.handleRegistration(body, reply);
      return;
    }

    // Register from the STORED context; a creation failure leaves the question open.
    if (payload.category !== null) {
      await this.registerWithCategory(payload.body, chosen, payload.note, payload.category, send);
    } else {
      await this.registerOtroWithCorrection(payload.body, chosen, payload.note, send);
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

  private async tryBrainInterpret(body: string): Promise<ConversationEnvelope | null> {
    if (this.deps.brain === undefined) {
      return null;
    }
    try {
      return await this.deps.brain.interpret(body);
    } catch (error) {
      // The port contract is never-throw; this wrapper is belt-and-braces so a
      // misbehaving client cannot kill the bot.
      this.deps.logger?.(`Telegram: brain interpret failed: ${String(error)}`);
      return null;
    }
  }

  private async tryBrainReply(result: ExecutionResult): Promise<string | null> {
    if (this.deps.brain === undefined) {
      return null;
    }
    try {
      return await this.deps.brain.reply(result);
    } catch (error) {
      this.deps.logger?.(`Telegram: brain reply failed: ${String(error)}`);
      return null;
    }
  }

  /**
   * Builds the per-message sender. `brainActive` gates the reply call: it is
   * true only when an envelope drove the outcome (idle path) or a brain is
   * configured (dialog branches); when false no `reply` call ever happens (D5).
   */
  private makeSender(brainActive: boolean, reply?: ReplyPort): Sender {
    return async (result: ExecutionResult, fixed: string): Promise<void> => {
      const text = brainActive ? ((await this.tryBrainReply(result)) ?? fixed) : fixed;
      await this.safeReply(reply, text);
    };
  }

  private get brainAvailable(): boolean {
    return this.deps.brain !== undefined;
  }

  /**
   * Resolves a brain category suggestion against the owner's categories
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
    const send = this.makeSender(this.brainAvailable, reply);
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
      await send(
        { intent: "correct_category", ok: true, action: "none", amount: null, category: "otro", note: null },
        otroKeptReply(),
      );
      return;
    }

    // D6 rule 1: exact normalized match on an existing category name → ANSWER
    // (multi-word names; a category named "500" beats an amount).
    const exactCategory = categories.find((category) => normalizeForMatch(category.name) === normalizedText);
    if (exactCategory !== undefined) {
      await this.answerCorrection(state, exactCategory.name, send, reply);
      return;
    }

    // D6 rule 2: parses as amount → NEW registration; the pending correction is abandoned.
    if (parseAmountAndNote(body) !== null) {
      await send(
        { intent: "correct_category", ok: false, action: "none", amount: null, category: null, note: body },
        correctionAbandonedReply(),
      );
      await this.handleRegistration(body, reply);
      return;
    }

    // D6 rule 3: a single token → ANSWER + auto-create.
    if (trimmed.split(/\s+/).length === 1) {
      const created = await this.deps.categoryService.createCategory(ownerId, trimmed);
      await this.answerCorrection(state, created.name, send, reply);
      return;
    }

    // A multi-word non-category answer → DO NOT dead-end: list the existing
    // categories so the user can pick, keeping the state open (the movement is
    // already safe in "otro").
    await send(
      { intent: "correct_category", ok: false, action: "asked_category", amount: null, category: null, note: trimmed },
      categoryNotFoundReply(trimmed, categories.map((category) => category.name)),
    );
  }

  private async answerCorrection(
    state: BotStateRecord,
    category: string,
    send: Sender,
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
        // D7: error replies stay fixed-only.
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
    await send(
      { intent: "correct_category", ok: true, action: "registered", amount: null, category, note: state.pendingNote },
      correctionDoneReply(category),
    );
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
    send: Sender,
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
    await send(
      { intent: "register_expense", ok: true, action: "registered", amount, category, note },
      successReply(amount, note, category),
    );
    return true;
  }

  /** Shared tail: register in "otro", offer the category correction. */
  private async registerOtroWithCorrection(
    body: string,
    amount: number,
    note: string | null,
    send: Sender,
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
    await send(
      { intent: "register_expense", ok: true, action: "asked_category", amount, category: "otro", note: displayNote },
      correctionOfferReply(amount, displayNote, "otro"),
    );
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