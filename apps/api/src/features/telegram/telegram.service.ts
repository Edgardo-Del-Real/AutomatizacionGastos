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
import {
  normalizeAmountString,
  type BotBrain,
  type ConversationEnvelope,
  type ExecutionResult,
  type InterpretContext,
} from "./bot-brain";
import { CategoryExecutor } from "./category-executor";
import { isMilStance } from "./mil-stance";
import { MovementCorrector } from "./movement-corrector";
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
  categoryCreatedReassignedReply,
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
  movementAmbiguousReply,
  movementCorrectionDoneReply,
  movementMissingReply,
  movementNoMatchReply,
  movementNoReferenceReply,
  movementSelectionAbandonedReply,
  offTopicRedirectReply,
  otroKeptReply,
  queryRedirectReply,
  queryReplyTemplate,
  questionDroppedReply,
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
const AWAITING_MOVEMENT_SELECTION = "awaiting_movement_selection";

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

/**
 * Stored payload of an open "which movement do I correct?" question (D4).
 * The candidates come from the matcher; the pick is resolved deterministically,
 * never by the brain. Lives in `BotState.pendingNote` so it survives restarts.
 */
export const movementSelectionPayloadSchema = z.object({
  category: z.string().min(1),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1),
        amount: z.number().positive(),
        note: z.string().nullable(),
        date: z.string().min(1),
      }),
    )
    .min(1)
    .max(10),
});

export type MovementSelectionPayload = z.infer<typeof movementSelectionPayloadSchema>;

/** Answers that keep the movement in "otro" and end the correction dialog. */
const KEEP_OTRO_ANSWERS = new Set(["no", "otro", "dejalo", "deja", "nada"]);

/** The pending dialog state the shared intent router must leave untouched. */
type DialogContext = { state: BotStateRecord };

export class TelegramService {
  private readonly queryExecutor: QueryExecutor;
  private readonly categoryExecutor: CategoryExecutor;
  private readonly movementCorrector: MovementCorrector;

  constructor(private readonly deps: TelegramServiceDeps) {
    this.queryExecutor = new QueryExecutor(deps.movementService, deps.categoryService);
    this.categoryExecutor = new CategoryExecutor(deps.categoryService);
    this.movementCorrector = new MovementCorrector(deps.movementService, deps.categoryService);
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

    if (state?.state === AWAITING_CATEGORY || state?.state === AWAITING_AMOUNT_CONFIRMATION) {
      await this.handleDialogMessage(state, body, reply);
      return;
    }

    if (state?.state === AWAITING_MOVEMENT_SELECTION) {
      await this.handleMovementSelection(state, body, reply);
      return;
    }

    await this.handleRegistration(body, reply);
  }

  private async handleRegistration(body: string, reply?: ReplyPort): Promise<void> {
    const ownerId = this.deps.ownerId;
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
      await this.deterministicRegistration(body, parseAmountAndNote(body), categories, reply);
      return;
    }

    await this.routeEnvelopeIntent(envelope, body, reply);
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

