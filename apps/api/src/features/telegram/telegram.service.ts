import { z } from "zod";
import type { CategoryService } from "../categories/categories.service";
import { normalizeForMatch } from "../categories/matcher";
import { ReservedCategoryError } from "../categories/reserved";
import type { ExpenseService } from "../expenses/expenses.service";
import type { HouseholdService } from "../household/household.service";
import type { ViewerScope } from "../movements/movements.types";
import type { SavingsRuleService } from "../savings/savings.service";
import { isUniqueConstraintViolation, type ProcessedMessageRepository } from "../messages/message.repository";
import { NotFoundError, SavingsForbiddenError, ValidationFailedError } from "../../infra/errors";
import type { MovementService } from "../movements/movements.service";
import { BOT_STATES, type BotStateRepository } from "./bot-state.repository";
import { type BotBrain, type ConversationEnvelope, type ExecutionResult } from "./bot-brain";
import { MovementLifecycleExecutor } from "./movement-lifecycle-executor";
import { MovementCorrector } from "./movement-corrector";
import { QueryExecutor } from "./query-executor";
import { deriveQueryType, type QueryExecutionResult, type QueryType } from "./query.types";
import { parseCommand, parseLegacyCategoryCrud, parseSetupBatchCommand, type TelegramCommand } from "./telegram.commands";
import {
  normalizeTelegramMessage,
  normalizeTelegramCallback,
  captureParse,
  legacyPrefixKind,
  buildCallbackData,
  type InlineButton,
  type InlineKeyboard,
  type TelegramCallback,
} from "./telegram.parser";
import {
  alreadyProcessedReply,
  ayudaReply,
  callbackUnavailableReply,
  capturePromptReply,
  captureShapedRedirectReply,
  categoryAdminReply,
  categoryCrudRedirectReply,
  categoryDeleteConfirmReply,
  categoryDeletePickReply,
  categoryGoneReply,
  categoryListReply,
  categoryNamePromptReply,
  categoryRenamePickReply,
  compartidoPrefixRedirectReply,
  correctionEmptyReply,
  correctionPickListReply,
  deleteCancelledReply,
  deleteConfirmReply,
  deletePickListReply,
  deletedMovementReply,
  duplicateCategoryReply,
  expenseAdminReply,
  greetingReply,
  markPaidAlreadyReply,
  markPaidAskReply,
  markPaidReply,
  menuReply,
  movementCorrectionDoneReply,
  movementMissingReply,
  nothingPendingReply,
  nothingToDeleteReply,
  formatARS,
  plannedReply,
  previewAskCategoryReply,
  previewReply,
  previstoPrefixRedirectReply,
  queryRedirectReply,
  queryReplyTemplate,
  questionDroppedReply,
  reassignCategoryReply,
  reportsMenuReply,
  reservedCategoryReply,
  savingsOverrideRedirectReply,
  savingsRuleDefinedReply,
  savingsRuleInvalidReply,
  selectionAbandonedReply,
  setupBatchDoneReply,
  setupQuestionReply,
  setupRetryReply,
  successReply,
  successSplitReply,
  unresolvableReply,
  categoryCreatedReply,
  categoryDeletedReply,
  categoryRenamedReply,
  missingCategoryReply,
  otroDeleteForbiddenReply,
  savingsForbiddenReply,
} from "./reply-text";

/**
 * D2 — injectable reply port: sends a text message back to the sender chat,
 * optionally with an inline keyboard, and edits an existing message when
 * `editMessageId` is present. Keyboards are plain DTOs (never grammy types).
 */
