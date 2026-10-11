# Design: Bot Hybrid UX v2 — Menu-First Deterministic Capture

## Technical Approach

Replace the conversational capture/editing surface with a button-driven state machine while keeping the deterministic executors, delete gate, save-token idempotency, callback channel, and `BotStateRepository`/`pendingNote` payload pattern. Free text never starts capture; the LLM shrinks to idle query/greeting classification. Answers the 17 delta specs (4 NEW + 13 modified), per proposal Approach 1. Chained PRs planned in sdd-tasks (E. Review Workload Guard).

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | Capture-type memory | New state `awaiting_capture`, payload `{type}` in `pendingNote` (zod) | Extending idle-side record | Spec `telegram-bot` Per-Owner State Machine enumerates it explicitly; `pendingNote` pattern survives restarts, no migration |
| D2 | `awaiting_capture` no-amount message | Re-prompt for the amount, state retained, zero LLM | Supersede + idle-route the message | Spec `telegram-bot` "No amount re-prompts" is the contract; the earlier risk phrasing ("non-capture message supersedes") is satisfied differently: no LLM ever runs in `awaiting_capture`, so nothing is trapped; every menu tap / `menu` command abandons the flow |
| D3 | Idle routing placement | `routeIdleMessage()` replaces `handleRegistration` inside `handleUpdate`; deterministic pre-checks run BEFORE `brain.interpret` | Keeping brain-first ordering | Spec `bot-free-text-routing` orders (1) pre-checks (2) LLM (3) brain-null→off_topic; code order makes the zero-LLM guarantee testable (assert `interpret` never called) |
| D4 | `query_type` in the trimmed envelope | KEEP `query_type` (enum `QUERY_TYPES`, nullable) alongside `{intent, amount, note}` | Strict `{intent, amount, note}` only | `bot-reports-menu` free-text scenarios ("cuánto ahorré este mes" → savings answer) are only expressible as `query`+`query_type`; `query_type` is NOT in the spec's MUST-NOT-accept list; the removed keys (`dialog_action`, `shared`, `planned`, `then_reassign`, `category`) are rejected via `z.never()` per spec |
| D5 | Admin name inputs | Reuse `awaiting_category_name` with a persisted `{flow}` discriminator (`preview` \| `admin_create` \| `admin_rename`) | New states per admin flow | The spec's state machine enumerates exactly 8 states; unified semantics (next text = category name through guarded `CategoryService`); payload keeps the enum stable |
| D6 | Category-delete confirmation | Stateless `ac:ok:<id>`/`ac:no:<id>` with id in the callback; guarded `deleteCategory` re-validates | Persisted `awaiting_delete_confirmation` | Spec mandates the persisted gate only for expense-admin MOVEMENT deletes; stateless keeps the enum exactly as spec'd; retry-after-delete → NotFound honest reply |
| D7 | Brain reply surface | `makeSender(true)` only for query answers + greeting; registration/correction/mark-paid/delete/category admin use fixed templates only | Current `sendLifecycleResult`/`CategoryExecutor` brain replies | Spec `telegram-bot` "LLM Branch Replies with Fixed Fallback" mandates fixed templates for all non-query outcomes |
| D8 | Legacy prefixes/CRUD text | Detection-only helpers (no stripping) → educational redirects, zero LLM | Keep stripping parsers | Spec `bot-free-text-routing` Legacy Prefix Redirect + `telegram-bot` Bot Commands (CRUD text "MUST NOT be recognized as commands") |
| D9 | Movement pick lists ≤8 rows | Paginate at 7 rows/page + `cp:<page>` nav row (10-candidate window → 2 pages) | Current 10 single-button rows | Spec `bot-inline-interactions` system-wide ≤8 rows; the current `m:del` render (10 rows) violates it — fixed in v2 |
| D10 | Dead executors | Delete `CategoryExecutor`, `mil-stance.ts`, `MovementCorrector.correct`, `MovementLifecycleExecutor.markPaid/delete` (cue paths) | Keep for reuse | v2 drives all CRUD/lifecycle via buttons + guarded services; envelope-driven executors have no callers; windows (`deleteWindow`, new `pendingWindow`, `correctionWindow`) remain |

