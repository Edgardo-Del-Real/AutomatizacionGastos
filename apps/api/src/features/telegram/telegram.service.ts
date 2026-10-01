import { z } from "zod";
import type { CategoryService } from "../categories/categories.service";
import { normalizeForMatch, normalizeForMatchGuard, normalizeForMatchTolerant } from "../categories/matcher";
import type { CategoryWithKeywords } from "../categories/categories.types";
import { ReservedCategoryError } from "../categories/reserved";
import type { ExpenseService } from "../expenses/expenses.service";
import type { HouseholdService } from "../household/household.service";
import type { ViewerScope } from "../movements/movements.types";
import type { SavingsOverride } from "../savings/savings.types";
import type { SavingsRuleService } from "../savings/savings.service";
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
import {
  MovementLifecycleExecutor,
  type LifecycleCues,
  type LifecycleResult,
} from "./movement-lifecycle-executor";
import { QueryExecutor } from "./query-executor";
import { deriveQueryType, type PlannedQueryResult, type QueryExecutionResult } from "./query.types";
import { parseCommand, parseSetupBatchCommand, type TelegramCommand } from "./telegram.commands";
import { normalizeTelegramMessage, normalizeTelegramCallback, parseArrivalPrefixes, parseSavingsOverride, quickCaptureParse, buildCallbackData, type InlineButton, type InlineKeyboard, type QuickCapture, type TelegramCallback } from "./telegram.parser";
import {
  amountConfirmationAbandonedReply,
  amountConflictReply,
  alreadyProcessedReply,
  askAmountReply,
  askCategoryReply,
  associateKeywordRedirectReply,
  callbackUnavailableReply,
  capabilitiesSummaryReply,
  capturePromptReply,
  categoryButtonsReply,
  categoryCommandReplyTemplate,
  categoryCreatedReassignedReply,
  categoryCreatedReply,
  categoryErrorReply,
  categoryFollowUpReply,
  categoryListReply,
  categoryNotFoundReply,
  categoryRenamedReply,
  collectAbandonedReply,
  correctionAbandonedReply,
  correctionDoneReply,
  correctionOfferReply,
  deletedMovementReply,
  deleteAskReply,
  deleteCancelledReply,
  deleteConfirmReply,
  deletePickListReply,
  dialogClosedReply,
  duplicateCategoryReply,
  formatARS,
  greetingReply,
  helpReply,
  keptCollectingReply,
  keywordAssociatedReply,
  markPaidAlreadyReply,
  markPaidAskReply,
  markPaidReply,
  menuReply,
  ayudaReply,
  missingCategoryReply,
  movementAmbiguousReply,
  movementCorrectionDoneReply,
  movementMissingReply,
  movementNoMatchReply,
  movementNoReferenceReply,
  movementSelectionAbandonedReply,
  nothingPendingReply,
  nothingToDeleteReply,
  offTopicRedirectReply,
  otroKeptReply,
  pendingCapturePromptReply,
  plannedReply,
  plannedSharedRejectedReply,
  previewReply,
  queryRedirectReply,
  queryReplyTemplate,
  questionDroppedReply,
  reservedCategoryReply,
  savingsOverrideInvalidReply,
  savingsRuleDefinedReply,
  savingsRuleInvalidReply,
  savingsRuleRedirectReply,
  setupBatchDoneReply,
  setupQuestionReply,
  setupRetryReply,
  successReply,
  successSplitReply,
} from "./reply-text";

/**
 * D2 — injectable reply port: sends a text message back to the sender chat,
 * optionally with an inline keyboard, and edits an existing message when
 * `editMessageId` is present. The trailing params are optional so every
 * existing `reply(text)` call site stays assignable; keyboards are plain DTOs
 * (never grammy types) and the production wiring maps them to `reply_markup`
 * / `editMessageText` (spec telegram-bot "Reply Channel (Bidirectional)").
 */
export type ReplyPort = (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>;

/** Brain-written branch sender: sends the LLM reply when active, else the fixed template. */
export type Sender = (result: ExecutionResult, fixed: string) => Promise<void>;

export type TelegramServiceDeps = {
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  movementService: MovementService;
  categoryService: CategoryService;
  /** D4: savings-rule slice for note matching, split resolution and rule definition. */
  savingsService: SavingsRuleService;
  botStateRepository: BotStateRepository;
  /**
   * AD9 — the household registry replaces the single `ownerChatId`/`ownerId`:
   * `resolveOwnerByChatId` gates and attributes each message to its member,
   * and `partnerOf` feeds the viewer scope for movement queries.
   */
  household: HouseholdService;
  logger?: (message: string) => void;
  /** Optional LLM brain; when absent the bot runs deterministic-only. */
  brain?: BotBrain;
};

const IDLE = "idle";
const AWAITING_SETUP = "awaiting_setup";
const AWAITING_CATEGORY = "awaiting_category";
const AWAITING_AMOUNT_CONFIRMATION = "awaiting_amount_confirmation";
const AWAITING_MOVEMENT_SELECTION = "awaiting_movement_selection";
const AWAITING_REGISTRATION = "awaiting_registration";
const AWAITING_PREVIEW = "awaiting_preview";
const AWAITING_DELETE_CONFIRMATION = "awaiting_delete_confirmation";

/** D4 — random 8-hex save token gating the preview Guardar callback (D5). */
function newSaveToken(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Stored payload of an open amount-conflict question. Lives in
 * `BotState.pendingNote` (a String column) so it survives restarts. The
 * `shared` bit is persisted so a dialog-created registration keeps the
 * shared signal of the message that opened the question (AD6); the savings
 * `override` is persisted so a split applies when the question resolves (D6).
 */
export const savingsOverrideSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("disabled") }),
  z.object({ kind: z.literal("percent"), percent: z.number().gt(0).lte(100) }),
]);

export const amountConfirmationPayloadSchema = z.object({
  body: z.string().min(1),
  note: z.string().nullable(),
  amounts: z.tuple([z.number().positive(), z.number().positive()]),
  category: z.string().min(1).nullable(),
  shared: z.boolean().default(false),
  // D10 — the planned bit is persisted so a dialog-created registration keeps
  // the previsto: signal of the message that opened the question.
  planned: z.boolean().default(false),
  override: savingsOverrideSchema.default({ kind: "none" }),
});

export type AmountConfirmationPayload = z.infer<typeof amountConfirmationPayloadSchema>;

/**
 * Stored payload of an open registration-collection dialog
 * (`awaiting_registration`). Lives in `BotState.pendingNote` (a String
 * column) so it survives restarts — no Prisma migration, `pendingNote` + zod
 * is the version contract (D5). The open field is DERIVED deterministically:
 * `amount === null` → ask amount; else `category === null` → ask category. The
 * `shared`/`planned` bits and the savings `override` are persisted so a
 * dialog-created registration keeps the signals of the message that opened
 * the collect (AD6/D10/D6).
 */
export const registrationCollectPayloadSchema = z.object({
  body: z.string().min(1),
  note: z.string().nullable(),
  amount: z.number().positive().nullable(),
  category: z.string().min(1).nullable(),
  shared: z.boolean().default(false),
  planned: z.boolean().default(false),
  override: savingsOverrideSchema.default({ kind: "none" }),
});

export type RegistrationCollectPayload = z.infer<typeof registrationCollectPayloadSchema>;

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

/**
 * Stored payload of an open movement-lifecycle question (design D6): the pick
 * is resolved deterministically and executes `markPaidById`/`deleteById` —
 * never by the brain. A SIBLING schema (not a discriminated union) so old
 * persisted correction payloads keep decoding untouched (D6). Lives in
 * `BotState.pendingNote` so it survives restarts.
 */
