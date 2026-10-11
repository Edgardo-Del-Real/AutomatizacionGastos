# Design: Bot Hybrid UX — Inline Buttons + Deterministic Capture + Bounded LLM

## Technical Approach

Extend the existing SINGLE state machine (proposal Approach 1, explore #511): `TelegramService` gains a callback channel (`handleCallback`) dispatched by a compact `callback_data` action scheme; the `ReplyPort` extends to `text + keyboard + editMessageId` (backward-compatible trailing params); the idle path becomes deterministic-first (`quickCaptureParse` between the setup gate and `brain.interpret`); delete becomes a two-step gate (`awaiting_delete_confirmation`); dialog category answers resolve against the closed set or buttons (single-token auto-create removed); the brain loses the `planned` signal (presence → `null`). Reuses executors, matcher, amount parsers, the `pendingNote`+zod payload pattern, and `recordApiCalls`. No Prisma migration.

## Architecture Decisions

| # | Decision | Choice (vs rejected) | Rationale |
|---|---|---|---|
| D1 | Router | Integrated deterministic-first router inside `TelegramService` (vs a parallel `TelegramButtonController` mini-machine) | Proposal enfoque 1: ONE state machine (no drift between two `BotState` writers), all deterministic executors reused, fast path testable offline without network. Touches the 2509-line router, but avoids dual-machine state conflicts. |
| D2 | Reply port | `(text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>` — optional trailing params (vs a new `send(opts)` port or a breaking rename) | Backward compatible: every existing `reply(text)` call site and the test stub `(text) => …` stay assignable (TS function-argument bivariance). Keyboard is a plain DTO (`InlineButton[][]`), no grammy types in the service; the production wiring maps to `reply_markup` / `editMessageText`. |
| D3 | Keyboard ownership | Keyboards ONLY on deterministic fixed-template surfaces: preview, delete gate, menu, pickers. `Sender` (brain-or-fixed) stays text-only. | Every button surface is LLM-free by construction; the brain never renders keyboards and never words a destructive prompt. The post-tap delete confirmation still reuses `sendLifecycleResult` (reports executed facts only). |
| D4 | callback_data scheme | Compact action prefixes + ids (never names): `m:*`, `pv:*:<tok>`, `dc:*:<id>`, `dk:<id>`, `cat:<id>`, `dkp/cp:<page>` (table below). ASCII-only, ≤ 64 bytes, unit-asserted; keyboards ≤ 8 rows; pickers paginate at 7 + nav row. | Spec bot-inline-interactions limits. Ids are stable (cuid 25 chars); names would break the byte budget and break on rename. |
| D5 | Callback idempotency | State-gated persisted tokens: preview `saveToken` (random 8-hex) and delete-gate `targetId` both live in `pendingNote`; a callback whose expected state+token doesn't match replies "ya procesado" and executes nothing (vs extending `ProcessedMessage` to callbacks) | `ProcessedMessage` is text-keyed and skip-silent — retries must be ANSWERED ("ya procesado"). The state IS the consumption record: Guardar / Corregir / dc:ok / dc:no all transition to `idle` before acting, so a retried callback finds no matching gate and never double-executes (spec "Callback Idempotency"). |
| D6 | Delete gate split | Executor `delete()` becomes resolve-only (`{status:"gated", candidate}`); the SERVICE persists the gate and `dc:ok` → `deleteById`. `markPaid` / `markPaidById` / `deleteById` unchanged. (vs the executor doing the gate itself) | The state machine owns dialog persistence (`pendingNote`) — every existing ask already persists there; the executor stays pure/deterministic with zero bot-state writes. Fixes bug #1: no path from resolution to deletion without the 🗑 tap. |
| D7 | `planned` removal | `conversationEnvelopeSchema.planned: z.never().optional()` — PRESENCE fails the schema → `interpret` returns `null` → deterministic flow (vs keeping the flag as a non-materializable signal) | Spec bot-brain mandates "a response carrying `planned` MUST degrade to `null`". zod's default behavior STRIPS unknown keys silently — a merely-removed field could never produce the mandated degradation; `z.never().optional()` makes presence a hard parse failure. `ExecutionResult.planned` (reply fact) and the `planned` bits in `amountConfirmationPayload`/`registrationCollectPayload` stay: they persist the `previsto:` PREFIX signal — a sanctioned producer. Prompt teaching removed; goldens regenerated. |
| D8 | Menu "Gasto previsto" | `m:prev` replies an educational capture prompt (teaches the `previsto:` prefix AND the Previsto preview button); NO remembered intent, NO new state. | Cross-spec conflict: quick-capture pins "PENDING MUST be produced ONLY by the `previsto:` prefix or the explicit Previsto button" — a menu-remembered intent would be a THIRD producer. The ONLY rule wins (more specific contract). Flagged in Open Questions. |
| D9 | Dialog category answers | The D6 cascade becomes exact → folded → BUTTONS: the three single-token auto-create sites (`d6AwaitingCategory` ~:1036, `d6AwaitingRegistration` cascade ~:1354, `resolveAwaitingCategory` envelope-answer ~:1662) are replaced by a closed-set button render (`cat:<id>`, "otro" included, `cp:<page>` pagination); the multi-word non-match renders the same buttons (replacing the plain text list). Exact/folded TEXT answers keep working. Guard sets keep `normalizeForMatchGuard` (interception at :1454-:1467 unchanged). | Spec conversational-categories / registration-collection: answers resolve ONLY against the closed set or the category buttons — kills ghost creation (bug #4). Shared tails `applyCategoryCorrection(name)` / `applyCollectCategory(name)` extracted so text answers and `cat:` callbacks run identical code. |
| D10 | Menu delete entry | `m:del` → executor-exported `deleteWindow(ownerId)` (the 10-row all-movements window) → persist `lifecycleSelectionPayload{action:"delete_expense"}` under `awaiting_movement_selection` → render `dk:<id>` buttons (7 + nav). `dk:<id>` → pick from the persisted payload → GATE. The conversational ambiguity ask renders the SAME dk buttons beside the text ask. `handleLifecycleSelection`'s delete branch opens the gate instead of `deleteById`. | One selection payload + one gate for both entries (menu button / conversational). mark_paid asks stay text-only (out of spec scope, documented). Reuses `pickMovementSelection` and the existing payload schema. |
| D11 | New-text-in-state semantics | `awaiting_preview` and `awaiting_delete_confirmation` behave like the selection dialogs: any new non-command TEXT abandons → `idle` → reprocess normally. Commands still run first and never clear open dialogs (existing convention "Commands are checked before state consumption in every state"). | Mirrors `handleMovementSelection`'s abandon+reprocess: a "borra otro gasto" during a gate reopens with the new target — still nothing deleted without 🗑. `/menu` reopening has no side effects (spec bot-main-menu). |
| D12 | Boot commands | New `startTelegramBot(bot)` in `telegram.bot.ts`: `setMyCommands` (try/catch → log, never crash the loop) then `bot.start()`; `server.ts` swaps to it. Commands `/menu /ayuda /listar_categorias /configurar_categorias`. `parseCommand` normalizes a leading `/` and `_`→space before matching. | Spec bot-main-menu `setMyCommands` + "registration failure tolerated". Underscore tolerance keeps the existing regexes as the single parser surface for `/listar_categorias` and "listar categorias". |
| D13 | Harness migration | Keep `replies: string[]` untouched; the stub ALSO pushes to parallel arrays `keyboards: (InlineKeyboard|undefined)[]` and `edits: (number|undefined)[]`. Bot-level assertions drive `bot.handleUpdate` + `recordApiCalls` (assert `sendMessage` payload `reply_markup`, `editMessageText` target, `answerCallbackQuery`, `setMyCommands` list). | Zero churn on ~4600 lines of text assertions (D2 keeps the old stub assignable); keyboard/edit assertions are additive. `recordApiCalls` already records method+payload — offline keyboard proof with zero network calls. |
| D14 | Ghost cleanup | MODIFY the existing `apps/api/src/scripts/cleanup-phantom-data.ts` (from the archived bot-expense-lifecycle change): add `--dry-run` (default: report-only) + explicit `--write` flag; keep the row backup, guarded service deletes, pre/post asserts; extend `PHANTOM_CATEGORY_NAMES` from the dry-run report (vs writing a new script) | Spec movement-categories requires dry-run + explicit write + backup. The archived script already covers exactly "No.", "si", "Borrar categoría: no", "gasto provisorio" with backup + guarded deletes — duplicating it would fork the runbook. |

## Data Flow

**1. Quick capture with preview (bug #2 — no LLM on the fast path):**

```
Owner: "30000 gym" (idle)
 handleUpdate → resolve owner → record dedup → parseCommand null → prefixes none
 → handleRegistration → listCategories → setup gate: has categories
 → quickCaptureParse(body, keywords)        [PURE: parseAmountAndNote + matchCategory]
     match {amount 30000, note "gym", category "Gimnasio"}
 → BotState{awaiting_preview, pendingNote: previewPayload{body,note,category,type REAL,saveToken,shared,override}}
 → reply(previewReply, [[✅ Guardar pv:save:<tok>][✏️ Corregir pv:edit:<tok>],
                        [● Gasto real pv:typ:r:<tok>][○ Previsto pv:typ:p:<tok>]])
 — brain.interpret NEVER invoked (mock call count 0 in tests)

[○ Previsto] → pv:typ:p:<tok> → state∧token match → payload.type=PENDING → persist
 → editMessageText(preview re-render + same keyboard)   [edits the button's own message]

[✅ Guardar] → pv:save:<tok> → state∧token match
 → state→idle FIRST → registerWithCategory(..., planned = type==="PENDING", override, fixed sender)
 → reply(plannedReply | successReply)
Retry pv:save:<tok> → no awaiting_preview∧token → "ya procesado" — registers exactly once
"previsto: 30000 gym" → prefix strips → planned=true seeds payload.type=PENDING (sanctioned producer)
```

**2. Delete with confirmation (bug #1):**

```
Owner: "borra ese gasto" (idle)
 → handleRegistration → quickCaptureParse → null → brain.interpret          [fallback only]
 → {intent delete_expense} → routeEnvelopeIntent → runMovementLifecycle
 → executor.delete(owner, cues) → RESOLVE-ONLY:
     unique → {status gated, candidate} → BotState{awaiting_delete_confirmation,
               pendingNote: deleteConfirmPayload{target candidate}}
             → reply(deleteConfirmReply, [[❌ Cancelar dc:no:<id>][🗑 Borrar dc:ok:<id>]])   [fixed-only]
     ask   → awaiting_movement_selection + deleteAskReply + dk:<id> buttons → pick → gate
     none  → nothingToDeleteReply (no gate opens)

[🗑 Borrar] dc:ok:<id> → state∧target match → state→idle → deleteById
     executed → sendLifecycleResult (deletedMovementReply) ; 404 → movementMissingReply
[❌ Cancelar] dc:no:<id> → state→idle → deleteCancelledReply (nothing deleted)
New text during gate → abandon → idle → reprocess normally
Retry dc:ok after done → state mismatch → "ya procesado"
Menu entry: [m:del] → deleteWindow → dk list → pick → SAME gate
```

**3. Menu:**

```
Owner: /menu → parseCommand{menu} → reply(menuReply, 5 one-per-row buttons m:new|m:prev|m:del|m:rep|m:help)
 [m:new]  → capturePromptReply (idle, no state change)
 [m:prev] → pendingCapturePromptReply ("previsto: 30000 gym" o el botón Previsto — D8)
 [m:del]  → deleteWindow(owner) → persist selection payload → dk buttons (7 + dkp:<page> nav) → pick → gate
 [m:rep]  → queryExecutor.execute(scope, "recent") → answers from real movements
 [m:help] → ayudaReply (static; works with GROQ_API_KEY unset)
Boot: startTelegramBot → setMyCommands (failure logged only) → bot.start()
```

**4. LLM query fallback (where the brain still runs):**

```
Owner: "cuánto gasté este mes" (idle)
 → handleRegistration → setup gate no → quickCaptureParse → null (no amount+keyword pair)
 → brain.interpret → {intent query, query_type balance}     [fallback for uncaptured intents]
 → executeQuery → queryExecutor → real movements → reply
   (deterministic executor computes; the brain only classified — it never computes data)
```

## callback_data Scheme (≤ 64 bytes; ids never names)

| Action | Format | Example | Bytes |
|---|---|---|---|
| Menu | `m:new` `m:prev` `m:del` `m:rep` `m:help` | `m:prev` | ≤6 |
| Preview save/correct | `pv:save:<tok>` / `pv:edit:<tok>` | 8-hex tok | 15 |
| Preview type toggle | `pv:typ:r:<tok>` / `pv:typ:p:<tok>` | | 16 |
| Delete gate | `dc:ok:<id>` / `dc:no:<id>` | cuid 25 | 31 |
| Delete pick / page | `dk:<id>` / `dkp:<page>` | | ≤28 / ≤8 |
| Category pick / page | `cat:<id>` / `cp:<page>` | | ≤29 / ≤8 |

`buildCallbackData` helper unit-asserts `Buffer.byteLength(data, "utf8") ≤ 64` and ASCII-only. Rows: menu 5 (one per row); preview 2 rows (actions row + type row); gate 1 row (2 buttons); pickers 7 + nav row (≤ 8 ✓).

## Interfaces / Contracts

```ts
// telegram.parser.ts (pure)
export type InlineButton = { text: string; callback_data: string };
export type InlineKeyboard = InlineButton[][]; // rows, ≤ 8
export type TelegramCallback = { fromId: number; chatId: string; messageId: number; data: string };
export function normalizeTelegramCallback(update: unknown): TelegramCallback | null;
//   callback_query only: private chat, string data, from.id; edited/group/message → null
export type QuickCapture = { amount: number; note: string | null; category: string };
export function quickCaptureParse(text: string, rules: KeywordRule[]): QuickCapture | null;
//   amount via parseAmountAndNote; category via matchCategory(note ?? text, rules); miss → null

// telegram.service.ts
export type ReplyPort = (text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>;
async handleCallback(update: unknown, reply: ReplyPort): Promise<boolean>; // true = processed → answerCallbackQuery
// safeReply(reply, text, keyboard?, editMessageId?) — existing text-only call sites unchanged

// payload schemas (pendingNote pattern — NO Prisma migration; BotState.state is a String column)
export const quickCapturePreviewPayloadSchema = z.object({
  body: z.string().min(1),                    // registerWithCategory's classifyMovementType input
  amount: z.number().positive(),
  note: z.string().nullable(),
  category: z.string().min(1),
  type: z.enum(["REAL", "PENDING"]).default("REAL"),
  saveToken: z.string().regex(/^[0-9a-f]{8}$/),
  shared: z.boolean().default(false),        // AD6 pattern: arrival signals survive the dialog
  override: savingsOverrideSchema.default({ kind: "none" }),
});
export const deleteConfirmPayloadSchema = z.object({
  target: z.object({ id: z.string().min(1), amount: z.number().positive(), note: z.string().nullable(),
    date: z.string().min(1), category: z.string(), occurredAtMs: z.number() }),
});

// bot-state.repository.ts
BOT_STATES += "awaiting_preview", "awaiting_delete_confirmation";

// movement-lifecycle-executor.ts — delete becomes resolve-only; window exported for the menu
type LifecycleResult = … | { status: "gated"; candidate: LifecycleCandidate }; // replaces immediate deleteById
async delete(ownerId: string, cues: LifecycleCues): Promise<LifecycleResult>;
async deleteWindow(ownerId: string): Promise<LifecycleCandidate[]>; // the 10-row all-movements window
// markPaid / markPaidById / deleteById unchanged

// bot-brain.ts — planned removed from the INPUT contract
planned: z.never().optional(),  // was z.boolean().default(false): presence → schema failure → interpret null
// ExecutionResult.planned stays (deterministic post-execution fact from prefix/button)
// executeRegistration: const effectivePlanned = planned;   // envelope.planned is gone
```

**Prompt changes** (goldens regenerated in-cycle): `INTERPRET_SYSTEM_PROMPT` drops `"planned"` from the JSON key list (:238) and the teaching line (:263); adds the fallback-first sentence ("Sos el respaldo: la captura determinística corre primero; las sugerencias de categoría se resuelven contra las categorías existentes, 'otro' es el respaldo"), the never-infer-planned sentence ("Nunca infieras 'previsto': el tipo lo decide el botón de la vista previa o el prefijo 'previsto:'"), and the delete-gate sentence ("'delete_expense' solo abre la confirmación: el borrado lo decide el botón 🗑 del dueño"). The two `"planned":true` few-shots (:285/:290) become prefix-carrier shots without the flag. `REPLY_SYSTEM_PROMPT` :386 stays (`ExecutionResult.planned` survives as a fact).

**Dialog button tails**: extract `applyCategoryCorrection(name)` (from the `resolveAwaitingCategory` exact tail) and `applyCollectCategory(name)` (from the cascade exact tails ~:1263/:1273) as private methods used by BOTH the text cascade and the `cat:` callback; the non-match sites (~:1036, ~:1354, ~:1662 + the multi-word list) render `categoryButtons(categories, page)` + `categoryButtonsReply()`. `cat:<id>` re-resolves id → name via `listCategories` at callback time (deleted → honest missing reply + re-render, state stays open; wrong state → `dialogClosedReply`).

**Stale/revalidation map** (spec bot-inline-interactions): `pv:*` after consumption → `alreadyProcessedReply`; `dc:ok` on a target deleted elsewhere → `deleteById` 404 → `movementMissingReply`; `cat:` deleted → re-render + honest missing; `cat:` on a closed dialog → `dialogClosedReply`; `editMessageText` failure → the production port falls back to a NEW message with the same text+keyboard (telegram.bot.ts wiring); unknown `data` prefix → `callbackUnavailableReply` ("acción no disponible"), no state change; unknown chat → ignored, no answer, no reply.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | `ReplyPort` type; `handleCallback` + action dispatch (m/pv/dc/dk/cat + pages); `quickCaptureParse` insert in `handleRegistration` (~:365, after the setup gate, before `tryBrainInterpret`); preview flow (enter/toggle/save/correct); delete gate in `runMovementLifecycle` + `handleLifecycleSelection` (delete pick → gate); `awaiting_preview`/`awaiting_delete_confirmation` branches in `handleUpdate` (abandon+reprocess); D6 auto-create sites → button renders + shared apply tails; `safeReply` keyboard/edit params; new payload schemas + decode helpers. |
| `apps/api/src/features/telegram/telegram.parser.ts` | Modify | `normalizeTelegramCallback`; `quickCaptureParse` (pure); `InlineButton`/`InlineKeyboard` DTO types. |
| `apps/api/src/features/telegram/telegram.bot.ts` | Modify | `bot.on("callback_query")` wiring + per-update reply port (reply/edit/answerCallbackQuery; edit-failure → new-message fallback); `startTelegramBot` (setMyCommands + start). |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | `BOT_STATES` += `awaiting_preview`, `awaiting_delete_confirmation`. |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | `menuReply`, `previewReply`, `capturePromptReply`, `pendingCapturePromptReply`, `deleteConfirmReply`, `deleteCancelledReply`, `deletePickListReply`, `categoryButtonsReply`, `alreadyProcessedReply`, `callbackUnavailableReply`, `dialogClosedReply`, `ayudaReply` (static help: "30000 gym" example, `previsto:` prefix, commands, deletes-always-confirm note). |
| `apps/api/src/features/telegram/bot-brain.ts` | Modify | `planned: z.never().optional()`; prompt/few-shot changes (D7). |
| `apps/api/src/features/telegram/telegram.commands.ts` | Modify | `menu` + `ayuda` commands; `/`-prefix and `_`-separator normalization in `parseCommand`. |
| `apps/api/src/features/telegram/movement-lifecycle-executor.ts` | Modify | `delete()` resolve-only (`gated` status); `deleteWindow` export; `deleteAskReply` gains dk buttons (service side). |
| `apps/api/src/server.ts` | Modify | Swap `bot.start()` → `startTelegramBot(bot)`. |
| `apps/api/src/scripts/cleanup-phantom-data.ts` | Modify | `--dry-run` default + `--write` flag (D14). |
| Tests: `telegram.service.test.ts`, `telegram.service.integration.test.ts`, `telegram.bot.test.ts`, `telegram.parser.test.ts`, `reply-text.test.ts`, `telegram.commands.test.ts`, `bot-brain.test.ts`, `movement-lifecycle-executor.test.ts` | Modify | Harness parallel arrays (D13); callback flows; planned-rejection cases; prompt `toContain` updates. |
| `__goldens__/` (`interpret-system-prompt.txt`, `interpret-few-shots.json`; dialog category/registration addenda+few-shots if the enumeration lines change) | Modify | Regenerated via `vitest run -u`, diff reviewed. |

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (pure) | `quickCaptureParse` (match / no-amount miss / keyword-outside-set miss); `normalizeTelegramCallback` (private chat ok, edited/group/missing-data null); `buildCallbackData` byte budget + ASCII; payload schemas (corrupt JSON → null recovery); `parseCommand` `/`+`_` forms | vitest, fakes |
| Unit (service) | Preview: parse→preview→type toggle→save exactly once→retry "ya procesado"; prefix seeds PENDING; Corregir → idle+prompt; corrupt payload → abandon to idle, nothing registers. Gate: resolve→gate→confirm/cancel/new-text/retry; executor `gated` + `deleteWindow`; `cat:` apply / deleted / closed; unknown action; `m:*` handlers; `interpret` NOT called on captured messages | harness + parallel keyboard/edit arrays |
| Integration | Against test DB: "30000 gym" → Guardar → REAL row; Previsto → PENDING INDIVIDUAL row; "borra ese gasto" → gate → 🗑 → row gone; Cancelar → row stays; retry → one row + "ya procesado"; dialog unknown answer → no new `Category` row; delete picks + category buttons end-to-end | Fastify inject + Prisma test DB |
| Bot-level (offline) | `recordApiCalls`: `sendMessage` payload carries `reply_markup`; `editMessageText` targets the source message; `answerCallbackQuery` on processed; unknown chat → zero calls; `setMyCommands` command list; edit failure → new-message fallback | `bot.handleUpdate(fakeUpdate)` + transformer |
| Goldens | Prompt/few-shot drift fails CI | Suite RED → `vitest run -u` → `git diff __goldens__` → accept only intended changes → full suite green, same change |

## Threat Matrix

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No executable/doc-like file classification introduced. |
| Git repository selection | N/A | No `git -C` / repo-selection code. |
| Commit state | N/A | No commit-state manipulation. |
| Push state | N/A | No push automation. |
| PR commands | N/A | No PR automation. |

Callback routing is application-internal (same class as the existing intent routing, which the archived change also marked N/A); no shell/subprocess/VCS/PR boundary in this change. The cleanup script remains a manually-run tsx runbook step (data safety below).

## Migration / Rollout

No Prisma migration: `BotState.state` is a String column and the new payloads ride `pendingNote` (established version contract). Stale `pendingNote` values from older versions fail the new zod decode → corrupt-payload recovery abandons to `idle` (nothing registers, nothing deletes). The reply-port signature change is additive for callers (D2). Task order: (a) pure parsers + payload schemas + `planned` rejection (RED tests first); (b) reply port + callback channel + bot wiring + setMyCommands; (c) preview + type buttons; (d) delete gate; (e) menu/help; (f) dialog buttons + auto-create removal; (g) script dry-run/write; (h) goldens regen.

Ghost cleanup runbook (post-apply, REAL DB `automatizacionrita`, never the `_test` DB): `pnpm --filter @rita/api exec tsx src/scripts/cleanup-phantom-data.ts --dry-run` → review the report (extend `PHANTOM_CATEGORY_NAMES` if the dry-run surfaces new free-text phantoms) → DB backup → `--write` → verify orphans reassigned to "otro" and explicit categories untouched.

## Open Questions

- [x] D8: should `m:prev` REMEMBER a pending intent (would require a 9th state or a payload-carrying idle and would create a third PENDING producer — currently resolved NO in favor of quick-capture's ONLY rule)? **RESUELTO POR EL DUEÑO (30/09): prefijo `previsto:` + botón `m:prev` — ambos productores sancionados. `m:prev` responde el prompt educativo (enseña el prefijo y el botón Previsto del preview); NO recuerda intento.**
- [ ] Confirmed owner id for the cleanup runbook step (carried over from the archived change's open question).
- [ ] Should the conversational mark_paid ambiguity ask also get buttons? (Currently text-only; out of the spec's scope.)