## State Machine (spec `telegram-bot` Per-Owner State Machine)

`BOT_STATES` v2 (8): `idle, awaiting_setup, awaiting_capture, awaiting_preview, awaiting_category_name, awaiting_movement_selection, awaiting_category_selection, awaiting_delete_confirmation`. Removed: `awaiting_category, awaiting_amount_confirmation, awaiting_registration`.

| State | Payload (`pendingNote`, zod) |
|---|---|
| `awaiting_setup` | none |
| `awaiting_capture` | `{type: "REAL"\|"PENDING"\|"INGRESO"\|"COMPARTIDO"}` |
| `awaiting_preview` | `{amount, note, type, category: string\|null, saveToken}` (8-hex) |
| `awaiting_category_name` | `{flow: "preview"\|"admin_create"\|"admin_rename", preview?: PreviewPayload, categoryId?: string, from?: string}` |
| `awaiting_movement_selection` | `{action: "mark_paid"\|"delete_expense"\|"correct_category", candidates[≤10]: {id, amount, note, date}}` |
| `awaiting_category_selection` | `{movement: {id, amount, note, date}}` |
| `awaiting_delete_confirmation` | `{target: {id, amount, note, date, category, occurredAtMs}}` (unchanged) |

Key transitions (explicit + testable):

- Type menu tap (`m:new/m:prev/m:inc/m:shr`) in ANY state → abandon pending flow → `awaiting_capture{type}` + capture prompt. Zero categories at the tap → setup question + `awaiting_setup` (quick-capture "only owners past setup").
- `menu` COMMAND while any flow open → abandon to `idle` + render 8-button menu (bot-main-menu supersession; current code never touches state on commands — changed).
- `awaiting_capture` + `parseAmountAndNote ≠ null` → `awaiting_preview` (payload persisted, new saveToken); no parseable amount → re-prompt, nothing registers, zero LLM.
- `awaiting_preview` + `cat:<id>` → `category = name`, preview re-render selected (edit message). `pv:catnew:<tok>` → `awaiting_category_name{flow:preview}`; name → guarded create → back to `awaiting_preview` selected; reserved/duplicate → redirect + preview without selection.
- `awaiting_preview` + `pv:save` gated on `category ≠ null` (null → fixed ask-category reply, state stays); save → `idle` FIRST (consumption record) → register → confirmation + menu. `pv:edit` → `awaiting_capture` (same type) + capture prompt.
- `awaiting_preview`/`awaiting_category_selection` + any non-command text → abandon to `idle`, then idle-route the text (never capture).
- `awaiting_movement_selection` (`dk`/`mc`/`mp` buttons) + any non-command text → abandon → menu, nothing changed (spec movement-correction Ambiguity Resolution; no reprocessing — current text-pick `pickMovementSelection` deleted).
- `awaiting_delete_confirmation` + `dc:ok` → delete + menu; `dc:no` OR any new message → `idle`, nothing deleted.
- Corrupt payload in any state (incl. rollback leftovers of removed states) → recover to `idle` + recovery reply (`questionDroppedReply`), nothing registers/deletes; message consumed (no reprocessing). Removed-state strings fail v2 enum membership → same recovery.

## Callback Map (all ASCII, ≤64 bytes, ids never names)