  private async d6AwaitingAmountConfirmation(
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

  private async tryBrainInterpret(body: string, context?: InterpretContext): Promise<ConversationEnvelope | null> {
    if (this.deps.brain === undefined) {
      return null;
    }
    try {
      // Keep the idle call shape (single argument) so callers can assert it;
      // only dialog messages carry the context.
      return context === undefined
        ? await this.deps.brain.interpret(body)
        : await this.deps.brain.interpret(body, context);
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

  private async d6AwaitingCategory(
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

  /**
   * Brain-routed dialog controller (spec "Dialog Controller"): every non-command
   * message in a dialog state is interpreted WITH dialog context and routed on
   * `dialog_action`. The deterministic rules run only as the D6 fallback.
   */
  private async handleDialogMessage(state: BotStateRecord, body: string, reply?: ReplyPort): Promise<void> {
    const context = this.buildInterpretContext(state);
    if (context === null) {
      // A corrupt amount-confirmation payload cannot be contextualized: today's
      // deterministic rules own the message.
      await this.d6DialogFallback(state, body, reply);
      return;
    }

    const envelope = await this.tryBrainInterpret(body, context);
    if (envelope === null || envelope.dialog_action === "abandon") {
      // D1: brain-absent / brain-null / explicit abandon → D6 rules verbatim.
      await this.d6DialogFallback(state, body, reply);
      return;
    }

    if (envelope.dialog_action === "resolve") {
      // Phantom guard: the acted-on value comes from the message matched against
      // the persisted payload, never from the envelope.
      await this.resolveDialog(state, envelope, body, reply);
      return;
    }

    // dialog_action null → shared intent routing; the pending stays untouched.
    await this.routeEnvelopeIntent(envelope, body, reply, { state });
  }

  /** D1: the single D6 fallback path, dispatching to today's verbatim handlers. */
  private async d6DialogFallback(state: BotStateRecord, body: string, reply?: ReplyPort): Promise<void> {
    if (state.state === AWAITING_CATEGORY) {
      await this.d6AwaitingCategory(state, body, reply);
      return;
    }
    await this.d6AwaitingAmountConfirmation(state, body, reply);
  }

  /**
   * Reconstructs the `InterpretContext` from the persisted state (design
   * "buildInterpretContext"). A corrupt amount-confirmation payload yields null
   * so the D6 fallback (today's abandon-and-reprocess) owns the message.
   */
  private buildInterpretContext(state: BotStateRecord): InterpretContext | null {
    if (state.state === AWAITING_CATEGORY) {
      return {
        state: "awaiting_category",
        pending: { movementId: state.pendingMovementId, note: state.pendingNote },
        openQuestion: `¿Querés asignarle otra categoría al movimiento "${state.pendingNote ?? ""}"? Escribí el nombre o "no".`,
      };
    }
    const payload = this.decodeConfirmationPayload(state.pendingNote);
    if (payload === null) {
      return null;
    }
    return {
      state: "awaiting_amount_confirmation",
      pending: { amounts: payload.amounts, note: payload.note, category: payload.category },
      openQuestion: amountConflictReply(payload.amounts[0], payload.amounts[1]),
    };
  }

  /** `dialog_action: "resolve"` → deterministic resolution from the persisted payload ONLY. */
  private async resolveDialog(
    state: BotStateRecord,
    envelope: ConversationEnvelope,
    body: string,
    reply?: ReplyPort,
  ): Promise<void> {
    if (state.state === AWAITING_CATEGORY) {
      await this.resolveAwaitingCategory(state, envelope, reply);
      return;
    }
    await this.resolveAwaitingAmountConfirmation(state, envelope, body, reply);
  }

  /**
   * Resolve for `awaiting_category`: the D6 answer cascade run with
   * `envelope.category` as the candidate answer. The phantom guard clears the
   * question when the payload is missing or the answer matches nothing — a bare
   * "si" never fabricates a category and is NOT reprocessed.
   */
  private async resolveAwaitingCategory(
    state: BotStateRecord,
    envelope: ConversationEnvelope,
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    // Phantom guard rule 1: the pending movement must exist.
    if (state.pendingMovementId === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, questionDroppedReply());
      return;
    }

    const send = this.makeSender(true, reply);
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const answer = envelope.category?.trim() ?? "";
    const normalizedAnswer = normalizeForMatch(answer);

    // Keep the movement in "otro": explicit abandonment answers never dead-end.
    if (KEEP_OTRO_ANSWERS.has(normalizedAnswer)) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "correct_category", ok: true, action: "none", amount: null, category: "otro", note: null },
        otroKeptReply(),
      );
      return;
    }

    // Phantom guard rule 3: a resolve with no category (bare "si") abandons the
    // question — never fabricates a category, never reprocesses.
    if (answer.length === 0) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "correct_category", ok: false, action: "none", amount: null, category: null, note: null },
        questionDroppedReply(),
      );
      return;
    }

    // D6 answer cascade with the envelope category as the candidate answer.
    const exactCategory = categories.find((category) => normalizeForMatch(category.name) === normalizedAnswer);
    if (exactCategory !== undefined) {
      await this.answerCorrection(state, exactCategory.name, send, reply);
      return;
    }

    // A single token is a new category: auto-create and apply (D6 rule 3).
    if (answer.split(/\s+/).length === 1) {
      const created = await this.deps.categoryService.createCategory(ownerId, answer);
      await this.answerCorrection(state, created.name, send, reply);
      return;
    }

    // Multi-word non-category answer → list the categories, keep the state open.
    await send(
      { intent: "correct_category", ok: false, action: "asked_category", amount: null, category: null, note: answer },
      categoryNotFoundReply(answer, categories.map((category) => category.name)),
    );
  }

  /**
   * Resolve for `awaiting_amount_confirmation`: the chosen amount comes from the
   * message matched against `payload.amounts` — `envelope.amount` is NEVER read
   * (phantom guard rule 2). A resolve that matches nothing abandons the question
   * with the dropped reply and is NOT reprocessed.
   */
  private async resolveAwaitingAmountConfirmation(
    state: BotStateRecord,
    envelope: ConversationEnvelope,
    body: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    const send = this.makeSender(true, reply);
    const payload = this.decodeConfirmationPayload(state.pendingNote);

    // Phantom guard rule 1: the payload must parse.
    if (payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        questionDroppedReply(),
      );
      return;
    }

    const replied = normalizeAmountString(body) ?? parseAmount(body);
    const chosen = payload.amounts.find((amount) => amount === replied);
    if (chosen === undefined) {
      // Phantom guard rule 3: bare "si" or any non-matching resolve → dropped,
      // nothing registers from the conflicting message, no reprocessing.
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        questionDroppedReply(),
      );
      return;
    }

    // Register from the STORED context; a creation failure leaves the question open.
    if (payload.category !== null) {
      await this.registerWithCategory(payload.body, chosen, payload.note, payload.category, send);
    } else {
      await this.registerOtroWithCorrection(payload.body, chosen, payload.note, send);
    }
  }

  /**
   * Shared intent router used by idle and by dialog messages with
   * `dialog_action: null`. Queries and CRUD run WITHOUT consuming the pending;
   * `register_expense` during a dialog abandons it and registers from the SAME
   * envelope (D5 — one interpret call per message).
   */
  private async routeEnvelopeIntent(
    envelope: ConversationEnvelope,
    body: string,
    reply?: ReplyPort,
    dialog?: DialogContext,
  ): Promise<void> {
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
        await this.executeCategoryCommandWithReassign(envelope, reply, dialog);
        return;
      case "capabilities":
        await this.sendCapabilities(reply);
        return;
      case "off_topic":
        await this.sendRedirect("off_topic", offTopicRedirectReply(), reply);
        return;
      case "help":
      case "correct_amount":
        await this.makeSender(true, reply)(
          { intent: envelope.intent, ok: true, action: "none", amount: null, category: null, note: null },
          helpReply(),
        );
        return;
      case "correct_category":
        await this.runMovementCorrection(envelope, reply);
        return;
      case "register_expense":
        if (dialog !== undefined) {
          // A new registration abandons the pending correction/question first.
          await this.deps.botStateRepository.set({
            ownerId: this.deps.ownerId,
            state: IDLE,
            pendingMovementId: null,
            pendingNote: null,
          });
          const abandoned =
            dialog.state.state === AWAITING_AMOUNT_CONFIRMATION
              ? amountConfirmationAbandonedReply()
              : correctionAbandonedReply();
          await this.safeReply(reply, abandoned);
        }
        await this.executeRegistration(body, parseAmountAndNote(body), envelope, await this.deps.categoryService.listCategories(this.deps.ownerId), reply);
        return;
    }
  }

  /**
   * Category CRUD + the mixed-intent chain (task 3.6): when a create_category
   * envelope carries `then_reassign` AND a pending movement exists, create the
   * category and reassign the pending movement in one cycle with one reply.
   */
  private async executeCategoryCommandWithReassign(
    envelope: ConversationEnvelope,
    reply?: ReplyPort,
    dialog?: DialogContext,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    const result = await this.categoryExecutor.execute(ownerId, envelope);
    const pendingMovementId = dialog?.state.pendingMovementId ?? null;
    const shouldReassign =
      envelope.intent === "create_category" && result.ok && envelope.then_reassign === true && pendingMovementId !== null;

    if (!shouldReassign) {
      await this.makeSender(true, reply)(result, categoryCommandReplyTemplate(result));
      return;
    }

    try {
      await this.deps.movementService.updateMovement(ownerId, pendingMovementId, { category: result.category });
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      const reassigned: ExecutionResult = { ...result, action: "created_reassigned" };
      await this.makeSender(true, reply)(reassigned, categoryCreatedReassignedReply(result.category ?? ""));
    } catch (error) {
      this.deps.logger?.(`Telegram: failed to reassign movement ${pendingMovementId}: ${String(error)}`);
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.makeSender(true, reply)(result, categoryCommandReplyTemplate(result));
      await this.safeReply(reply, movementMissingReply());
    }
  }

  /**
   * `correct_category` execution: the deterministic matcher reassigns the unique
   * best movement, asks with a persisted selection question on ambiguity or a
   * missing reference, and degrades with fixed replies on no-match or a deleted
   * movement. Ask/dropped/no-match replies are fixed-only (D8).
   */
  private async runMovementCorrection(
    envelope: ConversationEnvelope,
    reply?: ReplyPort,
  ): Promise<void> {
    const ownerId = this.deps.ownerId;
    if (envelope.category === null) {
      await this.makeSender(true, reply)(
        { intent: "correct_category", ok: true, action: "none", amount: null, category: null, note: null },
        helpReply(),
      );
      return;
    }

    const result = await this.movementCorrector.correct(
      ownerId,
      { amount: envelope.amount, note: envelope.note },
      envelope.category,
    );

    switch (result.status) {
      case "reassigned":
        await this.makeSender(true, reply)(
          {
            intent: "correct_category",
            ok: true,
            action: "registered",
            amount: result.movement.amount,
            category: result.category,
            note: result.movement.note,
          },
          movementCorrectionDoneReply(result.category, result.movement.amount, result.movement.note),
        );
        return;
      case "no_match":
        await this.safeReply(reply, movementNoMatchReply());
        return;
      case "missing":
        await this.safeReply(reply, movementMissingReply());
        return;
      case "ask": {
        // A selection ask supersedes an open dialog: the pending is safe (the
        // movement stays in "otro" / nothing registered).
        const payload: MovementSelectionPayload = {
          category: result.category,
          candidates: result.candidates.map((candidate) => ({
            id: candidate.id,
            amount: candidate.amount,
            note: candidate.note,
            date: candidate.date,
          })),
        };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_MOVEMENT_SELECTION,
          pendingMovementId: null,
          pendingNote: JSON.stringify(payload),
        });
        const fixed =
          result.reason === "ambiguous"
            ? movementAmbiguousReply({ amount: envelope.amount, note: envelope.note }, result.candidates)
            : movementNoReferenceReply(result.candidates);
        await this.safeReply(reply, fixed);
        return;
      }
    }
  }

  /**
   * Deterministic pick for an open movement-selection question (D4 — never the
   * brain): a number 1..N, a note equality/containment matching exactly one
   * candidate, or an amount matching exactly one candidate. Anything else is a
   * non-answer that abandons the question and reprocesses the text normally.
   */
  private async handleMovementSelection(state: BotStateRecord, body: string, reply?: ReplyPort): Promise<void> {
    const ownerId = this.deps.ownerId;
    const payload = this.decodeMovementSelectionPayload(state.pendingNote);

    if (payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, questionDroppedReply());
      await this.handleRegistration(body, reply);
      return;
    }

    const picked = this.pickMovementSelection(body, payload);
    if (picked === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, movementSelectionAbandonedReply());
      await this.handleRegistration(body, reply);
      return;
    }

    try {
      await this.deps.movementService.updateMovement(ownerId, picked.id, { category: payload.category });
    } catch (error) {
      this.deps.logger?.(`Telegram: failed to reassign movement ${picked.id}: ${String(error)}`);
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      const text = error instanceof NotFoundError ? movementMissingReply() : categoryErrorReply("no se pudo actualizar el movimiento");
      await this.safeReply(reply, text);
      return;
    }

    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    await this.safeReply(reply, correctionDoneReply(payload.category));
  }

  /** Pure pick resolution: number 1..N, then note, then unique amount (design D4). */
  private pickMovementSelection(body: string, payload: MovementSelectionPayload): MovementSelectionPayload["candidates"][number] | null {
    const candidates = payload.candidates;
    const amount = normalizeAmountString(body);

    // (a) integer 1..N → the numbered candidate.
    if (amount !== null && Number.isInteger(amount) && amount >= 1 && amount <= candidates.length) {
      return candidates[amount - 1] ?? null;
    }

    // (b) normalized note equality/containment matching exactly one candidate.
    const normalizedBody = normalizeForMatch(body);
    const noteMatches = candidates.filter((candidate) => {
      const note = normalizeForMatch(candidate.note ?? "");
      return note.length > 0 && (note === normalizedBody || note.includes(normalizedBody));
    });
    if (noteMatches.length === 1) {
      return noteMatches[0] ?? null;
    }

    // (c) amount matching exactly one candidate.
    if (amount !== null) {
      const amountMatches = candidates.filter((candidate) => candidate.amount === amount);
      if (amountMatches.length === 1) {
        return amountMatches[0] ?? null;
      }
    }

    return null;
  }

  private decodeMovementSelectionPayload(pendingNote: string | null): MovementSelectionPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = movementSelectionPayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
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