export type ReplyPort = (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>;

/** Brain-written branch sender: sends the LLM reply when active, else the fixed template. */
export type Sender = (result: ExecutionResult, fixed: string) => Promise<void>;

export type TelegramServiceDeps = {
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  movementService: MovementService;
  categoryService: CategoryService;
  savingsService: SavingsRuleService;
  botStateRepository: BotStateRepository;
  household: HouseholdService;
  logger?: (message: string) => void;
  /** Optional LLM brain; when absent the bot runs deterministic-only. */
  brain?: BotBrain;
};

const IDLE = "idle";
const AWAITING_SETUP = "awaiting_setup";
const AWAITING_CAPTURE = "awaiting_capture";
const AWAITING_PREVIEW = "awaiting_preview";
const AWAITING_CATEGORY_NAME = "awaiting_category_name";
const AWAITING_MOVEMENT_SELECTION = "awaiting_movement_selection";
const AWAITING_CATEGORY_SELECTION = "awaiting_category_selection";
const AWAITING_DELETE_CONFIRMATION = "awaiting_delete_confirmation";

/** v2 capture types — chosen ONLY by the main-menu tap (spec quick-capture "Type Selection by Menu"). */
export type CaptureType = "REAL" | "PENDING" | "INGRESO" | "COMPARTIDO";

/** D4 — random 8-hex save token gating the preview Guardar callback (idempotency). */
function newSaveToken(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Stored payload of `awaiting_capture` (design D1): the capture type chosen by
 * the menu tap. Lives in `BotState.pendingNote` so it survives restarts.
 */
export const capturePayloadSchema = z.object({
  type: z.enum(["REAL", "PENDING", "INGRESO", "COMPARTIDO"]),
});

export type CapturePayload = z.infer<typeof capturePayloadSchema>;

/**
 * Stored payload of `awaiting_preview` (spec quick-capture "Capture Preview
 * with Save/Correct"): the parsed facts, the menu-chosen type, the
 * button-chosen category (null until a `cat:<id>` pick) and the saveToken
 * gating Guardar idempotency. Lives in `pendingNote` — no Prisma migration.
 */
export const previewPayloadSchema = z.object({
  amount: z.number().positive(),
  note: z.string().nullable(),
  type: z.enum(["REAL", "PENDING", "INGRESO", "COMPARTIDO"]),
  category: z.string().min(1).nullable(),
  saveToken: z.string().regex(/^[0-9a-f]{8}$/),
});

export type PreviewPayload = z.infer<typeof previewPayloadSchema>;

/**
 * Stored payload of `awaiting_category_name` (design D5): one state, three
 * flows — `preview` (➕ from the capture preview), `admin_create` and
 * `admin_rename` (Phase 6 category admin). The preview flow carries the open
 * preview payload so a created category returns to the preview selected.
 */
export const categoryNamePayloadSchema = z.object({
  flow: z.enum(["preview", "admin_create", "admin_rename"]),
  preview: previewPayloadSchema.optional(),
  categoryId: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
});

export type CategoryNamePayload = z.infer<typeof categoryNamePayloadSchema>;

/**
 * Stored payload of an open movement-lifecycle pick (design D6): the action
 * discriminates the pick family (delete reuses the existing `dk` gate flow in
 * Phase 6; mark-paid and correction land with the sub-menus). A SIBLING schema
 * (not a discriminated union) so old persisted delete payloads keep decoding.
 */
export const lifecycleSelectionPayloadSchema = z.object({
  action: z.enum(["mark_paid", "delete_expense", "correct_category"]),
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
 * Stored payload of `awaiting_category_selection` (design D6): the movement
 * picked for a correction reassign (`mc:<id>` pick). The `cc:<catId>` callback
 * reassigns this movement to the picked category via `updateMovement`.
 */
export const categorySelectionPayloadSchema = z.object({
  movement: z.object({
    id: z.string().min(1),
    amount: z.number().positive(),
    note: z.string().nullable(),
    date: z.string().min(1),
  }),
});

export type CategorySelectionPayload = z.infer<typeof categorySelectionPayloadSchema>;

/**
 * Stored payload of an open delete-confirmation gate
 * (`awaiting_delete_confirmation`, unchanged from v1). Lives in `pendingNote`
 * so it survives restarts. The persisted `target` is the ONLY movement a
 * `dc:ok` callback may delete (spec bot-expense-lifecycle, bug #1 fix).
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

export class TelegramService {
  private readonly queryExecutor: QueryExecutor;
  private readonly movementLifecycleExecutor: MovementLifecycleExecutor;
  private readonly movementCorrector: MovementCorrector;

  constructor(private readonly deps: TelegramServiceDeps) {
    this.queryExecutor = new QueryExecutor(deps.movementService, deps.categoryService);
    this.movementLifecycleExecutor = new MovementLifecycleExecutor({
      movementService: deps.movementService,
      expenseService: deps.expenseService,
    });
    this.movementCorrector = new MovementCorrector(deps.movementService);
  }

  /**
   * v2 message entry (spec telegram-bot "Per-Owner State Machine"): commands
   * first, then a per-owner state-machine dispatch. Removed/corrupt persisted
   * states recover to `idle` with the message consumed (nothing registers,
   * nothing deletes). Free text NEVER starts capture: the capture chain opens
   * only from a menu tap (`awaiting_capture`), and idle text routes through
   * `routeIdleMessage` (bot-free-text-routing).
   */
  async handleUpdate(update: unknown, reply?: ReplyPort): Promise<void> {
    const message = normalizeTelegramMessage(update);
    if (message === null) {
      return;
    }

    // Order: resolve → gate → record (spec "Message Deduplication").
    const ownerId = this.deps.household.resolveOwnerByChatId(message.fromId);
    if (ownerId === null) {
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

    // Commands are checked before state consumption in every state.
    const command = parseCommand(body);
    if (command !== null) {
      await this.handleCommand(command, ownerId, reply);
      return;
    }

    const state = await this.deps.botStateRepository.get(ownerId);
    const stateName = state?.state ?? IDLE;

    // 3.5 — normalizeState: a corrupt or REMOVED state (incl. rollback
    // leftovers of awaiting_category / awaiting_registration /
    // awaiting_amount_confirmation) recovers to idle; the message is CONSUMED
    // — nothing registers, nothing deletes, no reprocessing (spec telegram-bot
    // "Removed dialog payload recovers to idle").
    if (this.normalizeState(stateName) !== stateName) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, questionDroppedReply());
      return;
    }

    switch (stateName) {
      case AWAITING_SETUP:
        await this.handleSetupReply(body, ownerId, reply);
        return;
      case AWAITING_CAPTURE:
        await this.handleAwaitingCaptureMessage(body, ownerId, reply);
        return;
      case AWAITING_PREVIEW:
      case AWAITING_CATEGORY_SELECTION:
        // Any non-command text during a preview (or a correction pick in Phase
        // 6) abandons it: idle, then idle-route the text — never capture from
        // this path (design state-machine transitions).
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.routeIdleMessage(body, ownerId, reply);
        return;
      case AWAITING_CATEGORY_NAME:
        await this.handleAwaitingCategoryName(body, ownerId, reply);
        return;
      case AWAITING_MOVEMENT_SELECTION:
        // A non-command text during a pick abandons it: nothing changes, the
        // menu returns (spec movement-correction "Ambiguity Resolution").
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(reply, selectionAbandonedReply());
        await this.sendMenu(reply);
        return;
      case AWAITING_DELETE_CONFIRMATION:
        // Any new message abandons the delete gate: idle, nothing deleted,
        // then the text idle-routes (spec "Cancelar abandons without deleting").
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.routeIdleMessage(body, ownerId, reply);
        return;
      default:
        await this.routeIdleMessage(body, ownerId, reply);
    }
  }

  /**
   * D4 — callback channel: processes a `callback_query` update and dispatches
   * on the stable action prefix in `data` (bot-inline-interactions "Callback
   * Query Routing"). Returns true when the callback was processed (the caller
   * MUST `answerCallbackQuery`), false when ignored (unknown chat / non-string
   * data — nothing executes, no reply). An unknown action prefix replies
   * honestly ("acción no disponible") and changes no state.
   */
  async handleCallback(update: unknown, reply?: ReplyPort): Promise<boolean> {
    const callback = normalizeTelegramCallback(update);
    if (callback === null) {
      return false;
    }

    const ownerId = this.deps.household.resolveOwnerByChatId(callback.fromId);
    if (ownerId === null) {
      this.deps.logger?.(`Telegram: ignoring callback ${callback.data} from an unknown chat`);
      return false;
    }

    await this.dispatchCallback(callback, ownerId, reply);
    return true;
  }

  /** D4 — action-prefix dispatch (see the v2 callback_data scheme in the design). */
  private async dispatchCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [action] = callback.data.split(":");

    switch (action) {
      case "m":
        await this.handleMenuCallback(callback, ownerId, reply);
        return;
      case "pv":
        await this.handlePreviewCallback(callback, ownerId, reply);
        return;
      case "cat":
      case "cp":
        await this.handleCategoryPickCallback(callback, ownerId, reply);
        return;
      case "dc":
        await this.handleDeleteGateCallback(callback, ownerId, reply);
        return;
      case "dk":
        await this.handleDeletePickCallback(callback, ownerId, reply);
        return;
      case "am":
        await this.handleAdminExpenseCallback(callback, ownerId, reply);
        return;
      case "ac":
        await this.handleAdminCategoryCallback(callback, ownerId, reply);
        return;
      case "rep":
        await this.handleReportsCallback(callback, ownerId, reply);
        return;
      case "mc":
        await this.handleCorrectionPickCallback(callback, ownerId, reply);
        return;
      case "mp":
        await this.handleMarkPaidPickCallback(callback, ownerId, reply);
        return;
      case "cc":
        await this.handleReassignCallback(callback, ownerId, reply);
        return;
      default:
        // Unknown action prefix: honest reply, no state change (spec
        // "Unknown action replied honestly").
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /**
   * v2 menu callbacks (m:new/m:prev/m:inc/m:shr type taps, m:adm/m:cats/m:rep
   * sub-menu entries, m:help). A menu tap in ANY state abandons the pending
   * flow and starts fresh (spec bot-main-menu "Menu tap supersedes a pending
   * preview"); the type taps persist the capture type via `startCapture`.
   */
  private async handleMenuCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, sub] = callback.data.split(":");
    switch (sub) {
      case "new":
        await this.startCapture("REAL", ownerId, reply);
        return;
      case "prev":
        await this.startCapture("PENDING", ownerId, reply);
        return;
      case "inc":
        await this.startCapture("INGRESO", ownerId, reply);
        return;
      case "shr":
        await this.startCapture("COMPARTIDO", ownerId, reply);
        return;
      case "adm": {
        // Supersede any pending flow, then open the expense-admin sub-menu
        // (its action handlers land in Phase 6).
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(
          reply,
          expenseAdminReply(),
          [
            [{ text: "🗑 Borrar gasto", callback_data: buildCallbackData(["am", "del"]) }],
            [{ text: "✏️ Corregir categoría", callback_data: buildCallbackData(["am", "cor"]) }],
            [{ text: "💵 Marcar como pagado", callback_data: buildCallbackData(["am", "pay"]) }],
          ],
          undefined,
        );
        return;
      }
      case "cats": {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(
          reply,
          categoryAdminReply(),
          [
            [{ text: "➕ Crear categoría", callback_data: buildCallbackData(["ac", "new"]) }],
            [{ text: "✏️ Renombrar categoría", callback_data: buildCallbackData(["ac", "ren"]) }],
            [{ text: "🗑 Borrar categoría", callback_data: buildCallbackData(["ac", "del"]) }],
          ],
          undefined,
        );
        return;
      }
      case "rep": {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(
          reply,
          reportsMenuReply(),
          [
            [{ text: "Últimos movimientos", callback_data: buildCallbackData(["rep", "recent"]) }],
            [{ text: "Saldo", callback_data: buildCallbackData(["rep", "balance"]) }],
            [{ text: "Resumen del mes", callback_data: buildCallbackData(["rep", "month"]) }],
            [{ text: "Ahorro del mes", callback_data: buildCallbackData(["rep", "savings"]) }],
            [{ text: "Gastos previstos", callback_data: buildCallbackData(["rep", "planned"]) }],
          ],
          undefined,
        );
        return;
      }
      case "help":
        // Ayuda: static help, zero LLM calls (spec "Ayuda replies offline").
        await this.safeReply(reply, ayudaReply());
        return;
      default:
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /**
   * The eight-button main menu (spec bot-main-menu "Main Menu Actions").
   * Rendered after a completed action so the owner is invited to continue
   * (the action "returns to" the menu instead of ending dead).
   */
  private async sendMenu(reply?: ReplyPort): Promise<void> {
    await this.safeReply(
      reply,
      menuReply(),
      [
        [{ text: "➕ Nuevo gasto", callback_data: buildCallbackData(["m", "new"]) }],
        [{ text: "📅 Gasto previsto", callback_data: buildCallbackData(["m", "prev"]) }],
        [{ text: "➕ Ingreso", callback_data: buildCallbackData(["m", "inc"]) }],
        [{ text: "👥 Compartido", callback_data: buildCallbackData(["m", "shr"]) }],
        [{ text: "🗂 Administrar categorías", callback_data: buildCallbackData(["m", "cats"]) }],
        [{ text: "🧾 Administrar gastos", callback_data: buildCallbackData(["m", "adm"]) }],
        [{ text: "📊 Reportes", callback_data: buildCallbackData(["m", "rep"]) }],
        [{ text: "❓ Ayuda", callback_data: buildCallbackData(["m", "help"]) }],
      ],
      undefined,
    );
  }

  /**
   * Type menu tap → capture: abandons any pending flow, enters
   * `awaiting_capture{type}` and prompts for `monto+nota`. Owners with zero
   * categories go to the setup question instead (spec telegram-bot "Setup
   * Flow"; quick-capture "only owners past setup").
   */
  private async startCapture(type: CaptureType, ownerId: string, reply?: ReplyPort): Promise<void> {
    const categories = await this.deps.categoryService.listCategories(ownerId);
    if (categories.length === 0) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_SETUP,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.safeReply(reply, setupQuestionReply([]));
      return;
    }
    const payload: CapturePayload = { type };
    await this.deps.botStateRepository.set({
      ownerId,
      state: AWAITING_CAPTURE,
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    await this.safeReply(reply, capturePromptReply());
  }

  /**
   * `awaiting_capture` + `monto+nota`: a parsed message enters the preview;
   * no parseable amount re-prompts, keeps the state and registers NOTHING —
   * zero LLM, zero keyword rules (spec telegram-bot "Movement Parsing"; "No
   * amount re-prompts").
   */
  private async handleAwaitingCaptureMessage(body: string, ownerId: string, reply?: ReplyPort): Promise<void> {
    const state = await this.deps.botStateRepository.get(ownerId);
    const payload = this.decodeCapturePayload(state?.pendingNote ?? null);

    // Corrupt capture payload: recover to idle, nothing registers.
    if (state?.state !== AWAITING_CAPTURE || payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, questionDroppedReply());
      return;
    }

    const parsed = captureParse(body);
    if (parsed === null) {
      await this.safeReply(reply, capturePromptReply());
      return;
    }

    await this.enterPreview(parsed.amount, parsed.note, payload.type, ownerId, reply);
  }

  /** Decodes a persisted `awaiting_capture` payload; corrupt JSON yields null. */
  private decodeCapturePayload(pendingNote: string | null): CapturePayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = capturePayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Enters the capture preview: persists `{amount, note, type, category: null,
   * saveToken}` and renders the v2 preview keyboard — 5 NORMAL category
   * buttons per page (no "otro"/"ahorro"), `cp:` navigation when the set
   * exceeds 5, ➕ Crear categoría, and [✅ Guardar] [✏️ Corregir]. The keyboard
   * stays within 8 rows / 64 bytes per callback (spec bot-inline-interactions).
   */
  private async enterPreview(
    amount: number,
    note: string | null,
    type: CaptureType,
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const payload: PreviewPayload = { amount, note, type, category: null, saveToken: newSaveToken() };
    await this.deps.botStateRepository.set({
      ownerId,
      state: AWAITING_PREVIEW,
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    await this.safeReply(reply, previewReply(amount, note, type), await this.previewKeyboard(ownerId, payload, 0), undefined);
  }

  /**
   * The v2 preview keyboard (spec quick-capture "Capture Preview with
   * Save/Correct"; movement-categories "Preview Category Selection"): NORMAL
   * categories only (`type === "NORMAL"` and name ≠ "otro"), 5 per page, with
   * `cp:<page>` navigation, the ➕ create row and the Guardar/Corregir row.
   */
  private async previewKeyboard(ownerId: string, payload: PreviewPayload, page: number): Promise<InlineKeyboard> {
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const normal = categories
      .filter((category) => category.type === "NORMAL" && normalizeForMatch(category.name) !== "otro")
      .sort((a, b) => a.name.localeCompare(b.name));
    const pageSize = 5;
    const pageItems = normal.slice(page * pageSize, page * pageSize + pageSize);
    const rows: InlineButton[][] = pageItems.map((category) => [
      { text: category.name, callback_data: buildCallbackData(["cat", category.id]) },
    ]);
    if (normal.length > pageSize) {
      const totalPages = Math.ceil(normal.length / pageSize);
      rows.push([
        { text: "◀️", callback_data: buildCallbackData(["cp", String(Math.max(0, page - 1))]) },
        { text: `${page + 1}/${totalPages}`, callback_data: buildCallbackData(["cp", String(page)]) },
        { text: "▶️", callback_data: buildCallbackData(["cp", String(Math.min(totalPages - 1, page + 1))]) },
      ]);
    }
    rows.push([{ text: "➕ Crear categoría", callback_data: buildCallbackData(["pv", "catnew", payload.saveToken]) }]);
    rows.push([
      { text: "✅ Guardar", callback_data: buildCallbackData(["pv", "save", payload.saveToken]) },
      { text: "✏️ Corregir", callback_data: buildCallbackData(["pv", "edit", payload.saveToken]) },
    ]);
    return rows;
  }

  /** Decodes a persisted preview payload; corrupt JSON yields null (spec "Corrupt preview payload recovers"). */
  private decodePreviewPayload(pendingNote: string | null): PreviewPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = previewPayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Preview callbacks (pv:save/pv:edit/pv:catnew). The type-toggle row is
   * REMOVED: the type comes from the menu tap and is never changed in the
   * preview (spec quick-capture "Preview has no type toggle").
   */
  private async handlePreviewCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const parts = callback.data.split(":");
    const sub = parts[1];
    const token = parts[2];
    if (token === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const payload = this.decodePreviewPayload(state?.pendingNote ?? null);

    // D5 — state+token gate: a callback whose expected state+token does not
    // match replies "ya procesado" and executes nothing (idempotency).
    if (state?.state !== AWAITING_PREVIEW || payload === null || payload.saveToken !== token) {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    switch (sub) {
      case "save": {
        // Gated Guardar: nothing registers until a category is selected
        // (spec quick-capture "Guardar is gated until a category is chosen").
        if (payload.category === null) {
          await this.safeReply(reply, previewAskCategoryReply());
          return;
        }
        await this.savePreview(payload, ownerId, reply);
        return;
      }
      case "edit": {
        // Corregir: abandon the preview and reopen capture with the SAME type.
        const capture: CapturePayload = { type: payload.type };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_CAPTURE,
          pendingMovementId: null,
          pendingNote: JSON.stringify(capture),
        });
        await this.safeReply(reply, capturePromptReply());
        return;
      }
      case "catnew": {
        // ➕ Crear categoría (spec quick-capture "Create Category from
        // Preview"): enter the name input with the preview flow.
        const namePayload: CategoryNamePayload = { flow: "preview", preview: payload };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_CATEGORY_NAME,
          pendingMovementId: null,
          pendingNote: JSON.stringify(namePayload),
        });
        await this.safeReply(reply, categoryNamePromptReply("preview"));
        return;
      }
      default:
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /**
   * Guardar executes exactly once: the state transitions to idle FIRST (the
   * state IS the consumption record), then the movement registers with the
   * previewed facts and the confirmation + menu tail reply (spec "Guardar
   * registers and returns to menu").
   */
  private async savePreview(payload: PreviewPayload, ownerId: string, reply?: ReplyPort): Promise<void> {
    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    await this.registerCapture(payload.amount, payload.note, payload.type, payload.category as string, ownerId, reply);
  }

  /**
   * v2 category picks: `cat:<id>` selects the category on an open preview
   * (re-render selected via message edit); `cp:<page>` re-renders the preview
   * page without touching state. Reassignment picks (`cc:`) arrive with the
   * Phase 6 correction chain.
   */
  private async handleCategoryPickCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [action, value] = callback.data.split(":");
    const state = await this.deps.botStateRepository.get(ownerId);

    if (action === "cp") {
      const page = Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
      if (state?.state === AWAITING_PREVIEW) {
        const payload = this.decodePreviewPayload(state.pendingNote);
        if (payload === null) {
          await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
          await this.safeReply(reply, questionDroppedReply());
          return;
        }
        await this.safeReply(reply, previewReply(payload.amount, payload.note, payload.type), await this.previewKeyboard(ownerId, payload, page), callback.messageId);
        return;
      }
      if (state?.state === AWAITING_MOVEMENT_SELECTION) {
        const lifecycle = this.decodeLifecycleSelectionPayload(state.pendingNote);
        if (lifecycle === null) {
          await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
          await this.safeReply(reply, questionDroppedReply());
          return;
        }
        await this.renderMovementPickList(ownerId, lifecycle, page, reply);
        return;
      }
      if (state?.state === AWAITING_CATEGORY_SELECTION) {
        const payload = this.decodeCategorySelectionPayload(state.pendingNote);
        if (payload === null) {
          await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
          await this.safeReply(reply, questionDroppedReply());
          return;
        }
        await this.safeReply(reply, reassignCategoryReply(), await this.categoryPickKeyboard(ownerId, "cc", page), undefined);
        return;
      }
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }

    // cat:<id> — resolve the id → name at callback time; a deleted category
    // re-renders the preview without a selection (state stays open).
    const categoryId = value;
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const category = categories.find((candidate) => candidate.id === categoryId);

    if (state?.state === AWAITING_PREVIEW) {
      const payload = this.decodePreviewPayload(state.pendingNote);
      if (payload === null) {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(reply, questionDroppedReply());
        return;
      }
      if (category === undefined) {
        await this.safeReply(reply, previewReply(payload.amount, payload.note, payload.type), await this.previewKeyboard(ownerId, payload, 0), callback.messageId);
        return;
      }
      const updated: PreviewPayload = { ...payload, category: category.name };
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_PREVIEW,
        pendingMovementId: null,
        pendingNote: JSON.stringify(updated),
      });
      await this.safeReply(reply, previewReply(payload.amount, payload.note, payload.type), await this.previewKeyboard(ownerId, updated, 0), callback.messageId);
      return;
    }

    await this.safeReply(reply, callbackUnavailableReply());
  }

  /**
   * `awaiting_category_name` — the preview create flow (spec quick-capture
   * "Create Category from Preview"): the next text creates the category
   * through the guarded `CategoryService.createCategory` and re-renders the
   * preview with it selected; a reserved/duplicate reject re-renders the
   * preview WITHOUT a selection. The admin flows (admin_create/admin_rename)
   * arrive with the Phase 6 category admin.
   */
  private async handleAwaitingCategoryName(body: string, ownerId: string, reply?: ReplyPort): Promise<void> {
    const state = await this.deps.botStateRepository.get(ownerId);
    const payload = this.decodeCategoryNamePayload(state?.pendingNote ?? null);

    if (state?.state !== AWAITING_CATEGORY_NAME || payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, questionDroppedReply());
      return;
    }

    if (payload.flow === "admin_create") {
      try {
        const created = await this.deps.categoryService.createCategory(ownerId, body);
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(reply, categoryCreatedReply(created.name));
        await this.sendMenu(reply);
        return;
      } catch (error) {
        if (error instanceof ReservedCategoryError) {
          await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
          await this.safeReply(reply, reservedCategoryReply(body, error.concept));
          await this.sendMenu(reply);
          return;
        }
        if (error instanceof ValidationFailedError) {
          await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
          await this.safeReply(reply, duplicateCategoryReply(body));
          await this.sendMenu(reply);
          return;
        }
        throw error;
      }
    }

    if (payload.flow === "admin_rename" && payload.categoryId !== undefined) {
      const categories = await this.deps.categoryService.listCategories(ownerId);
      const from = categories.find((candidate) => candidate.id === payload.categoryId);
      if (from === undefined) {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.safeReply(reply, categoryGoneReply());
        await this.sendMenu(reply);
        return;
      }
      try {
        const renamed = await this.deps.categoryService.renameCategory(ownerId, from.name, body);
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        if (renamed === null) {
          await this.safeReply(reply, missingCategoryReply(from.name));
        } else {
          await this.safeReply(reply, categoryRenamedReply(from.name, renamed.name));
        }
        await this.sendMenu(reply);
        return;
      } catch (error) {
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        if (error instanceof ReservedCategoryError) {
          await this.safeReply(reply, reservedCategoryReply(body, error.concept));
        } else if (error instanceof ValidationFailedError) {
          await this.safeReply(reply, duplicateCategoryReply(body));
        } else if (error instanceof SavingsForbiddenError) {
          await this.safeReply(reply, savingsForbiddenReply());
        } else {
          throw error;
        }
        await this.sendMenu(reply);
        return;
      }
    }

    if (payload.flow !== "preview" || payload.preview === undefined) {
      // Unknown/unsupported admin flow: recover to idle.
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, questionDroppedReply());
      return;
    }

    const preview = payload.preview;
    try {
      const created = await this.deps.categoryService.createCategory(ownerId, body);
      const updated: PreviewPayload = { ...preview, category: created.name };
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_PREVIEW,
        pendingMovementId: null,
        pendingNote: JSON.stringify(updated),
      });
      await this.safeReply(reply, previewReply(updated.amount, updated.note, updated.type), await this.previewKeyboard(ownerId, updated, 0), undefined);
      return;
    } catch (error) {
      if (error instanceof ReservedCategoryError) {
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_PREVIEW,
          pendingMovementId: null,
          pendingNote: JSON.stringify(preview),
        });
        await this.safeReply(reply, reservedCategoryReply(body, error.concept));
        await this.safeReply(reply, previewReply(preview.amount, preview.note, preview.type), await this.previewKeyboard(ownerId, preview, 0), undefined);
        return;
      }
      if (error instanceof ValidationFailedError) {
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_PREVIEW,
          pendingMovementId: null,
          pendingNote: JSON.stringify(preview),
        });
        await this.safeReply(reply, duplicateCategoryReply(body));
        await this.safeReply(reply, previewReply(preview.amount, preview.note, preview.type), await this.previewKeyboard(ownerId, preview, 0), undefined);
        return;
      }
      throw error;
    }
  }

  /** Decodes a persisted `awaiting_category_name` payload; corrupt JSON yields null. */
  private decodeCategoryNamePayload(pendingNote: string | null): CategoryNamePayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = categoryNamePayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Idle free-text routing (spec bot-free-text-routing; design "Idle Routing
   * Pipeline"): deterministic pre-checks run BEFORE the brain — setup gate,
   * legacy prefixes, capture-shaped text, legacy text CRUD — each with the
   * educational redirect + menu and ZERO LLM calls; then the brain classifies
   * query | greeting | help | off_topic, every reply ending with the menu tail.
   * Free text in idle NEVER starts capture.
   */
  private async routeIdleMessage(body: string, ownerId: string, reply?: ReplyPort): Promise<void> {
    // 0. Setup gate takes precedence (spec "Setup gate precedes idle routing"):
    // neither the parser nor interpret is invoked for an owner without categories.
    const categories = await this.deps.categoryService.listCategories(ownerId);
    if (categories.length === 0) {
      await this.deps.botStateRepository.set({
        ownerId,
        state: AWAITING_SETUP,
        pendingMovementId: null,
        pendingNote: null,
      });
      await this.safeReply(reply, setupQuestionReply([]));
      return;
    }

    // 1. Legacy-prefix text → prefix-specific redirect + menu (zero LLM).
    const prefixKind = legacyPrefixKind(body);
    if (prefixKind !== null) {
      const redirect =
        prefixKind === "previsto"
          ? previstoPrefixRedirectReply()
          : prefixKind === "compartido"
            ? compartidoPrefixRedirectReply()
            : savingsOverrideRedirectReply();
      await this.safeReply(reply, redirect);
      await this.sendMenu(reply);
      return;
    }

    // 2. Capture-shaped text → educational redirect + menu (zero LLM).
    if (captureParse(body) !== null) {
      await this.safeReply(reply, captureShapedRedirectReply());
      await this.sendMenu(reply);
      return;
    }

    // 3. Legacy text category-CRUD → 🗂 redirect + menu (zero LLM).
    if (parseLegacyCategoryCrud(body) !== null) {
      await this.safeReply(reply, categoryCrudRedirectReply());
      await this.sendMenu(reply);
      return;
    }

    // 4. Brain classification: query / greeting / help / off_topic.
    const envelope = await this.tryBrainInterpret(body);
    if (envelope === null) {
      await this.safeReply(reply, unresolvableReply());
      await this.sendMenu(reply);
      return;
    }

    switch (envelope.intent) {
      case "query":
      case "query_recent":
      case "query_balance":
      case "query_month":
      case "query_planned":
        await this.executeQuery(envelope, ownerId, reply);
        await this.sendMenu(reply);
        return;
      case "greeting":
        await this.makeSender(true, reply)(
          { intent: "greeting", ok: true, action: "none", amount: null, note: null },
          greetingReply(),
        );
        await this.sendMenu(reply);
        return;
      case "help":
        await this.safeReply(reply, ayudaReply());
        await this.sendMenu(reply);
        return;
      case "off_topic":
        await this.safeReply(reply, unresolvableReply());
        await this.sendMenu(reply);
        return;
    }
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
        { intent: envelope.intent, ok: false, action: "redirected", amount: null, note: null },
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
        { intent: envelope.intent, ok: false, action: "redirected", amount: null, note: null, query_type: queryType },
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
        note: null,
        query_type: queryType,
        query: result,
      },
      queryReplyTemplate(result),
    );
  }

  private async tryBrainInterpret(body: string): Promise<ConversationEnvelope | null> {
    if (this.deps.brain === undefined) {
      return null;
    }
    try {
      return await this.deps.brain.interpret(body);
    } catch (error) {
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

  /** Builds the per-message sender: brain reply when active, else the fixed template. */
  private makeSender(brainActive: boolean, reply?: ReplyPort): Sender {
    return async (result: ExecutionResult, fixed: string): Promise<void> => {
      const text = brainActive ? ((await this.tryBrainReply(result)) ?? fixed) : fixed;
      await this.safeReply(reply, text);
    };
  }

  /**
   * v2 movement registration (spec money-movements "Bot Movement Type by Menu
   * Button"; savings "Income Split and Rounding"): the type/status/visibility
   * derive from the menu-chosen capture type, NEVER from text: REAL →
   * EXPENSE+PAID+INDIVIDUAL; PENDING → EXPENSE+PENDING+INDIVIDUAL; INGRESO →
   * INCOME+PAID+INDIVIDUAL with the automatic savings split (the rule ALWAYS
   * applies — per-message overrides are removed, so resolveSplit runs with
   * `{kind:"none"}`); COMPARTIDO → EXPENSE+PAID+SHARED. COMPARTIDO and
   * PENDING never split.
   */
  private async registerCapture(
    amount: number,
    note: string | null,
    type: CaptureType,
    category: string,
    ownerId: string,
    reply?: ReplyPort,
  ): Promise<boolean> {
    if (type === "INGRESO") {
      // The rule always applies: no per-message override exists in v2.
      const split = await this.deps.savingsService.resolveSplit(ownerId, note ?? "", { kind: "none" });
      if (split.kind === "split") {
        return this.registerIncomeSplit(amount, note, ownerId, split.percent, reply);
      }
    }
    const movementType = type === "INGRESO" ? "INCOME" : "EXPENSE";
    const status = type === "PENDING" ? "PENDING" : "PAID";
    const visibility = type === "COMPARTIDO" ? "SHARED" : "INDIVIDUAL";
    const movement = await this.createMovement(amount, note, category, ownerId, visibility, movementType, status);
    if (movement === null) {
      return false;
    }
    const fixed = type === "PENDING" ? plannedReply(amount, note, category) : successReply(amount, note, category);
    await this.safeReply(reply, fixed);
    await this.sendMenu(reply);
    return true;
  }

  /**
   * The savings split tail (design "Capture & Savings Data Flow"; savings
   * spec "Income Split and Rounding"): ensures the SAVINGS "ahorro" category
   * and persists net INCOME + SAVINGS in ONE transaction via
   * `createIncomeWithSavings`; the fixed confirmation reports gross, net and
   * saved, followed by the menu. Visibility is always INDIVIDUAL from the bot
   * (the SHARED inheritance stays satisfied for pre-existing shared incomes).
   */
  private async registerIncomeSplit(
    gross: number,
    note: string | null,
    ownerId: string,
    percent: number,
    reply?: ReplyPort,
  ): Promise<boolean> {
    await this.deps.categoryService.ensureAhorro(ownerId);
    const result = await this.deps.expenseService.createIncomeWithSavings({
      ownerId,
      gross,
      percent,
      note,
      occurredAt: new Date(),
      category: "ahorro",
      visibility: "INDIVIDUAL",
    });
    if (result.net === null && result.savings === null) {
      return false;
    }
    const net = result.net?.amount ?? null;
    const savings = result.savings?.amount ?? null;
    await this.safeReply(reply, successSplitReply(gross, net ?? 0, savings ?? 0));
    await this.sendMenu(reply);
    return true;
  }

  /** D5: createMovement with an explicit type — the type NEVER comes from text. */
  private async createMovement(
    amount: number,
    note: string | null,
    category: string,
    ownerId: string,
    visibility: "INDIVIDUAL" | "SHARED",
    type: "EXPENSE" | "INCOME",
    status: "PENDING" | "PAID",
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
          ...(status === "PENDING" ? { status } : {}),
        },
        ownerId,
        { visibility },
      );
    } catch (error) {
      this.deps.logger?.(`Telegram: failed to create movement: ${String(error)}`);
      return null;
    }
  }

  /** D4/D6 — delete-gate callbacks (dc:ok/dc:no): unchanged from v1, re-entered from the expense admin in Phase 6. */
  private async handleDeleteGateCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, sub, targetId] = callback.data.split(":");
    if (targetId === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const payload = this.decodeDeleteConfirmPayload(state?.pendingNote ?? null);

    // Corrupt gate payload: the gate cannot be trusted, so it abandons to idle
    // WITHOUT deleting anything.
    if (state?.state === AWAITING_DELETE_CONFIRMATION && payload === null) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    // D5/D6 — state+target gate: a dc:ok/dc:no whose expected state+target
    // does not match replies "ya procesado" and executes nothing.
    if (state?.state !== AWAITING_DELETE_CONFIRMATION || payload === null || payload.target.id !== targetId) {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    if (sub === "no") {
      // Cancel: close the gate, nothing is deleted.
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      await this.safeReply(reply, deleteCancelledReply());
      await this.sendMenu(reply);
      return;
    }

    // Confirm: transition to idle FIRST (the state is the consumption record),
    // then delete the persisted target; a 404 replies movement missing.
    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    const result = await this.movementLifecycleExecutor.deleteById(ownerId, payload.target);
    if (result.status === "missing") {
      await this.safeReply(reply, movementMissingReply());
    } else {
      await this.safeReply(
        reply,
        deletedMovementReply(result.movement.amount, result.movement.note, result.movement.category || null),
      );
    }
    await this.sendMenu(reply);
  }

  /** D6 — decodes a persisted delete-gate payload; corrupt JSON yields null. */
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

  /**
   * D4/D10 — delete-pick callbacks (dk:<id>): resolve the picked candidate
   * from the persisted selection payload and open the gate. Kept as-is from
   * v1; the expense admin re-enters it via `am:del` in Phase 6.
   */
  private async handleDeletePickCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, targetId] = callback.data.split(":");
    if (targetId === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const lifecycle = this.decodeLifecycleSelectionPayload(state?.pendingNote ?? null);

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
      await this.renderMovementPickList(ownerId, updated, 0, reply);
      return;
    }

    // The pick opens the delete GATE with the picked target: nothing is
    // deleted until the 🗑 tap.
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

  /**
   * am:* expense-admin chains (spec bot-manage-expenses): `am:del` reuses the
   * delete window → `dk` pick → gate (as-is); `am:cor` opens the correction
   * window (10 recent non-PENDING) → `mc` pick → awaiting_category_selection →
   * `cc` reassign; `am:pay` opens the PENDING window → `mp` pick →
   * markPaidById. Every pick list paginates at 7 rows/page (design D9, ≤8).
   */
  private async handleAdminExpenseCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, sub] = callback.data.split(":");
    switch (sub) {
      case "del": {
        const window = await this.movementLifecycleExecutor.deleteWindow(ownerId);
        if (window.length === 0) {
          await this.safeReply(reply, nothingToDeleteReply());
          await this.sendMenu(reply);
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
        await this.renderMovementPickList(ownerId, payload, 0, reply);
        return;
      }
      case "cor": {
        const window = await this.movementCorrector.correctionWindow(ownerId);
        if (window.length === 0) {
          await this.safeReply(reply, correctionEmptyReply());
          await this.sendMenu(reply);
          return;
        }
        const payload: LifecycleSelectionPayload = {
          action: "correct_category",
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
        await this.renderMovementPickList(ownerId, payload, 0, reply);
        return;
      }
      case "pay": {
        const window = await this.movementLifecycleExecutor.pendingWindow(ownerId);
        if (window.length === 0) {
          await this.safeReply(reply, nothingPendingReply());
          await this.sendMenu(reply);
          return;
        }
        const payload: LifecycleSelectionPayload = {
          action: "mark_paid",
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
        await this.renderMovementPickList(ownerId, payload, 0, reply);
        return;
      }
      default:
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /**
   * ac:* category-admin chains (spec bot-manage-categories): `ac:new` prompts
   * a name (awaiting_category_name admin_create); `ac:ren` renders the NORMAL
   * categories as `ac:rn:<id>` picks → awaiting_category_name admin_rename;
   * `ac:del` renders `ac:dl:<id>` picks → stateless `ac:ok:<id>`/`ac:no:<id>`
   * confirm → guarded deleteCategory. Pick lists exclude "otro"/"ahorro".
   */
  private async handleAdminCategoryCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, sub, value] = callback.data.split(":");
    switch (sub) {
      case "new": {
        const payload: CategoryNamePayload = { flow: "admin_create" };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_CATEGORY_NAME,
          pendingMovementId: null,
          pendingNote: JSON.stringify(payload),
        });
        await this.safeReply(reply, categoryNamePromptReply("admin_create"));
        return;
      }
      case "ren": {
        await this.safeReply(reply, categoryRenamePickReply(), await this.categoryPickKeyboard(ownerId, "ac:rn", 0), undefined);
        return;
      }
      case "rn": {
        if (value === undefined) {
          await this.safeReply(reply, callbackUnavailableReply());
          return;
        }
        const payload: CategoryNamePayload = { flow: "admin_rename", categoryId: value };
        await this.deps.botStateRepository.set({
          ownerId,
          state: AWAITING_CATEGORY_NAME,
          pendingMovementId: null,
          pendingNote: JSON.stringify(payload),
        });
        await this.safeReply(reply, categoryNamePromptReply("admin_rename"));
        return;
      }
      case "del": {
        await this.safeReply(reply, categoryDeletePickReply(), await this.categoryPickKeyboard(ownerId, "ac:dl", 0), undefined);
        return;
      }
      case "dl": {
        if (value === undefined) {
          await this.safeReply(reply, callbackUnavailableReply());
          return;
        }
        const categories = await this.deps.categoryService.listCategories(ownerId);
        const category = categories.find((candidate) => candidate.id === value);
        if (category === undefined) {
          await this.safeReply(reply, categoryGoneReply());
          return;
        }
        // Stateless confirmation (design D6): the guarded service re-validates.
        await this.safeReply(
          reply,
          categoryDeleteConfirmReply(category.name),
          [
            [
              { text: "❌ No", callback_data: buildCallbackData(["ac", "no", value]) },
              { text: "✅ Borrar", callback_data: buildCallbackData(["ac", "ok", value]) },
            ],
          ],
          undefined,
        );
        return;
      }
      case "ok": {
        if (value === undefined) {
          await this.safeReply(reply, callbackUnavailableReply());
          return;
        }
        const categories = await this.deps.categoryService.listCategories(ownerId);
        const category = categories.find((candidate) => candidate.id === value);
        if (category === undefined) {
          // Retry-after-delete (or a stale button): honest NotFound reply.
          await this.safeReply(reply, categoryGoneReply());
          await this.sendMenu(reply);
          return;
        }
        try {
          await this.deps.categoryService.deleteCategory(ownerId, category.name);
        } catch (error) {
          if (error instanceof NotFoundError) {
            await this.safeReply(reply, missingCategoryReply(category.name));
            await this.sendMenu(reply);
            return;
          }
          if (error instanceof ValidationFailedError) {
            await this.safeReply(reply, otroDeleteForbiddenReply());
            await this.sendMenu(reply);
            return;
          }
          if (error instanceof SavingsForbiddenError) {
            await this.safeReply(reply, savingsForbiddenReply());
            await this.sendMenu(reply);
            return;
          }
          throw error;
        }
        await this.safeReply(reply, categoryDeletedReply(category.name));
        await this.sendMenu(reply);
        return;
      }
      case "no": {
        await this.safeReply(reply, deleteCancelledReply());
        await this.sendMenu(reply);
        return;
      }
      default:
        await this.safeReply(reply, callbackUnavailableReply());
    }
  }

  /**
   * rep:* reports (spec bot-reports-menu): each button executes its
   * QueryExecutor type from real data with the fixed template; failures
   * redirect honestly; every answer ends with the menu. No state is persisted.
   */
  private async handleReportsCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const parts = callback.data.split(":");
    const sub = parts[1];
    if (sub === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const mapping: Record<string, QueryType> = {
      recent: "recent",
      balance: "balance",
      month: "month",
      savings: "savings",
      planned: "planned",
    };
    const queryType = mapping[sub];
    if (queryType === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const envelope: ConversationEnvelope = { intent: "query", amount: null, note: null, query_type: queryType };
    await this.executeQuery(envelope, ownerId, reply);
    await this.sendMenu(reply);
  }

  /**
   * mc:<id> — correction pick (spec movement-correction "Button-pick
   * correction reassigns"): persists the picked movement into
   * `awaiting_category_selection` and renders the NORMAL category `cc:` row.
   */
  private async handleCorrectionPickCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, targetId] = callback.data.split(":");
    if (targetId === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const lifecycle = this.decodeLifecycleSelectionPayload(state?.pendingNote ?? null);

    if (state?.state !== AWAITING_MOVEMENT_SELECTION || lifecycle === null || lifecycle.action !== "correct_category") {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    const picked = lifecycle.candidates.find((candidate) => candidate.id === targetId);
    if (picked === undefined) {
      // Stale button: re-render the correction list honestly.
      await this.renderMovementPickList(ownerId, lifecycle, 0, reply);
      return;
    }

    const payload: CategorySelectionPayload = { movement: picked };
    await this.deps.botStateRepository.set({
      ownerId,
      state: AWAITING_CATEGORY_SELECTION,
      pendingMovementId: null,
      pendingNote: JSON.stringify(payload),
    });
    await this.safeReply(reply, reassignCategoryReply(), await this.categoryPickKeyboard(ownerId, "cc", 0), undefined);
  }

  /**
   * cc:<catId> — reassign the picked movement to the picked NORMAL category
   * (spec movement-correction): resolves the category name at callback time,
   * updates via `updateMovement`, confirms with the movement facts and returns
   * to the menu. A deleted movement replies honestly.
   */
  private async handleReassignCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, catId] = callback.data.split(":");
    if (catId === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const payload = this.decodeCategorySelectionPayload(state?.pendingNote ?? null);

    if (state?.state !== AWAITING_CATEGORY_SELECTION || payload === null) {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    const categories = await this.deps.categoryService.listCategories(ownerId);
    const category = categories.find((candidate) => candidate.id === catId);
    if (category === undefined) {
      // Stale button: re-render the category row.
      await this.safeReply(reply, reassignCategoryReply(), await this.categoryPickKeyboard(ownerId, "cc", 0), undefined);
      return;
    }

    try {
      await this.deps.movementService.updateMovement(ownerId, payload.movement.id, { category: category.name });
    } catch (error) {
      await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
      if (error instanceof NotFoundError) {
        await this.safeReply(reply, movementMissingReply());
      } else {
        throw error;
      }
      await this.sendMenu(reply);
      return;
    }

    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    await this.safeReply(
      reply,
      movementCorrectionDoneReply(category.name, payload.movement.amount, payload.movement.note),
    );
    await this.sendMenu(reply);
  }

  /**
   * mp:<id> — mark-paid pick (spec bot-manage-expenses "Mark-Paid Chain"):
   * executes `markPaidById`; an already-PAID pick replies the 409 conflict.
   */
  private async handleMarkPaidPickCallback(callback: TelegramCallback, ownerId: string, reply?: ReplyPort): Promise<void> {
    const [, targetId] = callback.data.split(":");
    if (targetId === undefined) {
      await this.safeReply(reply, callbackUnavailableReply());
      return;
    }
    const state = await this.deps.botStateRepository.get(ownerId);
    const lifecycle = this.decodeLifecycleSelectionPayload(state?.pendingNote ?? null);

    if (state?.state !== AWAITING_MOVEMENT_SELECTION || lifecycle === null || lifecycle.action !== "mark_paid") {
      await this.safeReply(reply, alreadyProcessedReply());
      return;
    }

    const picked = lifecycle.candidates.find((candidate) => candidate.id === targetId);
    if (picked === undefined) {
      await this.renderMovementPickList(ownerId, lifecycle, 0, reply);
      return;
    }

    await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
    const candidate = { ...picked, category: "", occurredAtMs: 0 };
    const result = await this.movementLifecycleExecutor.markPaidById(ownerId, candidate);
    if (result.status === "executed") {
      await this.safeReply(reply, markPaidReply(result.movement.amount, result.movement.note, null));
    } else if (result.status === "already_paid") {
      await this.safeReply(reply, markPaidAlreadyReply());
    } else {
      await this.safeReply(reply, movementMissingReply());
    }
    await this.sendMenu(reply);
  }

  /** Movement pick buttons: `<action>:<id>` rows, 7 per page + `cp:` nav (design D9 ≤8 rows). */
  private movementPickKeyboard(
    candidates: { id: string; amount: number; note: string | null; date: string }[],
    action: string,
    page: number,
  ): InlineKeyboard {
    const pageSize = 7;
    const pageItems = candidates.slice(page * pageSize, page * pageSize + pageSize);
    const rows: InlineButton[][] = pageItems.map((candidate) => [
      { text: `${candidate.date} · ${formatARS(candidate.amount)}`, callback_data: buildCallbackData([action, candidate.id]) },
    ]);
    if (candidates.length > pageSize) {
      const totalPages = Math.ceil(candidates.length / pageSize);
      rows.push([
        { text: "◀️", callback_data: buildCallbackData(["cp", String(Math.max(0, page - 1))]) },
        { text: `${page + 1}/${totalPages}`, callback_data: buildCallbackData(["cp", String(page)]) },
        { text: "▶️", callback_data: buildCallbackData(["cp", String(Math.min(totalPages - 1, page + 1))]) },
      ]);
    }
    return rows;
  }

  /** Renders a movement pick list (ask text + paginated buttons) for the open selection payload. */
  private async renderMovementPickList(
    ownerId: string,
    payload: LifecycleSelectionPayload,
    page: number,
    reply?: ReplyPort,
  ): Promise<void> {
    const ask =
      payload.action === "mark_paid"
        ? markPaidAskReply(payload.candidates)
        : payload.action === "correct_category"
          ? correctionPickListReply(payload.candidates)
          : deletePickListReply(payload.candidates);
    const prefix = payload.action === "mark_paid" ? "mp" : payload.action === "correct_category" ? "mc" : "dk";
    await this.safeReply(reply, ask, this.movementPickKeyboard(payload.candidates, prefix, page), undefined);
  }

  /**
   * NORMAL-category buttons: `<prefix>:<id>` rows, 7 per page + `cp:` nav
   * (design D9). Excludes "otro" (legacy reserved) and "ahorro" (SAVINGS) —
   * spec movement-categories / bot-manage-categories pick lists.
   */
  private async categoryPickKeyboard(ownerId: string, prefix: string, page: number): Promise<InlineKeyboard> {
    const categories = await this.deps.categoryService.listCategories(ownerId);
    const normal = categories
      .filter((category) => category.type === "NORMAL" && normalizeForMatch(category.name) !== "otro")
      .sort((a, b) => a.name.localeCompare(b.name));
    const pageSize = 7;
    const pageItems = normal.slice(page * pageSize, page * pageSize + pageSize);
    const rows: InlineButton[][] = pageItems.map((category) => [
      { text: category.name, callback_data: buildCallbackData([prefix, category.id]) },
    ]);
    if (normal.length > pageSize) {
      const totalPages = Math.ceil(normal.length / pageSize);
      rows.push([
        { text: "◀️", callback_data: buildCallbackData(["cp", String(Math.max(0, page - 1))]) },
        { text: `${page + 1}/${totalPages}`, callback_data: buildCallbackData(["cp", String(page)]) },
        { text: "▶️", callback_data: buildCallbackData(["cp", String(Math.min(totalPages - 1, page + 1))]) },
      ]);
    }
    return rows;
  }

  /** Decodes a persisted `awaiting_category_selection` payload; corrupt JSON yields null. */
  private decodeCategorySelectionPayload(pendingNote: string | null): CategorySelectionPayload | null {
    if (pendingNote === null) {
      return null;
    }
    try {
      const parsed = categorySelectionPayloadSchema.safeParse(JSON.parse(pendingNote));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Decodes a persisted lifecycle-selection payload; corrupt JSON yields null. */
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

  /**
   * v2 command surface (spec telegram-bot "Bot Commands"): menu/start abandon
   * any pending flow and render the eight-button menu; the text category-CRUD
   * commands are handled by `parseLegacyCategoryCrud` in the idle path; the
   * savings-rule command stays as the rule-definition channel.
   */
  private async handleCommand(command: TelegramCommand, ownerId: string, reply?: ReplyPort): Promise<void> {
    switch (command.type) {
      case "list": {
        const categories = await this.deps.categoryService.listCategories(ownerId);
        await this.safeReply(reply, categoryListReply(categories));
        return;
      }

      case "menu":
      case "start": {
        // v2 supersession (spec bot-main-menu "Menu tap supersedes a pending
        // preview"): the menu command abandons any open flow and starts fresh.
        await this.deps.botStateRepository.set({ ownerId, state: IDLE, pendingMovementId: null, pendingNote: null });
        await this.sendMenu(reply);
        return;
      }

      case "ayuda": {
        // Static help, works with GROQ_API_KEY unset.
        await this.safeReply(reply, ayudaReply());
        return;
      }

      case "configurar": {
        // The question lists the owner's existing categories (dynamic listing).
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
        await this.safeReply(reply, savingsRuleInvalidReply());
        return;
      }
    }
  }

  /**
   * Setup reply (spec telegram-bot "Setup Flow"): newline/comma-separated
   * names plus the legacy batch commands funnel through the guarded
   * CategoryService; only remaining plain tokens become categories. The "otro"
   * auto-create is removed in Phase 4 (task 4.4) — kept here for the
   * transitional setup flow.
   */
  private async handleSetupReply(body: string, ownerId: string, reply?: ReplyPort): Promise<void> {
    const entries = parseSetupBatchCommand(body);
    const createNames = entries.filter((entry) => entry.kind === "create").map((entry) => entry.name);
    const hasCommands = entries.some((entry) => entry.kind !== "create");
    if (createNames.length === 0 && !hasCommands) {
      await this.safeReply(reply, setupRetryReply());
      return;
    }

    const existing = await this.deps.categoryService.listCategories(ownerId);
    const existingNormalized = new Set(existing.map((category) => normalizeForMatch(category.name)));

    const deleted: string[] = [];
    const renamed: { from: string; to: string }[] = [];
    for (const entry of entries) {
      if (entry.kind === "delete") {
        try {
          await this.deps.categoryService.deleteCategory(ownerId, entry.name);
          deleted.push(entry.name);
        } catch (error) {
          if (error instanceof NotFoundError || error instanceof ValidationFailedError) {
            continue;
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
            continue;
          }
          throw error;
        }
      }
    }

    const created: string[] = [];
    const redirects: { name: string; concept: ReservedCategoryError["concept"] }[] = [];
    for (const name of this.dedupeNames(createNames)) {
      if (existingNormalized.has(normalizeForMatch(name))) {
        continue;
      }
      try {
        await this.deps.categoryService.createCategory(ownerId, name);
        created.push(name);
        existingNormalized.add(normalizeForMatch(name));
      } catch (error) {
        if (error instanceof ReservedCategoryError) {
          redirects.push({ name, concept: error.concept });
          continue;
        }
        if (error instanceof ValidationFailedError) {
          continue;
        }
        throw error;
      }
    }

    // v2 (spec movement-categories "Setup creates no otro for new owners"): the
    // legacy "otro" row is never auto-created — category is mandatory at the
    // preview; an old "otro" row (pre-redesign) stays as a legacy reserved row.
    const finalCreated = this.dedupeNames(created);

    await this.deps.botStateRepository.set({
      ownerId,
      state: IDLE,
      pendingMovementId: null,
      pendingNote: null,
    });
    await this.safeReply(reply, setupBatchDoneReply({ created: finalCreated, redirects, deleted, renamed }));
  }

  /**
   * 3.5 — v2 state membership: a persisted state outside the eight v2 values
   * (a removed dialog state or any rollback leftover) normalizes to `idle` so
   * the corrupt-payload discipline owns the message.
   */
  private normalizeState(state: string): string {
    return (BOT_STATES as readonly string[]).includes(state) ? state : IDLE;
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