| Family | Data | Handler |
|---|---|---|
| Menu (8) | `m:new` `m:prev` `m:inc` `m:shr` `m:adm` `m:cats` `m:rep` `m:help` | `handleMenuCallback` v2 |
| Expense admin | `am:del` `am:cor` `am:pay` | new `handleAdminExpenseCallback` |
| Category admin | `ac:new` `ac:ren` `ac:del`; picks `ac:rn:<id>` `ac:dl:<id>`; confirm `ac:ok:<id>` `ac:no:<id>` | new `handleAdminCategoryCallback` |
| Reports | `rep:recent` `rep:balance` `rep:month` `rep:savings` `rep:planned` | new `handleReportsCallback` (executes `QueryExecutor`, no state) |
| Preview | `cat:<id>`, `pv:save:<tok>` `pv:edit:<tok>` `pv:catnew:<tok>` | `handleCategoryPickCallback`/`handlePreviewCallback` v2 (`pv:typ` removed) |
| Movement picks | `dk:<id>` delete, `mc:<id>` correction, `mp:<id>` mark-paid | pick handlers resolving id from persisted payload |
| Reassign | `cc:<catId>` | resolves movement from `awaiting_category_selection` payload → `updateMovement` |
| Delete gate | `dc:ok:<id>` `dc:no:<id>` | unchanged `handleDeleteGateCallback` |
| Pagination | `cp:<page>` | re-renders the open keyboard (preview / pick list / reassign row) from state+payload |

Unknown prefix → `callbackUnavailableReply()`, no state change. Sub-menu chains: `am:del` reuses `deleteWindow`→`dk`→gate (as-is); `am:cor` → `correctionWindow` (10 recent non-PENDING) → `mc` → `awaiting_category_selection` → `cc` → reassign + menu; `am:pay` → `pendingWindow` (PENDING list) → `mp` → `markPaidById` (409 → already-paid notice) + menu. `ac:*` chains funnel through guarded `CategoryService`; pick lists render NORMAL categories only (no "otro"/"ahorro" — `type === "NORMAL"` && name ≠ "otro").

## Idle Routing Pipeline (`routeIdleMessage`, replaces `handleRegistration`)

```
non-command owner message, state idle (or after flow-abandon):
 0. Setup gate: zero categories → setup question + awaiting_setup (no parser, no interpret)
 1. Legacy-prefix text (previsto:/compartido:/gasto previsto/sin ahorro/con X%) → prefix-specific redirect + menu  [zero LLM]
 2. Capture-shaped text (parseAmountAndNote ≠ null) → "mandalo desde ➕ Nuevo gasto" redirect + menu          [zero LLM]
 3. Legacy text CRUD (registrar/renombrar categoria:, asociar palabra:) → 🗂 redirect + menu                  [zero LLM]
 4. brain?.interpret(message) → null|off_topic → "no puedo resolver eso" + menu; help → static help + menu
    query* → deriveQueryType → QueryExecutor → brain reply verbatim | queryReplyTemplate + menu
    greeting → brain reply | greetingReply + menu
```

Every idle reply ends with the menu tail (`sendMenu`). RED tests assert `interpret` is never invoked for steps 1–3.

## Brain Shrink (`bot-brain.ts`)

- `BOT_INTENTS` 19 → 8: `query, query_recent, query_balance, query_month, query_planned, greeting, off_topic, help`. (Exploration said 18; actual count is 19 — 11 removed.)
- `ConversationEnvelope` = `{intent, amount, note, query_type?}`; schema drops `category`/`new_name`; `z.never()` on `dialog_action`, `then_reassign`, `shared`, `planned` (presence → degrade to null); removed intents fail the enum. Refine: `query` requires `query_type`.
- `InterpretContext` → vestige `{state: "idle"}`; port signature keeps optional `context?` per spec; service never passes it. DELETE `DIALOG_INTERPRET_ADDENDUM`, `DIALOG_FEW_SHOTS`, `renderDialogContext`.
- `INTERPRET_SYSTEM_PROMPT` rewritten (three-intent taxonomy, strict JSON keys, never invent amounts, off-topic never general chat, never create categories / infer capture types / decide destructive actions; capability questions → `help`). `FEW_SHOTS` trimmed to query/greeting/off-topic samples incl. `query`+`savings`. `REPLY_SYSTEM_PROMPT` shrinks to `answered` (query facts) + `greeting` + ok:false message passthrough.
- `ExecutionResult` shrinks to query/greeting facts `{intent, ok, action: answered|none|redirected, amount, note, query_type?, query?, message?}`.
- Goldens: regenerate `interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt` in the same change; DELETE the 7 dialog golden files. Offline (`GROQ_API_KEY` unset): brain never constructed; step 4 degrades to the off_topic fallback.