export const lifecycleSelectionPayloadSchema = z.object({
  action: z.enum(["mark_paid", "delete_expense"]),
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

export type LifecycleSelectionPayload = z.infer<typeof lifecycleSelectionPayloadSchema>;

/**
 * Stored payload of an open quick-capture preview (`awaiting_preview`, D4).
 * Lives in `BotState.pendingNote` (a String column) so it survives restarts.
 * The `saveToken` (random 8-hex) gates Guardar idempotency: a callback whose
 * state+token does not match replies "ya procesado" and executes nothing
 * (D5). The `shared`/`override` bits are persisted so a dialog-created
 * registration keeps the signals of the message that opened the preview
 * (AD6/D6); `type` is chosen by the preview buttons (REAL default, PENDING
 * via the Previsto button) — never by the brain.
 */
export const quickCapturePreviewPayloadSchema = z.object({
  body: z.string().min(1),
  amount: z.number().positive(),
  note: z.string().nullable(),
  category: z.string().min(1),
  type: z.enum(["REAL", "PENDING"]).default("REAL"),
  saveToken: z.string().regex(/^[0-9a-f]{8}$/),
  shared: z.boolean().default(false),
  override: savingsOverrideSchema.default({ kind: "none" }),
});

export type QuickCapturePreviewPayload = z.infer<typeof quickCapturePreviewPayloadSchema>;

/**
 * Stored payload of an open delete-confirmation gate
 * (`awaiting_delete_confirmation`, D6). Lives in `BotState.pendingNote` so it
 * survives restarts. The persisted `target` is the ONLY movement a `dc:ok`
 * callback may delete: no path from resolution to deletion exists without the
 * owner's 🗑 tap (spec bot-expense-lifecycle, bug #1 fix).
 */
export const deleteConfirmPayloadSchema = z.object({
  target: z.object({
    id: z.string().min(1),
    amount: z.number().positive(),
    note: z.string().nullable(),
    date: z.string().min(1),
    category: z.string(),
    occurredAtMs: z.number(),
  }),
});

export type DeleteConfirmPayload = z.infer<typeof deleteConfirmPayloadSchema>;

/** Answers that keep the movement in "otro" and end the correction dialog. */
const KEEP_OTRO_ANSWERS = new Set(["no", "otro", "dejalo", "deja", "nada"]);

/**
 * Answers that ACCEPT the correction offer without naming a category yet
 * ("si", "sí", "dale"). They must keep the awaiting_category dialog open and
 * ask for the target category — never auto-create a category named "si".
 */
const CATEGORY_AFFIRM_ANSWERS = new Set(["si", "sí", "dale", "dale dale", "ok", "oka", "de una"]);

/**
 * Explicit abandonment answers for the registration-collection dialog (T6).
 * "no, dejalo" and its variants clear the collect payload, reply clearly, and
 * register nothing from the abandoned message.
 */
const COLLECT_ABANDON_ANSWERS = new Set(["no", "no dejalo", "dejalo", "deja", "nada", "no, dejalo"]);

/** The pending dialog state the shared intent router must leave untouched. */
type DialogContext = { state: BotStateRecord };

export class TelegramService {
  private readonly queryExecutor: QueryExecutor;
  private readonly categoryExecutor: CategoryExecutor;
  private readonly movementCorrector: MovementCorrector;
  private readonly movementLifecycleExecutor: MovementLifecycleExecutor;

  constructor(private readonly deps: TelegramServiceDeps) {
    this.queryExecutor = new QueryExecutor(deps.movementService, deps.categoryService);
    this.categoryExecutor = new CategoryExecutor(deps.categoryService);
    this.movementCorrector = new MovementCorrector(deps.movementService, deps.categoryService);
    this.movementLifecycleExecutor = new MovementLifecycleExecutor({
      movementService: deps.movementService,
      expenseService: deps.expenseService,
    });
  }

  async handleUpdate(update: unknown, reply?: ReplyPort): Promise<void> {
    const message = normalizeTelegramMessage(update);
    if (message === null) {
      return;
    }

    // Order: resolve → gate → record (spec "Message Deduplication"). The chat
    // gate runs BEFORE recording: unknown chats produce no record and no reply.
    const ownerId = this.deps.household.resolveOwnerByChatId(message.fromId);
    if (ownerId === null) {
      // chatId secrecy (threat model): the log line must NOT contain the chatId.
      this.deps.logger?.(`Telegram: ignoring message ${message.messageId} from an unknown chat`);
      return;
    }

    try {
      await this.deps.messageRepository.recordProcessed(message.chatId, message.messageId, ownerId);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        this.deps.logger?.(`Telegram: message ${message.messageId} already processed, skipping`);
        return;
      }
      throw error;
    }

    const body = message.text;
    if (body.trim().length === 0) {
      return;
    }

    // Commands are checked before state consumption in every state (D6).
    const command = parseCommand(body);
    if (command !== null) {
      await this.handleCommand(command, ownerId, reply);
      return;
    }

    // D10 — the `compartido:` and `previsto:` prefixes are parsed ONCE at
    // arrival (loop-stripped in any order); the stripped text flows to the
    // brain/parser and the shared/planned bits are threaded down.
    const { text: sharedStripped, shared: sharedByPrefix, planned } = parseArrivalPrefixes(body);

    // Planned expenses are INDIVIDUAL by design: combining `compartido:` with
    // `previsto:` (either order) is rejected with an educational redirect and
    // creates nothing — no registration, no dialog, state untouched.
    if (sharedByPrefix && planned) {
      await this.safeReply(reply, plannedSharedRejectedReply());
      return;
    }

    // D6 — the savings override ("sin ahorro" / "con X%") is parsed ONCE at
    // arrival right after the shared prefix, stripped before the parser/brain,
    // and persisted in the amount-confirmation payload. An invalid percent
    // rejects the registration: nothing is stored and nothing is answered by
    // the parser/brain.
    const overrideResult = parseSavingsOverride(sharedStripped);
    if (!overrideResult.ok) {
      await this.safeReply(reply, savingsOverrideInvalidReply(overrideResult.percent));
      return;
    }
    const { text: stripped, override } = overrideResult;

    const state = await this.deps.botStateRepository.get(ownerId);

    if (state?.state === AWAITING_SETUP) {
      await this.handleSetupReply(stripped, ownerId, reply);
      return;
    }

    if (state?.state === AWAITING_PREVIEW) {
      // D11 — any new non-command text during a preview abandons it (idle)
      // and reprocesses normally: nothing registers from the preview facts.
      await this.deps.botStateRepository.set({
        ownerId,
        state: IDLE,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.handleRegistration(stripped, ownerId, sharedByPrefix, planned, override, reply);
      return;
    }

    if (state?.state === AWAITING_DELETE_CONFIRMATION) {
      // D11 — any new non-command text during the delete gate abandons it
      // (idle, nothing deleted) and reprocesses normally.
      await this.deps.botStateRepository.set({
        ownerId,
        state: IDLE,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.handleRegistration(stripped, ownerId, sharedByPrefix, planned, override, reply);
      return;
    }

    if (state?.state === AWAITING_CATEGORY || state?.state === AWAITING_AMOUNT_CONFIRMATION || state?.state === AWAITING_REGISTRATION) {
      await this.handleDialogMessage(state, stripped, ownerId, sharedByPrefix, planned, override, reply);
      return;
    }

    if (state?.state === AWAITING_MOVEMENT_SELECTION) {
      await this.handleMovementSelection(state, stripped, ownerId, sharedByPrefix, planned, override, reply);
      return;
    }

    await this.handleRegistration(stripped, ownerId, sharedByPrefix, planned, override, reply);
  }

  /**
   * D4 — callback channel: processes a `callback_query` update and dispatches
   * on the stable action prefix in `data` (bot-inline-interactions "Callback
   * Query Routing"). Returns true when the callback was processed (the caller
   * MUST `answerCallbackQuery`), false when it was ignored (unknown chat,
   * non-callback update, non-string data — nothing executes, no reply).
   * An unknown action prefix replies honestly ("acción no disponible") and
   * changes no state (spec "Unknown action replied honestly").
   */
  async handleCallback(update: unknown, reply?: ReplyPort): Promise<boolean> {
    const callback = normalizeTelegramCallback(update);
    if (callback === null) {
      return false;
    }

    // The chat gate runs BEFORE anything: callbacks from unknown chats are
    // ignored entirely (no answer, no reply, no state change).
    const ownerId = this.deps.household.resolveOwnerByChatId(callback.fromId);
    if (ownerId === null) {
      this.deps.logger?.(`Telegram: ignoring callback ${callback.data} from an unknown chat`);
      return false;
    }

    await this.dispatchCallback(callback, ownerId, reply);
    return true;
  }

  /** D4 — action-prefix dispatch for a gated callback (see the callback_data scheme table). */
  private async dispatchCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [action] = callback.data.split(":");

    switch (action) {
      case "m":
        await this.handleMenuCallback(callback, ownerId, reply);
        return;
      case "pv":
        await this.handlePreviewCallback(callback, ownerId, reply);
        return;
      case "dc":
        await this.handleDeleteGateCallback(callback, ownerId, reply);
        return;
      case "dk":
      case "dkp":
        await this.handleDeletePickCallback(callback, ownerId, reply);
        return;
      case "cat":
      case "cp":
        await this.handleCategoryPickCallback(callback, ownerId, reply);
        return;
      default:
        // Unknown action prefix: honest reply, no state change (spec
        // "Unknown action replied honestly").
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /** D4/D8 — menu callbacks (m:new/m:prev/m:del/m:rep/m:help). */
  private async handleMenuCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, sub] = callback.data.split(":");
    switch (sub) {
      case "new":
        // Nuevo gasto: start text capture (idle, no state change).
        await this.safeReply(reply, capturePromptReply());
        return;
      case "prev":
        // Gasto previsto (D8): teaches the `previsto:` prefix AND the Previsto
        // preview button. NO remembered intent, NO new state — the ONLY PENDING
        // producers stay the prefix and the preview button.
        await this.safeReply(reply, pendingCapturePromptReply());
        return;
      case "del": {
        // Borrar (D10): the delete window renders as dk:<id> buttons; a pick
        // then opens the confirmation gate. Nothing is deleted here.
        const window = await this.movementLifecycleExecutor.deleteWindow(ownerId);
        if (window.length === 0) {
          await this.safeReply(reply, nothingToDeleteReply());
          return;
        }
        const payload: LifecycleSelectionPayload = {
          action: "delete_expense",
          candidates: window.map((candidate) => ({
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
        await this.safeReply(
          reply,
          deletePickListReply(window),
          window.map((candidate) => [{ text: `${candidate.date} · ${formatARS(candidate.amount)}`, callback_data: buildCallbackData(["dk", candidate.id]) }]),
          undefined,
        );
        return;
      }
      case "rep":
        // Reporte: the recent-query executor answers from the owner's real
        // movements (spec bot-main-menu "Reporte answers from real data").
        await this.executeRecentQuery(ownerId, reply);
        return;
      case "help":
        // Ayuda: static help, zero LLM calls (spec "Ayuda replies offline").
        await this.safeReply(reply, ayudaReply());
        return;
      default:
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /** D8 — the Reporte menu action: the deterministic recent query against real data. */
  private async executeRecentQuery(ownerId: string, reply?: ReplyPort): Promise<void> {
    try {
      const result = await this.queryExecutor.execute(this.scopeFor(ownerId), "recent");
      await this.makeSender(true, reply)(
        {
          intent: "query_recent",
          ok: true,
          action: "answered",
          amount: null,
          category: null,
          note: null,
          query_type: "recent",
          query: result,
        },
        queryReplyTemplate(result),
      );
    } catch (error) {
      this.deps.logger?.(`Telegram: menu recent query failed: ${String(error)}`);
      await this.safeReply(reply, queryRedirectReply());
    }
  }

  /** D4/D5 — quick-capture preview callbacks (pv:save/pv:edit/pv:typ). */
  private async handlePreviewCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const parts = callback.data.split(":");
    const sub = parts[1];
    // Token position: pv:save:<tok> / pv:edit:<tok> (index 2); pv:typ:<r|p>:<tok> (index 3).
    const token = sub === "typ" ? parts[3] : parts[2];
    if (token === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const payload = this.decodePreviewPayload(state?.pendingNote ?? null);

    // D5 — state+token gate: a callback whose expected state+token does not
    // match replies "ya procesado" and executes nothing (retries are
    // ANSWERED, never double-executed).
    if (state?.state !== AWAITING_PREVIEW || payload === null || payload.saveToken !== token) {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    switch (sub) {
      case "save":
        await this.saveQuickCapture(state, payload, ownerId, reply);
        return;
      case "edit":
        // Corregir (D4): abandon the preview, return to idle, prompt a new capture.
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(reply, capturePromptReply());
        return;
      case "typ": {
        // Type selection by button (D4): REAL or PENDING, never a brain
        // inference. The preview re-renders with the chosen type.
        const typeChar = parts[2];
        const type = typeChar === "p" ? "PENDING" : "REAL";
        const updated: QuickCapturePreviewPayload = { ...payload, type };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_PREVIEW,
          pendingMovementId: null,
          pendingNote: JSON.stringify(updated),
        });
        await this.safeReply(reply, previewReply(payload.amount, payload.note, payload.category, type), this.previewKeyboard(updated), callback.messageId);
        return;
      }
      default:
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /** D4 — enters the quick-capture preview: persists the payload and renders the Guardar/Corregir + type keyboard. */
  private async enterQuickCapturePreview(
    body: string,
    capture: QuickCapture,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    const payload: QuickCapturePreviewPayload = {
      body,
      amount: capture.amount,
      note: capture.note,
      category: capture.category,
      // The `previsto:` prefix is a sanctioned PENDING producer (D7/D8); the
      // default REAL is switched by the Previsto button.
      type: planned ? "PENDING" : "REAL",
      saveToken: newSaveToken(),
      shared,
      override,
    };
    await this.deps.botStateRepository.set({
      ownerId,
      state: AWAITING_PREVIEW,
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    await this.safeReply(reply, previewReply(payload.amount, payload.note, payload.category, payload.type), this.previewKeyboard(payload), undefined);
  }

  /** D4 — the preview keyboard: actions row (Guardar/Corregir) + type row (Real/Previsto), ids never names. */
  private previewKeyboard(payload: QuickCapturePreviewPayload): InlineKeyboard {
    const token = payload.saveToken;
    const typeLabel = (type: "REAL" | "PENDING") => (payload.type === type ? "●" : "○");
    return [
      [
        { text: "✅ Guardar", callback_data: buildCallbackData(["pv", "save", token]) },
        { text: "✏️ Corregir", callback_data: buildCallbackData(["pv", "edit", token]) },
      ],
      [
        { text: `${typeLabel("REAL")} Gasto real`, callback_data: buildCallbackData(["pv", "typ", "r", token]) },
        { text: `${typeLabel("PENDING")} Previsto`, callback_data: buildCallbackData(["pv", "typ", "p", token]) },
      ],
    ];
  }

  /**
   * D4/D5 — Guardar executes exactly once: the state transitions to idle FIRST
   * (the state IS the consumption record), then the movement registers with
   * the previewed facts. A retried callback finds no matching gate and replies
   * "ya procesado" (spec quick-capture "Save Idempotency").
   */
  private async saveQuickCapture(
    state: BotStateRecord,
    payload: QuickCapturePreviewPayload,
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
    void state;
    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    const planned = payload.type === "PENDING";
    // PENDING registers as EXPENSE + PENDING and is NEVER SHARED (spec
    // quick-capture "Save with Previsto registers PENDING").
    await this.registerWithCategory(payload.body, payload.amount, payload.note, payload.category, ownerId, payload.shared, planned, payload.override, this.makeSender(false, reply));
  }

  /** D4 — decodes a persisted preview payload; corrupt JSON yields null (spec "Corrupt preview payload recovers"). */
  private decodePreviewPayload(pendingNote: string | null): QuickCapturePreviewPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = quickCapturePreviewPayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** D4/D6 — delete-gate callbacks (dc:ok/dc:no). */
  private async handleDeleteGateCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, sub, targetId] = callback.data.split(":");
    if (targetId === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const payload = this.decodeDeleteConfirmPayload(state?.pendingNote ?? null);

    // Corrupt gate payload: the gate cannot be trusted, so it abandons to idle
    // WITHOUT deleting anything (spec bot-expense-lifecycle: "A retried or
    // corrupt gate payload MUST recover without deleting").
    if (state?.state === AWAITING_DELETE_CONFIRMATION && payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    // D5/D6 — state+target gate: a dc:ok/dc:no whose expected state+target
    // does not match replies "ya procesado" and executes nothing (a retried
    // confirm never double-deletes).
    if (state?.state !== AWAITING_DELETE_CONFIRMATION || payload === null || payload.target.id !== targetId) {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    if (sub === "no") {
      // Cancel (D6): close the gate, nothing is deleted.
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, deleteCancelledReply());
      return;
    }

    // Confirm: transition to idle FIRST (the state is the consumption record),
    // then delete the persisted target; a 404 (deleted elsewhere) replies
    // movement missing (spec "Deleted target replies missing").
    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    const result = await this.movementLifecycleExecutor.deleteById(ownerId, payload.target);
    await this.sendLifecycleResult("delete_expense", result, reply);
  }

  /** D6 — decodes a persisted delete-gate payload; corrupt JSON yields null (corrupt gate recovers without deleting). */
  private decodeDeleteConfirmPayload(pendingNote: string | null): DeleteConfirmPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = deleteConfirmPayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** D4/D10 — delete-pick callbacks (dk:<id>): resolve the picked candidate from the persisted selection payload and open the gate. */
  private async handleDeletePickCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, targetId] = callback.data.split(":");
    if (targetId === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const lifecycle = this.decodeLifecycleSelectionPayload(state?.pendingNote ?? null);

    // The pick only applies to an open delete selection; anything else is
    // answered honestly and changes no state.
    if (state?.state !== AWAITING_MOVEMENT_SELECTION || lifecycle === null || lifecycle.action !== "delete_expense") {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    const picked = lifecycle.candidates.find((candidate) => candidate.id === targetId);
    if (picked === undefined) {
      // The candidate disappeared (stale button): re-render the window honestly.
      const window = await this.movementLifecycleExecutor.deleteWindow(ownerId);
      if (window.length === 0) {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(reply, nothingToDeleteReply());
        return;
      }
      const updated: LifecycleSelectionPayload = {
        action: "delete_expense",
        candidates: window.map((candidate) => ({
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
        pendingNote: JSON.stringify(updated),
      });
      await this.safeReply(reply, deletePickListReply(window));
      return;
    }

    // The pick opens the delete GATE with the picked target (D6/D10): nothing
    // is deleted until the 🗑 tap.
    const candidate = { ...picked, category: "", occurredAtMs: 0 };
    const gatePayload: DeleteConfirmPayload = { target: candidate };
    await this.deps.botStateRepository.set({
      ownerId,
      state: AWAITING_DELETE_CONFIRMATION,
      pendingMovementId: null,
      pendingNote: JSON.stringify(gatePayload),
    });
    await this.safeReply(
      reply,
      deleteConfirmReply(candidate.amount, candidate.note, null),
      [
        [
          { text: "❌ Cancelar", callback_data: buildCallbackData(["dc", "no", candidate.id]) },
          { text: "🗑 Borrar", callback_data: buildCallbackData(["dc", "ok", candidate.id]) },
        ],
      ],
      undefined,
    );
  }

  /** D9 — renders the closed-set category buttons for the correction dialog (`awaiting_category`). */
  private async renderCategoryButtons(
    ownerId: string,
    _state: BotStateRecord,
    _send: Sender,
    reply?: ReplyPort,
  ): Promise<void> {
    // D3 — keyboards render ONLY on deterministic fixed surfaces; the sender
    // (brain-or-fixed) stays text-only, so the buttons go through safeReply.
    await this.safeReply(reply, categoryButtonsReply(), await this.categoryKeyboard(ownerId, 0), undefined);
  }

  /** D9 — renders the closed-set category buttons for the registration collect (`awaiting_registration`). */
  private async renderCollectCategoryButtons(
    ownerId: string,
    _payload: RegistrationCollectPayload,
    _send: Sender,
    reply?: ReplyPort,
  ): Promise<void> {
    await this.safeReply(reply, categoryButtonsReply(), await this.categoryKeyboard(ownerId, 0), undefined);
  }

  /**
   * D9/D4 — the closed-set category keyboard: `cat:<id>` buttons (7 per page)
   * plus an "otro" row and `cp:<page>` navigation when the set exceeds the
   * limit (Telegram: ≤ 8 rows, ≤ 64 bytes per callback_data; ids, never names).
   */
  private async categoryKeyboard(ownerId: string, page: number): Promise<InlineKeyboard> {
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const ordered = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    const otro = ordered.filter((category) => normalizeForMatch(category.name) === "otro");
    const rest = ordered.filter((category) => normalizeForMatch(category.name) !== "otro");
    const pageSize = 7;
    const start = page * pageSize;
    const pageItems = rest.slice(start, start + pageSize);
    const rows: InlineButton[][] = pageItems.map((category) => [
      { text: category.name, callback_data: buildCallbackData(["cat", category.id]) },
    ]);
    for (const category of otro) {
      rows.push([{ text: category.name, callback_data: buildCallbackData(["cat", category.id]) }]);
    }
    if (rest.length > pageSize) {
      const totalPages = Math.ceil(rest.length / pageSize);
      rows.push([
        { text: "◀️", callback_data: buildCallbackData(["cp", String(Math.max(0, page - 1))]) },
        { text: `${page + 1}/${totalPages}`, callback_data: buildCallbackData(["cp", String(page)]) },
        { text: "▶️", callback_data: buildCallbackData(["cp", String(Math.min(totalPages - 1, page + 1))]) },
      ]);
    }
    return rows;
  }

  /** D9 — shared correction tail: reassigns the pending movement to the picked category (text and cat: callbacks run identical code). */
  private async applyCategoryCorrection(
    category: string,
    ownerId: string,
    state: BotStateRecord,
    send: Sender,
    reply?: ReplyPort,
  ): Promise<void> {
    await this.answerCorrection(state, category, ownerId, send, reply);
  }

  /** D9 — shared collect tail: completes the registration with the picked category (text and cat: callbacks run identical code). */
  private async applyCollectCategory(
    payload: RegistrationCollectPayload,
    category: string,
    ownerId: string,
    send: Sender,
  ): Promise<void> {
    await this.registerWithCategory(payload.body, payload.amount as number, payload.note, category, ownerId, payload.shared, payload.planned, payload.override, send);
  }

  /** D4/D9 — category-pick callbacks (cat:<id>/cp:<page>). */
  private async handleCategoryPickCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [action, value] = callback.data.split(":");
    const state = await this.deps.botStateRepository.get(ownerId);

    if (action === "cp") {
      // Pagination: re-render the same keyboard page without touching state.
      const page = Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
      if (state?.state === AWAITING_CATEGORY) {
        await this.safeReply(reply, categoryButtonsReply(), await this.categoryKeyboard(ownerId, page), undefined);
      } else if (state?.state === AWAITING_REGISTRATION) {
        const payload = this.decodeCollectPayload(state.pendingNote);
        if (payload === null) {
          await this.safeReply(reply, dialogClosedReply());
          return;
        }
        await this.safeReply(reply, categoryButtonsReply(), await this.categoryKeyboard(ownerId, page), undefined);
      } else {
        await this.safeReply(reply, dialogClosedReply());
      }
      return;
    }

    // cat:<id> — re-resolve the id → name at callback time (D9): a deleted
    // category replies honestly and re-renders the buttons (state stays open);
    // a closed dialog replies dialog-closed.
    const categoryId = value;
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const category = categories.find((candidate) => candidate.id === categoryId);

    if (state?.state === AWAITING_CATEGORY) {
      if (category === undefined) {
        await this.safeReply(reply, categoryButtonsReply(), await this.categoryKeyboard(ownerId, 0), undefined);
        return;
      }
      const send = this.makeSender(true, reply);
      await this.applyCategoryCorrection(category.name, ownerId, state, send, reply);
      return;
    }

    if (state?.state === AWAITING_REGISTRATION) {
      const payload = this.decodeCollectPayload(state.pendingNote);
      if (payload === null) {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(reply, questionDroppedReply());
        return;
      }
      if (category === undefined) {
        await this.safeReply(reply, categoryButtonsReply(), await this.categoryKeyboard(ownerId, 0), undefined);
        return;
      }
      const send = this.makeSender(true, reply);
      await this.applyCollectCategory(payload, category.name, ownerId, send);
      return;
    }

    await this.safeReply(reply, dialogClosedReply());
  }

  private async handleRegistration(
    body: string,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    const categories = await this.deps.categoryService.listCategories(ownerId);

    // The setup gate wins BEFORE any brain call: the brain never fires for
    // owners without categories. The question lists the (empty) existing set.
    if (categories.length === 0) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_SETUP,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.safeReply(reply, setupQuestionReply(categories.map((category) => category.name)));
      return;
    }

    // D4 — deterministic-first: the quick-capture parser runs BEFORE the
    // brain for every non-command owner message in idle (spec quick-capture
    // "Deterministic-First Ordering"). On a match the preview flow runs and
    // the brain is NEVER invoked for this message; on a miss the routing
    // falls back to the brain for the uncaptured intent.
    const quickCapture = quickCaptureParse(body, await this.deps.categoryService.listKeywordRules(ownerId));
    if (quickCapture !== null) {
      await this.enterQuickCapturePreview(body, quickCapture, ownerId, shared, planned, override, reply);
      return;
    }

    const envelope = await this.tryBrainInterpret(body);
    if (envelope === null) {
      // D5: interpret-null → full deterministic path, fixed replies, no reply call.
      await this.deterministicRegistration(body, parseAmountAndNote(body), categories, ownerId, shared, planned, override, reply);
      return;
    }

    await this.routeEnvelopeIntent(envelope, body, ownerId, shared, planned, override, reply);
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
  private async executeCategoryCommand(envelope: ConversationEnvelope, ownerId: string, reply?: ReplyPort): Promise<void> {
    const result = await this.categoryExecutor.execute(ownerId, envelope);
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
  private async executeQuery(envelope: ConversationEnvelope, ownerId: string, reply?: ReplyPort): Promise<void> {
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
      result = await this.queryExecutor.execute(this.scopeFor(ownerId), queryType);
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

    // D7 — the planned query also carries the facts at the top level so the
    // reply prompt can confirm the next-month total unconditionally.
    const plannedFacts = queryType === "planned" ? (result as PlannedQueryResult) : null;
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
        planned_month: plannedFacts?.month,
        planned_total: plannedFacts?.total,
      },
      queryReplyTemplate(result),
    );
  }

  /** Today's flow verbatim minus the brain: fixed replies only, no reply call. */
  private async deterministicRegistration(
    body: string,
    parsed: ParsedAmount | null,
    categories: CategoryWithKeywords[],
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    if (parsed === null) {
      // D8: without the brain, collection fires ONLY on a deterministic
      // `previsto:`/`compartido:` prefix without an amount; a bare noun keeps
      // the help reply unchanged.
      if (shared || planned) {
        const note = extractNote(body);
        const matchedCategory = await this.deps.categoryService.matchNote(ownerId, note ?? body);
        const payload: RegistrationCollectPayload = {
          body,
          note,
          amount: null,
          category: matchedCategory,
          shared,
          planned,
          override,
        };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_REGISTRATION,
          pendingMovementId: null,
          pendingNote: JSON.stringify(payload),
        });
        await this.safeReply(reply, askAmountReply(note));
        return;
      }
      await this.safeReply(reply, helpReply());
      return;
    }

    const note = parsed.note ?? body;
    const matched = await this.deps.categoryService.matchNote(ownerId, note);

    // A user-authored keyword rule beats any brain suggestion.
    if (matched !== null) {
      await this.registerWithCategory(body, parsed.amount, parsed.note, matched, ownerId, shared, planned, override, this.makeSender(false, reply));
      return;
    }

    await this.registerOtroWithCorrection(body, parsed.amount, parsed.note, ownerId, shared, planned, override, this.makeSender(false, reply), reply);
  }

  /** register_expense envelope: amount → note → category, then register. */
  private async executeRegistration(
    body: string,
    parsed: ParsedAmount | null,
    envelope: ConversationEnvelope,
    categories: CategoryWithKeywords[],
    ownerId: string,
    sharedByPrefix: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
    /** CR-5: an optional merged sender injected by the register-during-dialog
     * branch so the abandon fact and the registration outcome land in ONE
     * reply. Absent → the regular brain-or-fixed sender. */
    send?: Sender,
  ): Promise<void> {
    const activeSend = send ?? this.makeSender(true, reply);
    const detAmount = parsed?.amount ?? null;
    const brainAmount = envelope.amount;
    // AD6 — the deterministic prefix is authoritative and wins over the brain
    // flag: visibility = prefixShared OR envelope.shared === true.
    const shared = sharedByPrefix || envelope.shared === true;
    // D7 — the planned type is a deterministic button/prefix decision: the
    // brain never signals it (the `planned` key is rejected by the envelope
    // schema, presence → null), so only the arrival prefix produces PENDING
    // here. The preview button materializes PENDING in its own save path.
    const effectivePlanned = planned;

    if (detAmount === null && brainAmount === null) {
      // E1 (T1): a register_expense with no amount (deterministic nor brain)
      // enters the registration-collection dialog: the collected facts are
      // persisted and the amount is asked. The category is pre-resolved when
      // a keyword rule or a resolvable brain suggestion exists; otherwise the
      // collect asks the amount first, then the category (D2).
      const note = envelope.note ?? extractNote(body);
      const matchedCategory = await this.deps.categoryService.matchNote(ownerId, note ?? body);
      const category = matchedCategory ?? this.resolveSuggestion(envelope.category, categories);
      const payload: RegistrationCollectPayload = {
        body,
        note,
        amount: null,
        category,
        shared,
        planned: effectivePlanned,
        override,
      };
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_REGISTRATION,
        pendingMovementId: null,
        pendingNote: JSON.stringify(payload),
      });
      await activeSend(
        {
          intent: "register_expense",
          ok: false,
          action: "asked_registration",
          amount: null,
          category,
          note: body,
          asked_field: "amount",
        },
        askAmountReply(note),
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
      await this.askAmountConfirmation(body, detAmount, brainAmount, parsed, envelope, categories, ownerId, shared, effectivePlanned, override, activeSend);
      return;
    }

    // Deterministic note wins; the brain fills the gap; never conflict-asks.
    const note = parsed !== null ? (parsed.note ?? envelope.note) : (envelope.note ?? extractNote(body));

    // Category: the keyword rule runs first and beats the brain suggestion;
    // otherwise the suggestion resolves by exact normalized match only.
    const matched = await this.deps.categoryService.matchNote(ownerId, note ?? body);
    const category = matched ?? this.resolveSuggestion(envelope.category, categories);
    if (category !== null) {
      await this.registerWithCategory(body, amount, note, category, ownerId, shared, effectivePlanned, override, activeSend);
      return;
    }
    // E2 (T2): the envelope SIGNALED a category ("category" non-null) but the
    // signal resolves to nothing — enter the collect dialog with the amount
    // persisted and ask the category. A "otro" signal is NO signal (the
    // fallback flow owns it); an absent signal keeps today's otro+correction.
    if (envelope.category !== null && normalizeForMatch(envelope.category) !== "otro") {
      const payload: RegistrationCollectPayload = {
        body,
        note,
        amount,
        category: null,
        shared,
        planned: effectivePlanned,
        override,
      };
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_REGISTRATION,
        pendingMovementId: null,
        pendingNote: JSON.stringify(payload),
      });
      await activeSend(
        {
          intent: "register_expense",
          ok: false,
          action: "asked_registration",
          amount,
          category: null,
          note: body,
          asked_field: "category",
        },
        askCategoryReply(note),
      );
      return;
    }
    await this.registerOtroWithCorrection(body, amount, note, ownerId, shared, effectivePlanned, override, activeSend, reply);
  }

  /** Amounts differ: persist the question and ask; nothing registers silently. */
  private async askAmountConfirmation(
    body: string,
    detAmount: number,
    brainAmount: number,
    parsed: ParsedAmount | null,
    envelope: ConversationEnvelope,
    categories: CategoryWithKeywords[],
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    send: Sender,
  ): Promise<void> {
    const note = parsed !== null ? (parsed.note ?? envelope.note) : (envelope.note ?? extractNote(body));
    const payload: AmountConfirmationPayload = {
      body,
      note,
      amounts: [detAmount, brainAmount],
      category: this.resolveSuggestion(envelope.category, categories),
      shared,
      planned,
      override,
    };
    await this.deps.botStateRepository.set({
      ownerId,
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
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
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
      await this.handleRegistration(body, ownerId, shared, planned, override, reply);
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
      await this.handleRegistration(body, ownerId, shared, planned, override, reply);
      return;
    }

    // Register from the STORED context (payload.shared persists the bit, AD6;
    // payload.planned persists the previsto bit, D10; payload.override persists
    // the savings override, D6); a creation failure leaves the question open.
    if (payload.category !== null) {
      await this.registerWithCategory(payload.body, chosen, payload.note, payload.category, ownerId, payload.shared, payload.planned, payload.override, send);
    } else {
      await this.registerOtroWithCorrection(payload.body, chosen, payload.note, ownerId, payload.shared, payload.planned, payload.override, send, reply);
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

  /**
   * Decodes a persisted registration-collect payload. Corrupt or missing
   * JSON yields null → the T10 recovery owns the message (idle + dropped
   * reply, nothing registers, no reprocessing).
   */
  private decodeCollectPayload(pendingNote: string | null): RegistrationCollectPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = registrationCollectPayloadSchema.safeParse(JSON.parse(pendingNote));
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
   * Resolves a brain category suggestion against the owner's categories:
   * exact normalized equality first, then the tolerant plural fold (B2) so
   * "cafes"→"Cafe" and "Otros"→"otro" resolve. Never creates categories; an
   * exact "otro" suggestion is treated as NO suggestion so the normal
   * correction flow follows (today's behavior); a FOLDED "otro" (e.g. "Otros")
   * resolves to the fallback WITHOUT a correction offer (spec truth table).
   */
  private resolveSuggestion(suggestion: string | null, categories: CategoryWithKeywords[]): string | null {
    if (suggestion === null) {
      return null;
    }
    if (normalizeForMatch(suggestion) === "otro") {
      return null;
    }
    const exact = categories.find((category) => normalizeForMatch(category.name) === normalizeForMatch(suggestion));
    if (exact !== undefined) {
      return exact.name;
    }
    const folded = normalizeForMatchTolerant(suggestion);
    const foldedMatch = categories.find((category) => normalizeForMatchTolerant(category.name) === folded);
    return foldedMatch === undefined ? null : foldedMatch.name;
  }

  private async handleSetupReply(body: string, ownerId: string, reply?: ReplyPort): Promise<void> {
    const entries = parseSetupBatchCommand(body);
    const createNames = entries.filter((entry) => entry.kind === "create").map((entry) => entry.name);
    const hasCommands = entries.some((entry) => entry.kind !== "create");
    if (createNames.length === 0 && !hasCommands) {
      await this.safeReply(reply, setupRetryReply());
      return;
    }

    const existing = await this.deps.categoryService.listCategories(ownerId);
    const existingNormalized = new Set(existing.map((category) => normalizeForMatchTolerant(category.name)));

    // Batch commands execute through the guarded CategoryService with per-command
    // honest outcomes; only remaining plain tokens become categories (D11).
    const deleted: string[] = [];
    const renamed: { from: string; to: string }[] = [];
    for (const entry of entries) {
      if (entry.kind === "delete") {
        try {
          await this.deps.categoryService.deleteCategory(ownerId, entry.name);
          deleted.push(entry.name);
        } catch (error) {
          if (error instanceof NotFoundError || error instanceof ValidationFailedError) {
            continue; // missing or forbidden delete: nothing to report
          }
          throw error;
        }
      } else if (entry.kind === "rename") {
        try {
          const result = await this.deps.categoryService.renameCategory(ownerId, entry.from, entry.to);
          if (result !== null) {
            renamed.push({ from: entry.from, to: result.name });
          }
        } catch (error) {
          if (
            error instanceof NotFoundError ||
            error instanceof ValidationFailedError ||
            error instanceof ReservedCategoryError
          ) {
            continue; // the rename did not apply: honest per-command outcome
          }
          throw error;
        }
      }
    }

    const created: string[] = [];
    const redirects: { name: string; concept: ReservedCategoryError["concept"] }[] = [];
    for (const name of this.dedupeNames(createNames)) {
      if (normalizeForMatch(name) === "otro") {
        continue; // the fallback is created by ensureOtro below
      }
      if (existingNormalized.has(normalizeForMatchTolerant(name))) {
        continue;
      }
      try {
        await this.deps.categoryService.createCategory(ownerId, name);
        created.push(name);
        existingNormalized.add(normalizeForMatchTolerant(name));
      } catch (error) {
        if (error instanceof ReservedCategoryError) {
          // Reserved names are rejected with their educational redirect; the
          // setup continues with the remaining entries (spec "Setup entry gated").
          redirects.push({ name, concept: error.concept });
          continue;
        }
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
    await this.safeReply(
      reply,
      setupBatchDoneReply({ created: finalCreated, redirects, deleted, renamed }),
    );
  }

  private async d6AwaitingCategory(
    state: BotStateRecord,
    body: string,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    const send = this.makeSender(this.brainAvailable, reply);
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const normalizedText = normalizeForMatch(body);
    const trimmed = body.trim();

    // Keep the movement in "otro": explicit abandonment answers never dead-end.
    // Guard normalization strips punctuation so "no."/"no," fold to "no" and
    // never reach category creation (spec "Punctuated guard never auto-creates").
    if (KEEP_OTRO_ANSWERS.has(normalizeForMatchGuard(body))) {
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
      await this.answerCorrection(state, exactCategory.name, ownerId, send, reply);
      return;
    }

    // D6 rule 1 (folded): a plural variant of an existing category name is the
    // ANSWER, never a new category ("cafes" resolves to "Cafe").
    const foldedCategory = categories.find(
      (category) => normalizeForMatchTolerant(category.name) === normalizeForMatchTolerant(body),
    );
    if (foldedCategory !== undefined) {
      await this.answerCorrection(state, foldedCategory.name, ownerId, send, reply);
      return;
    }

    // An affirmation to the correction offer keeps the dialog open and asks for
    // the target category — never auto-creates a category named "si" (D6).
    if (CATEGORY_AFFIRM_ANSWERS.has(normalizeForMatchGuard(body))) {
      await this.safeReply(reply, categoryFollowUpReply());
      return;
    }

    // D6 rule 2: parses as amount → NEW registration; the pending correction is abandoned.
    if (parseAmountAndNote(body) !== null) {
      await send(
        { intent: "correct_category", ok: false, action: "none", amount: null, category: null, note: body },
        correctionAbandonedReply(),
      );
      await this.handleRegistration(body, ownerId, shared, planned, override, reply);
      return;
    }

    // D6 rule 3: a single token → ANSWER + auto-create, routed through the
    // guarded choke point. A reserved reject keeps the correction open with a
    // redirect (the movement stays in "otro").
    if (trimmed.split(/\s+/).length === 1) {
      // Single-token guard reject: a token that guard-normalizes to a guard
      // word ("no.", "si.", with or without punctuation) routes to the matching
      // abandon/affirmation handling; a punctuation-only token is a non-answer
      // that lists the categories. Neither ever reaches category creation.
      const guarded = normalizeForMatchGuard(trimmed);
      if (KEEP_OTRO_ANSWERS.has(guarded)) {
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
      if (CATEGORY_AFFIRM_ANSWERS.has(guarded)) {
        await this.safeReply(reply, categoryFollowUpReply());
        return;
      }
      if (guarded.length === 0) {
        await send(
          { intent: "correct_category", ok: false, action: "asked_category", amount: null, category: null, note: trimmed },
          categoryNotFoundReply(trimmed, categories.map((category) => category.name)),
        );
        return;
      }
      // D9 — the single-token free-text auto-create is REMOVED: a non-match
      // answer (reserved or not) renders the closed-set category buttons and
      // the state stays open — nothing is created (spec
      // conversational-categories "Unknown answer shows buttons").
      await this.renderCategoryButtons(ownerId, state, send, reply);
      return;
    }

    // A multi-word non-category answer → DO NOT dead-end: present the existing
    // categories as buttons so the user can pick, keeping the state open (the
    // movement is already safe in "otro").
    await this.renderCategoryButtons(ownerId, state, send, reply);
  }

  /**
   * D6 fallback for `awaiting_registration`: the deterministic collect rules
   * when the brain is null/absent or explicitly abandons. A corrupt payload
   * recovers WITHOUT reprocessing (T10); the full abandon/amount/category
   * cascade follows the design (mirroring :707-798).
   */
  private async d6AwaitingRegistration(
    state: BotStateRecord,
    body: string,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    const send = this.makeSender(this.brainAvailable, reply);
    const payload = this.decodeCollectPayload(state.pendingNote);

    // T10: a corrupt or missing payload abandons the collect without
    // reprocessing — nothing registers, nothing crashes.
    if (payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        questionDroppedReply(),
      );
      return;
    }

    // The amount/category resolver bodies land with their RED tests (2.8/2.10).
    await this.awaitingRegistrationAnswer(state, payload, null, body, ownerId, send, reply);
  }

  /**
   * Resolve for `awaiting_registration`: the collect answer acts ONLY on the
   * persisted payload. A corrupt payload drops the dialog (T10); the amount
   * and category resolver bodies land with their RED tests (2.8/2.10).
   */
  private async resolveAwaitingRegistration(
    state: BotStateRecord,
    envelope: ConversationEnvelope,
    body: string,
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const send = this.makeSender(true, reply);
    const payload = this.decodeCollectPayload(state.pendingNote);

    // Phantom guard rule 1: the collect payload must parse.
    if (payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        questionDroppedReply(),
      );
      return;
    }

    await this.awaitingRegistrationAnswer(state, payload, envelope, body, ownerId, send, reply);
  }

  /**
   * Shared collect-answer tail: dispatches on the DERIVED open field and
   * resolves from the message/payload ONLY (phantom guard — the resolve value
   * originates in the current message; `envelope.amount` is a brain rescue,
   * positive-only, available in resolve mode only). T4: amount open → resolve
   * the amount; T5: category open → the category cascade. A wrong-field or
   * empty resolve re-asks (T9).
   */
  private async awaitingRegistrationAnswer(
    state: BotStateRecord,
    payload: RegistrationCollectPayload,
    envelope: ConversationEnvelope | null,
    body: string,
    ownerId: string,
    send: Sender,
    reply?: ReplyPort,
  ): Promise<void> {
    void state;
    // T6: an explicit abandonment answer clears the collect before any field
    // resolution — nothing registers from the abandoned message. Guard
    // normalization folds "no,"/"no." onto the abandonment set.
    if (COLLECT_ABANDON_ANSWERS.has(normalizeForMatchGuard(body.trim()))) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        collectAbandonedReply(),
      );
      return;
    }
    if (payload.amount === null) {
      await this.resolveRegistrationAmount(payload, envelope, body, ownerId, send);
      return;
    }
    await this.resolveRegistrationCategory(payload, envelope, body, ownerId, send, reply);
  }

  /**
   * T4: the amount is open. The amount comes from the message
   * (`normalizeAmountString(body) ?? parseAmount(body)`), then the brain
   * amount as positive-only rescue (never fabricated). With amount and
   * category resolved the registration completes from the STORED context;
   * with only the amount resolved the payload persists it and the category is
   * asked. A resolve with no amount re-asks (T9) — never fabricates, never
   * reprocesses.
   */
  private async resolveRegistrationAmount(
    payload: RegistrationCollectPayload,
    envelope: ConversationEnvelope | null,
    body: string,
    ownerId: string,
    send: Sender,
  ): Promise<void> {
    const brainRescue =
      envelope !== null && envelope.amount !== null && envelope.amount > 0 ? envelope.amount : null;
    const amount = normalizeAmountString(body) ?? parseAmount(body) ?? brainRescue;

    if (amount === null) {
      await send(
        {
          intent: "register_expense",
          ok: false,
          action: "asked_registration",
          amount: null,
          category: null,
          note: body,
          asked_field: "amount",
        },
        keptCollectingReply("amount"),
      );
      return;
    }

    if (payload.category !== null) {
      // Complete: register from the stored context (shared/planned/override
      // come from the payload, never the resolve envelope).
      await this.registerWithCategory(payload.body, amount, payload.note, payload.category, ownerId, payload.shared, payload.planned, payload.override, send);
      return;
    }

    // Keep collecting: persist the amount and ask the category.
    const updated: RegistrationCollectPayload = { ...payload, amount };
    await this.deps.botStateRepository.set({
      ownerId,
      state: AWAITING_REGISTRATION,
      pendingMovementId: null,
      pendingNote: JSON.stringify(updated),
    });
    await send(
      {
        intent: "register_expense",
        ok: false,
        action: "asked_registration",
        amount,
        category: null,
        note: payload.note,
        asked_field: "category",
      },
      askCategoryReply(payload.note),
    );
  }

  /**
   * T5: the category is open. The category cascade resolves the answer
   * (envelope category in resolve mode, raw body in D6 mode) against the
   * persisted payload; the registration completes from the STORED context.
   *
   * Cascade order (design "Deterministic Resolver Authority"): abandon words →
   * exact normalized match → folded plural match → `CATEGORY_AFFIRM_ANSWERS`
   * (stay open, re-ask) → `parseAmountAndNote(body) !== null` (D6 rule 2:
   * abandon the collect and reprocess as a new registration) → single-token
   * guarded `createCategory` (reserved reject → stay open with redirect) →
   * multi-word → `categoryNotFoundReply` list, stay open. Never dead-ends,
   * never auto-creates nonsense.
   */
  private async resolveRegistrationCategory(
    payload: RegistrationCollectPayload,
    envelope: ConversationEnvelope | null,
    body: string,
    ownerId: string,
    send: Sender,
    reply?: ReplyPort,
  ): Promise<void> {
    const categories = await this.deps.categoryService.listCategories(ownerId);
    // The candidate answer: the envelope category in resolve mode, the raw
    // body in D6 mode (the brain is null/absent in that path).
    const answer = envelope?.category?.trim() ?? body.trim();
    const normalizedAnswer = normalizeForMatch(answer);
    const trimmed = answer;

    // Abandon words: an explicit out clears the collect, nothing registers.
    if (COLLECT_ABANDON_ANSWERS.has(normalizeForMatchGuard(answer))) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        collectAbandonedReply(),
      );
      return;
    }

    // T5 rule 1: exact normalized match on an existing category → ANSWER.
    const exactCategory = categories.find((category) => normalizeForMatch(category.name) === normalizedAnswer);
    if (exactCategory !== undefined) {
      await this.registerWithCategory(payload.body, payload.amount as number, payload.note, exactCategory.name, ownerId, payload.shared, payload.planned, payload.override, send);
      return;
    }

    // T5 rule 1 (folded): a plural variant of an existing category is the
    // ANSWER, never a new category ("cafes" resolves to "Cafe").
    const foldedCategory = categories.find(
      (category) => normalizeForMatchTolerant(category.name) === normalizeForMatchTolerant(answer),
    );
    if (foldedCategory !== undefined) {
      await this.registerWithCategory(payload.body, payload.amount as number, payload.note, foldedCategory.name, ownerId, payload.shared, payload.planned, payload.override, send);
      return;
    }

    // An affirmation to the collect question keeps the dialog open and
    // re-asks — never auto-creates a category named "si" (T9).
    if (CATEGORY_AFFIRM_ANSWERS.has(normalizeForMatchGuard(answer))) {
      await send(
        {
          intent: "register_expense",
          ok: false,
          action: "asked_registration",
          amount: payload.amount,
          category: null,
          note: payload.note,
          asked_field: "category",
        },
        keptCollectingReply("category"),
      );
      return;
    }

    // T5 rule 2 (D6 verbatim): parses as amount → NEW registration; the
    // pending collect is abandoned and the message reprocessed normally.
    if (parseAmountAndNote(body) !== null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await send(
        { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
        collectAbandonedReply(),
      );
      await this.handleRegistration(body, ownerId, payload.shared, payload.planned, payload.override, reply);
      return;
    }

    // T5 rule 3: a single token → ANSWER + auto-create, routed through the
    // guarded choke point. A reserved reject keeps the collect open with a
    // redirect.
    if (trimmed.split(/\s+/).length === 1) {
      // Single-token guard reject: a token that guard-normalizes to a guard
      // word routes to the collect abandon / affirmation re-ask; a
      // punctuation-only token is a non-answer that lists the categories.
      const guarded = normalizeForMatchGuard(trimmed);
      if (COLLECT_ABANDON_ANSWERS.has(guarded)) {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await send(
          { intent: "register_expense", ok: false, action: "none", amount: null, category: null, note: body },
          collectAbandonedReply(),
        );
        return;
      }
      if (CATEGORY_AFFIRM_ANSWERS.has(guarded)) {
        await send(
          {
            intent: "register_expense",
            ok: false,
            action: "asked_registration",
            amount: payload.amount,
            category: null,
            note: payload.note,
            asked_field: "category",
          },
          keptCollectingReply("category"),
        );
        return;
      }
      if (guarded.length === 0) {
        await send(
          {
            intent: "register_expense",
            ok: false,
            action: "asked_registration",
            amount: payload.amount,
            category: null,
            note: trimmed,
            asked_field: "category",
          },
          categoryNotFoundReply(trimmed, categories.map((category) => category.name)),
        );
        return;
      }
      // D9 — the single-token free-text auto-create is REMOVED from the
      // collect cascade too: a non-match renders the closed-set buttons and
      // stays open (spec registration-collection "Single-token non-match
      // shows buttons and never auto-creates").
      await this.renderCollectCategoryButtons(ownerId, payload, send, reply);
      return;
    }

    // A multi-word non-category answer → DO NOT dead-end: present the existing
    // categories as buttons, keeping the collect open.
    await this.renderCollectCategoryButtons(ownerId, payload, send, reply);
  }

  private async answerCorrection(
    state: BotStateRecord,
    category: string,
    ownerId: string,
    send: Sender,
    reply?: ReplyPort,
  ): Promise<void> {
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
private async handleDialogMessage(
    state: BotStateRecord,
    body: string,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    // An affirmation ("si", "dale") to the correction offer keeps the dialog
    // open and asks for the target category. Intercepted BEFORE the brain: a
    // bare "si" must never be routed as off_topic nor auto-create a category.
    // The registration-collect dialog gets the same interception: a bare
    // "dale" must never be classified register_expense(amount:null) and
    // destroy the collect via abandon+re-enter (design "Pre-brain
    // interception" :855-861).
    if (state.state === AWAITING_CATEGORY && CATEGORY_AFFIRM_ANSWERS.has(normalizeForMatchGuard(body.trim()))) {
      await this.safeReply(reply, categoryFollowUpReply());
      return;
    }
    if (state.state === AWAITING_REGISTRATION && CATEGORY_AFFIRM_ANSWERS.has(normalizeForMatchGuard(body.trim()))) {
      const payload = this.decodeCollectPayload(state.pendingNote);
      if (payload !== null) {
        const openField = payload.amount === null ? "amount" : "category";
        await this.safeReply(reply, keptCollectingReply(openField));
        return;
      }
      // A corrupt payload cannot be intercepted: fall through so the D6
      // fallback owns it (T10).
    }

    const context = this.buildInterpretContext(state);
    if (context === null) {
      // A corrupt amount-confirmation payload cannot be contextualized: today's
      // deterministic rules own the message.
      await this.d6DialogFallback(state, body, ownerId, shared, planned, override, reply);
      return;
    }

    const envelope = await this.tryBrainInterpret(body, context);
    if (envelope === null || envelope.dialog_action === "abandon") {
      // D1: brain-absent / brain-null / explicit abandon → D6 rules verbatim.
      await this.d6DialogFallback(state, body, ownerId, shared, planned, override, reply);
      return;
    }

    if (envelope.dialog_action === "resolve") {
      // Phantom guard: the acted-on value comes from the message matched against
      // the persisted payload, never from the envelope.
      await this.resolveDialog(state, envelope, body, ownerId, reply);
      return;
    }

    // dialog_action null → shared intent routing; the pending stays untouched.
    await this.routeEnvelopeIntent(envelope, body, ownerId, shared, planned, override, reply, { state });
  }

  /** D1: the single D6 fallback path, dispatching to today's verbatim handlers. */
  private async d6DialogFallback(
    state: BotStateRecord,
    body: string,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    if (state.state === AWAITING_CATEGORY) {
      await this.d6AwaitingCategory(state, body, ownerId, shared, planned, override, reply);
      return;
    }
    if (state.state === AWAITING_REGISTRATION) {
      await this.d6AwaitingRegistration(state, body, ownerId, shared, planned, override, reply);
      return;
    }
    await this.d6AwaitingAmountConfirmation(state, body, ownerId, shared, planned, override, reply);
  }

  /**
   * Reconstructs the `InterpretContext` from the persisted state (design
   * "buildInterpretContext"). A corrupt amount-confirmation payload yields null
   * so the D6 fallback (today's abandon-and-reprocess rules) owns the message.
   */
  private buildInterpretContext(state: BotStateRecord): InterpretContext | null {
    if (state.state === AWAITING_CATEGORY) {
      return {
        state: "awaiting_category",
        pending: { movementId: state.pendingMovementId, note: state.pendingNote },
        openQuestion: `¿Querés asignarle otra categoría al movimiento "${state.pendingNote ?? ""}"? Escribí el nombre o "no".`,
      };
    }
    if (state.state === AWAITING_REGISTRATION) {
      const payload = this.decodeCollectPayload(state.pendingNote);
      if (payload === null) {
        return null;
      }
      const openField = payload.amount === null ? "amount" : "category";
      return {
        state: "awaiting_registration",
        pending: { amount: payload.amount, category: payload.category, note: payload.note },
        openQuestion: openField === "amount" ? askAmountReply(payload.note) : askCategoryReply(payload.note),
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
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
    if (state.state === AWAITING_CATEGORY) {
      await this.resolveAwaitingCategory(state, envelope, ownerId, reply);
      return;
    }
    if (state.state === AWAITING_REGISTRATION) {
      await this.resolveAwaitingRegistration(state, envelope, body, ownerId, reply);
      return;
    }
    await this.resolveAwaitingAmountConfirmation(state, envelope, body, ownerId, reply);
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
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
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
    // Guard normalization folds "no." onto the set (spec "Punctuated guard").
    if (KEEP_OTRO_ANSWERS.has(normalizeForMatchGuard(answer))) {
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
      await this.answerCorrection(state, exactCategory.name, ownerId, send, reply);
      return;
    }

    // Folded answer: a plural variant of an existing category is the ANSWER
    // ("cafes" resolves to "Cafe"), never a new category.
    const foldedCategory = categories.find(
      (category) => normalizeForMatchTolerant(category.name) === normalizeForMatchTolerant(answer),
    );
    if (foldedCategory !== undefined) {
      await this.answerCorrection(state, foldedCategory.name, ownerId, send, reply);
      return;
    }

    // A single token is a new category: auto-create and apply (D6 rule 3),
    // routed through the guarded choke point. A reserved reject keeps the
    // correction open with a redirect.
    if (answer.split(/\s+/).length === 1) {
      // Single-token guard reject: a guard-normalized guard word routes to the
      // matching abandon/affirmation handling; a punctuation-only token lists
      // the categories. Neither reaches category creation.
      const guarded = normalizeForMatchGuard(answer);
      if (KEEP_OTRO_ANSWERS.has(guarded)) {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await send(
          { intent: "correct_category", ok: true, action: "none", amount: null, category: "otro", note: null },
          otroKeptReply(),
        );
        return;
      }
      if (CATEGORY_AFFIRM_ANSWERS.has(guarded)) {
        await this.safeReply(reply, categoryFollowUpReply());
        return;
      }
      if (guarded.length === 0) {
        await send(
          { intent: "correct_category", ok: false, action: "asked_category", amount: null, category: null, note: answer },
          categoryNotFoundReply(answer, categories.map((category) => category.name)),
        );
        return;
      }
      // D9 — the resolve-mode single-token auto-create is REMOVED: a non-match
      // renders the closed-set buttons and the correction stays open (spec
      // conversational-categories "Unknown answer shows buttons").
      await this.renderCategoryButtons(ownerId, state, send, reply);
      return;
    }

    // Multi-word non-category answer → present the category buttons, keep the state open.
    await this.renderCategoryButtons(ownerId, state, send, reply);
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
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
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

    // Register from the STORED context (payload.shared persists the bit, AD6;
    // payload.planned persists the previsto bit, D10; payload.override persists
    // the savings override, D6); a creation failure leaves the question open.
    if (payload.category !== null) {
      await this.registerWithCategory(payload.body, chosen, payload.note, payload.category, ownerId, payload.shared, payload.planned, payload.override, send);
    } else {
      await this.registerOtroWithCorrection(payload.body, chosen, payload.note, ownerId, payload.shared, payload.planned, payload.override, send, reply);
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
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
    dialog?: DialogContext,
  ): Promise<void> {
    switch (envelope.intent) {
      case "query":
      case "query_recent":
      case "query_balance":
      case "query_month":
      case "query_planned":
        await this.executeQuery(envelope, ownerId, reply);
        return;
      case "associate_keyword":
        await this.sendRedirect("associate_keyword", associateKeywordRedirectReply(), reply);
        return;
      case "create_savings_rule":
        // D10: redirect only — the explicit command defines the rule.
        await this.sendRedirect("create_savings_rule", savingsRuleRedirectReply(), reply);
        return;
      case "create_category":
      case "delete_category":
      case "rename_category":
        await this.executeCategoryCommandWithReassign(envelope, ownerId, reply, dialog);
        return;
      case "capabilities":
        await this.sendCapabilities(reply);
        return;
      case "off_topic":
        await this.sendRedirect("off_topic", offTopicRedirectReply(), reply);
        return;
      case "greeting":
        // D4: a warm expense-scoped greeting; the pending is untouched by
        // construction (only register_expense clears it).
        await this.makeSender(true, reply)(
          { intent: "greeting", ok: true, action: "none", amount: null, category: null, note: null },
          greetingReply(),
        );
        return;
      case "help":
      case "correct_amount":
        await this.makeSender(true, reply)(
          { intent: envelope.intent, ok: true, action: "none", amount: null, category: null, note: null },
          helpReply(),
        );
        return;
      case "correct_category":
        await this.runMovementCorrection(envelope, ownerId, reply);
        return;
      case "mark_paid":
      case "delete_expense":
        // Lifecycle intents route to the deterministic executor; they never
        // enter the registration path (spec "Lifecycle intent routes to the
        // executor").
        await this.runMovementLifecycle(envelope, ownerId, reply);
        return;
      case "register_expense":
        if (dialog !== undefined) {
          // A new registration abandons the pending correction/question first.
          await this.deps.botStateRepository.set({
            ownerId,
            state: IDLE,
            pendingMovementId: null,
            pendingNote: null,
          });
          const abandoned =
            dialog.state.state === AWAITING_AMOUNT_CONFIRMATION
              ? amountConfirmationAbandonedReply()
              : dialog.state.state === AWAITING_REGISTRATION
                ? collectAbandonedReply()
                : correctionAbandonedReply();
          // CR-5: ONE merged reply — the abandon template is NOT sent
          // separately; the merged sender prepends it to the registration
          // outcome and passes `abandoned_dialog: true` to the brain reply.
          const base = this.makeSender(true, reply);
          const merged: Sender = async (result, fixed) =>
            base({ ...result, abandoned_dialog: true }, `${abandoned} ${fixed}`);
          await this.executeRegistration(body, parseAmountAndNote(body), envelope, await this.deps.categoryService.listCategories(ownerId), ownerId, shared, planned, override, reply, merged);
          return;
        }
        await this.executeRegistration(body, parseAmountAndNote(body), envelope, await this.deps.categoryService.listCategories(ownerId), ownerId, shared, planned, override, reply);
        return;
    }
  }

  /**
   * Lifecycle intent execution (design "Executor status → reply mapping"): the
   * deterministic `MovementLifecycleExecutor` resolves the reference (category
   * → amount → recency) and the status maps to the reply — brain reply with the
   * executed facts when available, else the fixed template. Cues come from
   * `envelope.category`/`envelope.amount`; `note` is never a cue (D2). An
   * ambiguity ask persists the lifecycle selection payload (D6) and replies
   * fixed-only; a delete resolution (`gated`) persists the confirmation gate
   * with the target id and the `[❌ Cancelar] [🗑 Borrar]` keyboard — nothing
   * is deleted yet (D6, bug #1 fix).
   */
  private async runMovementLifecycle(
    envelope: ConversationEnvelope,
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const intent = envelope.intent === "delete_expense" ? "delete_expense" : "mark_paid";
    const cues: LifecycleCues = { category: envelope.category, amount: envelope.amount };
    const result =
      intent === "mark_paid"
        ? await this.movementLifecycleExecutor.markPaid(ownerId, cues)
        : await this.movementLifecycleExecutor.delete(ownerId, cues);

    switch (result.status) {
      case "ask": {
        const payload: LifecycleSelectionPayload = {
          action: intent,
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
          intent === "mark_paid" ? markPaidAskReply(result.candidates) : deleteAskReply(result.candidates);
        await this.safeReply(reply, fixed);
        return;
      }
      case "gated": {
        // Delete confirmation gate (D6): persist the resolved target and reply
        // with the [❌ Cancelar] [🗑 Borrar] keyboard. Deletion happens ONLY on
        // the 🗑 tap.
        const payload: DeleteConfirmPayload = { target: result.candidate };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_DELETE_CONFIRMATION,
          pendingMovementId: null,
          pendingNote: JSON.stringify(payload),
        });
        await this.safeReply(
          reply,
          deleteConfirmReply(result.candidate.amount, result.candidate.note, result.candidate.category || null),
          [
            [
              { text: "❌ Cancelar", callback_data: buildCallbackData(["dc", "no", result.candidate.id]) },
              { text: "🗑 Borrar", callback_data: buildCallbackData(["dc", "ok", result.candidate.id]) },
            ],
          ],
          undefined,
        );
        return;
      }
      case "nothing_pending":
        await this.safeReply(reply, nothingPendingReply());
        return;
      case "no_match":
        await this.safeReply(reply, nothingToDeleteReply());
        return;
      default:
        await this.sendLifecycleResult(intent, result, reply);
    }
  }

  /**
   * Status → reply mapping shared by the routing path and the selection pick
   * (D5/D8): executed/already_paid go through the brain reply (grounded in the
   * executed facts) with the fixed template as fallback; missing is fixed-only.
   * nothing_pending/no_match/ask are handled by `runMovementLifecycle` before
   * this point and are unreachable from the pick path.
   */
  private async sendLifecycleResult(
    intent: "mark_paid" | "delete_expense",
    result: LifecycleResult,
    reply?: ReplyPort,
  ): Promise<void> {
    switch (result.status) {
      case "executed":
        await this.makeSender(true, reply)(
          {
            intent,
            ok: true,
            action: result.action,
            amount: result.movement.amount,
            category: result.movement.category || null,
            note: result.movement.note,
          },
          intent === "mark_paid"
            ? markPaidReply(result.movement.amount, result.movement.note, result.movement.category || null)
            : deletedMovementReply(result.movement.amount, result.movement.note, result.movement.category || null),
        );
        return;
      case "already_paid":
        await this.makeSender(true, reply)(
          {
            intent,
            ok: false,
            action: "none",
            amount: result.movement.amount,
            category: result.movement.category || null,
            note: result.movement.note,
            message: markPaidAlreadyReply(),
          },
          markPaidAlreadyReply(),
        );
        return;
      case "missing":
        await this.safeReply(reply, movementMissingReply());
        return;
      default:
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
    ownerId: string,
    reply?: ReplyPort,
    dialog?: DialogContext,
  ): Promise<void> {
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
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
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
      case "rejected":
        // Reserved guard redirect: nothing was listed, scored or updated.
        await this.safeReply(reply, reservedCategoryReply(result.name, result.concept));
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
  private async handleMovementSelection(
    state: BotStateRecord,
    body: string,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    reply?: ReplyPort,
  ): Promise<void> {
    // Both sibling payload schemas decode from the same pendingNote (D6): the
    // correction payload (category + candidates) and the lifecycle payload
    // (action + candidates). Old persisted correction payloads keep decoding.
    const payload = this.decodeMovementSelectionPayload(state.pendingNote);
    const lifecycle = this.decodeLifecycleSelectionPayload(state.pendingNote);

    if (lifecycle !== null) {
      await this.handleLifecycleSelection(state, lifecycle, body, ownerId, reply);
      return;
    }

    if (payload === null) {
      // Corrupt or unknown payload: the existing dropped reply + reprocess.
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, questionDroppedReply());
      await this.handleRegistration(body, ownerId, shared, planned, override, reply);
      return;
    }

    const picked = this.pickMovementSelection(body, payload);
    if (picked === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, movementSelectionAbandonedReply());
      await this.handleRegistration(body, ownerId, shared, planned, override, reply);
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

  /**
   * Deterministic pick for an open LIFECYCLE selection question (design D6):
   * the same `pickMovementSelection` resolution (number 1..N / note / amount)
   * executes `markPaidById` or opens the delete GATE for the picked candidate
   * and replies ONCE with the status mapping. A non-answer abandons the
   * question WITHOUT reprocessing — a pick attempt is never a registration
   * (the lifecycle flow creates nothing). A delete pick still requires the 🗑
   * tap: the gate opens with the picked target (D6/D10).
   */
  private async handleLifecycleSelection(
    state: BotStateRecord,
    payload: LifecycleSelectionPayload,
    body: string,
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
    void state;
    const picked = this.pickMovementSelection(body, payload);
    if (picked === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, movementSelectionAbandonedReply());
      return;
    }
    // The payload persists {id, amount, note, date} only — the category is not
    // carried, so the by-id reply renders it as absent.
    const candidate = { ...picked, category: "", occurredAtMs: 0 };
    if (payload.action === "delete_expense") {
      // The pick resolves the delete target; the confirmation gate opens with
      // it (nothing is deleted yet — spec bot-expense-lifecycle).
      const gatePayload: DeleteConfirmPayload = { target: candidate };
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_DELETE_CONFIRMATION,
        pendingMovementId: null,
        pendingNote: JSON.stringify(gatePayload),
      });
      await this.safeReply(
        reply,
        deleteConfirmReply(candidate.amount, candidate.note, null),
        [
          [
            { text: "❌ Cancelar", callback_data: buildCallbackData(["dc", "no", candidate.id]) },
            { text: "🗑 Borrar", callback_data: buildCallbackData(["dc", "ok", candidate.id]) },
          ],
        ],
        undefined,
      );
      return;
    }
    const result = await this.movementLifecycleExecutor.markPaidById(ownerId, candidate);
    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    await this.sendLifecycleResult(payload.action, result, reply);
  }

  /** Pure pick resolution: number 1..N, then note, then unique amount (design D4). */
  private pickMovementSelection(body: string, payload: { candidates: MovementSelectionPayload["candidates"] }): MovementSelectionPayload["candidates"][number] | null {
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

  private decodeLifecycleSelectionPayload(pendingNote: string | null): LifecycleSelectionPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = lifecycleSelectionPayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async handleCommand(command: TelegramCommand, ownerId: string, reply?: ReplyPort): Promise<void> {
    switch (command.type) {
      case "register": {
        try {
          await this.deps.categoryService.createCategory(ownerId, command.name);
        } catch (error) {
          if (error instanceof ReservedCategoryError) {
            await this.safeReply(reply, reservedCategoryReply(command.name, error.concept));
            return;
          }
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
          if (error instanceof ReservedCategoryError) {
            await this.safeReply(reply, reservedCategoryReply(command.to, error.concept));
            return;
          }
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

      case "menu":
      case "start": {
        // D8 — the five-button main menu (one per row). Reopening never
        // changes state (spec bot-main-menu "Menu reopens without side effects").
        // /start is the Telegram entry point: show the same menu so the first
        // thing a new user sees are the action buttons.
        await this.safeReply(
          reply,
          menuReply(),
          [
            [{ text: "Nuevo gasto", callback_data: buildCallbackData(["m", "new"]) }],
            [{ text: "Gasto previsto", callback_data: buildCallbackData(["m", "prev"]) }],
            [{ text: "Borrar", callback_data: buildCallbackData(["m", "del"]) }],
            [{ text: "Reporte", callback_data: buildCallbackData(["m", "rep"]) }],
            [{ text: "Ayuda", callback_data: buildCallbackData(["m", "help"]) }],
          ],
          undefined,
        );
        return;
      }

      case "ayuda": {
        // D12 — static help, works with GROQ_API_KEY unset.
        await this.safeReply(reply, ayudaReply());
        return;
      }

      case "configurar": {
        // The question lists the owner's existing categories (dynamic listing,
        // never fixed text — spec "Setup question lists existing categories").
        const existing = await this.deps.categoryService.listCategories(ownerId);
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_SETUP,
          pendingMovementId: null,
          pendingNote: null,
        });
        await this.safeReply(reply, setupQuestionReply(existing.map((category) => category.name)));
        return;
      }

      case "savings-rule": {
        try {
          await this.deps.savingsService.defineRule(ownerId, command.keyword, command.percent);
        } catch (error) {
          if (error instanceof ValidationFailedError) {
            await this.safeReply(reply, savingsRuleInvalidReply());
            return;
          }
          throw error;
        }
        await this.safeReply(reply, savingsRuleDefinedReply(command.keyword, command.percent));
        return;
      }

      case "savings-rule-invalid": {
        // D10: a recognized command with an out-of-range percent is rejected
        // and nothing is stored.
        await this.safeReply(reply, savingsRuleInvalidReply());
        return;
      }
    }
  }

  /** D5: createMovement gains an explicit type — the tail classifies ONCE. */
  private async createMovement(
    body: string,
    amount: number,
    note: string | null,
    category: string,
    ownerId: string,
    visibility: "INDIVIDUAL" | "SHARED",
    type: "EXPENSE" | "INCOME" | "SAVINGS",
    status?: "PENDING" | "PAID",
  ): Promise<{ id: string } | null> {
    try {
      return await this.deps.expenseService.createExpense(
        {
          amount,
          currency: "ARS",
          note,
          occurredAt: new Date(),
          type,
          category,
          ...(status === undefined ? {} : { status }),
        },
        ownerId,
        { visibility },
      );
    } catch (error) {
      this.deps.logger?.(`Telegram: failed to create movement: ${String(error)}`);
      return null;
    }
  }

  /**
   * Shared tail: register with a resolved category, confirm, go idle. D5 — the
   * movement type is classified ONCE; an INCOME with a matching savings rule
   * (or an override) splits into net INCOME + SAVINGS in one transaction.
   * D10 — a planned registration is forced EXPENSE + PENDING and never splits.
   */
  private async registerWithCategory(
    body: string,
    amount: number,
    note: string | null,
    category: string,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    send: Sender,
  ): Promise<boolean> {
    const type = planned ? "EXPENSE" : classifyMovementType(body);
    if (!planned && type === "INCOME") {
      const split = await this.deps.savingsService.resolveSplit(ownerId, note ?? body, override);
      if (split.kind === "split") {
        return this.registerIncomeSplit(body, amount, note, ownerId, shared, split.percent, send);
      }
    }
    // Safety net: a PENDING row must NEVER persist SHARED — even if a future
    // path leaks a shared flag onto a planned registration, INDIVIDUAL wins.
    const movement = await this.createMovement(body, amount, note, category, ownerId, shared && !planned ? "SHARED" : "INDIVIDUAL", type, planned ? "PENDING" : undefined);
    if (movement === null) {
      return false;
    }
    await this.deps.botStateRepository.set({
      ownerId,
      state: IDLE,
      pendingMovementId: null,
      pendingNote: null,
    });
    await send(
      {
        intent: "register_expense",
        ok: true,
        action: "registered",
        amount,
        category,
        note,
        ...(planned ? { planned: true } : {}),
      },
      planned ? plannedReply(amount, note, category) : successReply(amount, note, category),
    );
    return true;
  }

  /**
   * Shared tail: register in "otro", offer the category correction. D5 — same
   * single classification and split as the with-category tail.
   */
  private async registerOtroWithCorrection(
    body: string,
    amount: number,
    note: string | null,
    ownerId: string,
    shared: boolean,
    planned: boolean,
    override: SavingsOverride,
    send: Sender,
    reply?: ReplyPort,
  ): Promise<boolean> {
    const type = planned ? "EXPENSE" : classifyMovementType(body);
    if (!planned && type === "INCOME") {
      const split = await this.deps.savingsService.resolveSplit(ownerId, note ?? body, override);
      if (split.kind === "split") {
        return this.registerIncomeSplit(body, amount, note, ownerId, shared, split.percent, send);
      }
    }
    await this.deps.categoryService.ensureOtro(ownerId);
    // Safety net: a PENDING row must NEVER persist SHARED — even if a future
    // path leaks a shared flag onto a planned registration, INDIVIDUAL wins.
    const movement = await this.createMovement(body, amount, note, "otro", ownerId, shared && !planned ? "SHARED" : "INDIVIDUAL", type, planned ? "PENDING" : undefined);
    if (movement === null) {
      return false;
    }
    // The movement keeps the parsed note; the pending correction remembers the
    // whole body when no note was parsed (today's behavior).
    const displayNote = note ?? body;
    await this.deps.botStateRepository.set({
      ownerId,
      state: AWAITING_CATEGORY,
      pendingMovementId: movement.id,
      pendingNote: displayNote,
    });
    // The movement is already registered in "otro"; the reassignment is optional.
    // Hybrid UX: the category question ships WITH the closed-set buttons so the
    // owner taps instead of typing (spec bot-inline-interactions "category pick").
    const fixed = planned
      ? `${plannedReply(amount, displayNote, "otro")} ¿Querés asignarle otra categoría? Elegí una:`
      : correctionOfferReply(amount, displayNote, "otro");
    await send(
      {
        intent: "register_expense",
        ok: true,
        action: "asked_category",
        amount,
        category: "otro",
        note: displayNote,
        ...(planned ? { planned: true } : {}),
      },
      fixed,
    );
    if (reply !== undefined) {
      await this.safeReply(reply, categoryButtonsReply(), await this.categoryKeyboard(ownerId, 0), undefined);
    }
    return true;
  }

  /**
   * D5/D7 — the savings split tail: ensure the SAVINGS "ahorro" category and
   * persist net INCOME + SAVINGS in ONE transaction; the reply carries the
   * executed gross/net/savings facts.
   */
  private async registerIncomeSplit(
    body: string,
    gross: number,
    note: string | null,
    ownerId: string,
    shared: boolean,
    percent: number,
    send: Sender,
  ): Promise<boolean> {
    await this.deps.categoryService.ensureAhorro(ownerId);
    const visibility = shared ? "SHARED" : "INDIVIDUAL";
    const result = await this.deps.expenseService.createIncomeWithSavings({
      ownerId,
      gross,
      percent,
      note,
      occurredAt: new Date(),
      category: "ahorro",
      visibility,
    });
    if (result.net === null && result.savings === null) {
      return false;
    }
    const net = result.net?.amount ?? null;
    const savings = result.savings?.amount ?? null;
    await this.deps.botStateRepository.set({
      ownerId,
      state: IDLE,
      pendingMovementId: null,
      pendingNote: null,
    });
    await send(
      {
        intent: "register_expense",
        ok: true,
        action: "registered",
        amount: net ?? savings,
        category: "ahorro",
        note,
        gross_amount: gross,
        net_amount: net,
        savings_amount: savings,
      },
      successSplitReply(gross, net ?? 0, savings ?? 0),
    );
    return true;
  }

  /**
   * Viewer scope for bot movement reads (queries): the member is the viewer and
   * the household answers the partner lookup, so SHARED movements from the
   * partner are visible under the same predicate the dashboard uses.
   */
  private scopeFor(ownerId: string): ViewerScope {
    return { viewerId: ownerId, partnerId: this.deps.household.partnerOf(ownerId), visibility: "all" };
  }

  private async safeReply(
    reply: ReplyPort | undefined,
    text: string,
    keyboard?: InlineKeyboard,
    editMessageId?: number,
  ): Promise<void> {
    if (reply === undefined) {
      return;
    }
    try {
      await reply(text, keyboard, editMessageId);
    } catch (error) {
      this.deps.logger?.(`Telegram: reply failed: ${String(error)}`);
    }
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