## Command Surface

- `parseCommand` keeps: `menu, start, ayuda, list (listar categorias), configurar, savings-rule, savings-rule-invalid`. Removes `register/rename/associate` types → detected by `parseLegacyCategoryCrud(text)` (same regexes) as idle pre-check 3. `parseSetupBatchCommand` unchanged (setup legacy batch stays per spec).
- `BOT_COMMANDS`/`setMyCommands` unchanged (already exactly `menu, ayuda, listar_categorias, configurar_categorias`); `telegram.bot.ts` needs no change.
- `handleCommand`: `menu/start` now abandon any pending flow before rendering; CRUD cases deleted; `savings-rule` stays as the rule-definition channel; `configurar` stays for batch onboarding.

## Capture & Savings Data Flow

```
tap ➕ Ingreso (m:inc) ──→ awaiting_capture{INGRESO} ──"1000 entrenuts"──→ awaiting_preview
  │ tap "Sueldo" (cat:<id>) ──→ category selected ── tap pv:save ──→ idle FIRST
  └→ resolveSplit(note, {kind:"none"}) ── split? ──→ createIncomeWithSavings (net INCOME + SAVINGS "ahorro", one transaction)
                                    └─ no rule ──→ createMovement(INCOME, PAID, INDIVIDUAL)
→ fixed confirmation (gross/net/saved or standard) ──→ sendMenu
```

Type→movement mapping (money-movements, no new enums): REAL→`EXPENSE+PAID+INDIVIDUAL`; PENDING→`EXPENSE+PENDING+INDIVIDUAL`; INGRESO→`INCOME+PAID+INDIVIDUAL` (+split); COMPARTIDO→`EXPENSE+PAID+SHARED` (persisted via existing `createExpense` `visibility` option). COMPARTIDO never splits; overrides removed (rule always applies). `registerIncomeSplit` keeps the visibility passthrough (SHARED inheritance stays satisfied for pre-existing shared incomes); the bot only ever passes INDIVIDUAL. `classifyMovementType`/`matchNote`/`listKeywordRules`/`ensureOtro` no longer called by any bot path (data intact for the dashboard/webhook).

## File Changes

| File | Action | Function-level detail |
|---|---|---|
| `apps/api/src/features/telegram/telegram.service.ts` | Modify (major) | DELETE ~1200 lines: `handleRegistration`, `deterministicRegistration`, `executeRegistration`, `askAmountConfirmation`, all `d6*`/`resolve*`/`awaitingRegistration*` dialog handlers, `handleDialogMessage`, `buildInterpretContext`, `registerOtroWithCorrection`, `answerCorrection`, `applyCategoryCorrection/CollectCategory`, `renderCategoryButtons/renderCollectCategoryButtons`, `handleMovementSelection`, `pickMovementSelection`, `resolveSuggestion`, `runMovementCorrection`, `runMovementLifecycle`, `executeCategoryCommand(+WithReassign)`, `sendCapabilities`, `decodeConfirmationPayload/decodeCollectPayload/decodeMovementSelectionPayload`, guard-answer sets, `isMilStance` import. ADD: `routeIdleMessage`, `startCapture`, `handleAwaitingCaptureMessage`, `enterPreview`/`renderPreview` (5 cats/page + ➕ + actions + `cp:`), `savePreview`, `handleAwaitingCategoryName`, `handleAwaitingPreviewText` (abandon+route), sub-menu handlers (`am:*`, `ac:*`, `rep:*`, `mc/mp/cc` picks), `adminDeleteCategory` (stateless confirm), `normalizeState` recovery, `categoryKeyboard` v2 (NORMAL only), pick-list pagination. MODIFY: `handleUpdate` (v2 state machine), `dispatchCallback` (families), `handleMenuCallback` (8 buttons + type taps + setup gate), `sendMenu` (8), `handlePreviewCallback` (save/edit/catnew + category gate), `handleCategoryPickCallback` (`cat:`/`cp:` for preview+reassign), `handleCommand` (trim + menu abandons), `handleSetupReply` (remove `ensureOtro`), `registerWithCategory` → `registerCapture(amount, note, type, category)` (mapping table above), `registerIncomeSplit` (INDIVIDUAL + menu tail), `handleDeletePickCallback`/`handleDeleteGateCallback` (unchanged, re-entered from `am:del`) |
| `apps/api/src/features/telegram/telegram.parser.ts` | Modify | `quickCaptureParse` → `captureParse(text): {amount, note}\|null` (no keyword matching); DELETE `parseArrivalPrefixes`/`parseSharedPrefix`/`parseSavingsOverride` (→ detection-only `legacyPrefixKind(text): "previsto"\|"compartido"\|"savings-override"\|null`); keep `normalizeTelegramMessage/Callback`, `buildCallbackData`, InlineKeyboard DTOs |
| `apps/api/src/features/telegram/bot-brain.ts` | Modify | Per Brain Shrink section |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | ADD: `previewAskCategoryReply`, `captureShapedRedirectReply`, `previstoPrefixRedirectReply`, `compartidoPrefixRedirectReply`, `savingsOverrideRedirectReply`, `categoryCrudRedirectReply`, `unresolvableReply`, `categoryNamePromptReply`, `categoryDeleteConfirmReply`, `selectionAbandonedReply`, v2 `previewReply`/`greetingReply`/`ayudaReply`. DELETE: dialog/collect/otro-correction texts (`askAmountReply`, `askCategoryReply`, `keptCollectingReply`, `collectAbandonedReply`, `amountConflictReply`, `amountConfirmationAbandonedReply`, `correctionOfferReply`, `categoryFollowUpReply`, `otroKeptReply`, `categoryButtonsReply`, `dialogClosedReply`, `categoryNotFoundReply`, `correctionAbandonedReply`, `movementAmbiguousReply`, `movementNoReferenceReply`, `pendingCapturePromptReply`, `plannedSharedRejectedReply`, `savingsOverrideInvalidReply`, `offTopicRedirectReply`, `capabilitiesSummaryReply`, `associateKeywordRedirectReply`, `keywordAssociatedReply`, `categoryCommandReplyTemplate`), `reservedCategoryReply` prefix wording updated to button flows. KEEP: `successReply`, `plannedReply`, `successSplitReply`, query templates, lifecycle/delete-gate texts, setup texts, category CRUD fixed replies, `savingsRule*` texts, `formatARS`, `menuReply` |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | `BOT_STATES` → the 8 v2 values |
| `apps/api/src/features/telegram/telegram.commands.ts` | Modify | Command types trimmed; ADD `parseLegacyCategoryCrud`; `parseSetupBatchCommand` unchanged |
| `apps/api/src/features/telegram/telegram.bot.ts` | Unchanged | `BOT_COMMANDS` already matches the spec'd 4 |
| `apps/api/src/features/telegram/movement-lifecycle-executor.ts` | Modify | ADD `pendingWindow(ownerId)`; DELETE cue-driven `markPaid`/`delete`; keep `deleteWindow`, `markPaidById`, `deleteById` |
| `apps/api/src/features/telegram/movement-corrector.ts` | Modify (shrink) | Keep only `correctionWindow(ownerId)` (10 recent non-PENDING); DELETE `correct`, `score`, `resolveTargetCategory` |
| `apps/api/src/features/telegram/category-executor.ts` + test | Delete | No envelope-driven CRUD callers |
| `apps/api/src/features/telegram/mil-stance.ts` + test | Delete | Only used by removed amount-conflict path |
| `apps/api/src/features/telegram/query-executor.ts`, `query.types.ts`, `app.ts` | Unchanged | All 6 query types exist; brain wiring already optional |
| `apps/api/src/features/telegram/__goldens__/` | Modify | Regenerate 3 base goldens; delete 7 dialog goldens |
| `apps/api/src/features/telegram/*.test.ts` | Modify (major) | See Testing Strategy |

## Testing Strategy (strict TDD — `apply.tdd: true`)

| Layer | What | Approach |
|---|---|---|
| Unit | Parsers/detectors, commands, BOT_STATES, reply templates, brain schema/prompts (goldens byte-match), preview keyboard limits (5 cats + ➕ + actions + nav ≤ 8 rows, ≤64 bytes), windows (`pendingWindow`, `correctionWindow`) | vitest, offline `recordApiCalls` harness; RED first per work unit |
| Unit (service) | State machine transitions + supersession + corrupt/removed-state recovery; capture chain zero-LLM (`interpret` never called for pre-checks/awaiting_capture); idle routing order; sub-menu chains; savings split on INGRESO; COMPARTIDO mapping; menu tail | Rewrite `telegram.service.test.ts` (239), `telegram.service.savings.test.ts`, `bot-brain.test.ts` (117), `reply-text.test.ts` (90), `telegram.parser.test.ts` (45), `telegram.commands.test.ts`, `telegram.bot.test.ts` (19) |
| Integration | Full capture chains, sub-menu chains against real services, delete gate, dedup, household visibility | `app.inject` + Prisma on `automatizacionrita_test` (localhost:5433); rewrite `telegram.service.integration.test.ts` + household integration |

Test-impact: ~679 existing telegram tests encode removed flows (prefixes, keyword inference, otro+correction dialogs, type toggle, LLM capture fallback, text CRUD) — rewritten per unit, not bulk-deleted. Goldens regenerated with the prompt-trim unit (same change, spec bot-brain Prompt Contract).

**Strict-TDD work ordering** (each unit RED→GREEN→REFACTOR, `pnpm --filter @rita/api test` after each):
1. Pure units: `captureParse` + prefix detectors (`telegram.parser`), `telegram.commands` trim + `parseLegacyCategoryCrud`, `BOT_STATES`, `reply-text` v2 templates.
2. Brain shrink: intents/envelope/schema/prompts/few-shots + golden regeneration (one commit; CI green).
3. State machine + capture chain: `handleUpdate` v2, `m:*` type taps (setup gate), `awaiting_capture`→`awaiting_preview`, `cat:`/`pv:catnew`/`awaiting_category_name`/`pv:save` gate/`pv:edit`, recovery paths.
4. Money flows: `registerCapture` mapping (REAL/PENDING/INGRESO/COMPARTIDO) + savings split + menu tails.
5. Idle routing: `routeIdleMessage` pre-checks (zero-LLM REDs), setup-gate precedence, brain classification paths, menu tail.
6. Sub-menus: `am:del` (reuse) + `am:cor` + `am:pay` (windows + picks + pagination); `ac:*` admin chains; `rep:*` reports.
7. Command surface: `handleCommand` trim, `menu` command supersession, `ayuda` rewrite, `handleSetupReply` `ensureOtro` removal.
8. Regression: full suite + `tsc --noEmit` + eslint; golden byte-match; integration pass.

## Threat Matrix

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No executable/file classification — Telegram UX only |
| Git repository selection | N/A | No git/shell interaction in this change |
| Commit state | N/A | Same |
| Push state | N/A | Same |
| PR commands | N/A | Same |

No routing/shell/subprocess/VCS/PR/executable-classification/process-integration boundary exists; the only "routing" is in-app Telegram message/callback dispatch, protected by the existing chat gate, dedup record, callback prefix dispatch, and corrupt-payload recovery (unchanged).

## Migration / Rollout

No Prisma migration (payloads stay in `BotState.pendingNote` as zod-validated JSON). Rollback = revert the deploy commit: old code reads persisted v2 states as unknown strings → falls through to legacy idle capture; new-code leftovers in removed states recover to `idle` generically. No external consumers.

## Open Questions

- [ ] Exact preview/help/greeting wording strings — apply-phase detail within the spec'd fields (amount, note, type label, category).
- [ ] `help`-classified idle reply menu tail (help text + menu vs. help only) — design assumes menu tail per the universal rule; confirm in tasks.
