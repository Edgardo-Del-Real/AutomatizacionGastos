# Exploration — bot-hybrid-ux-v2

**Change**: `bot-hybrid-ux-v2`
**Date**: 2026-09-30
**Input**: Product-owner redesign of the Telegram bot conversational flow (authoritative; supersedes the archived `2026-09-30-bot-hybrid-ux` behavior).
**Artifact store**: hybrid (OpenSpec + Engram)

---

## Executive Summary

- The current bot is **hybrid but still "descajetado"**: capture falls back to the LLM (and even to an ask-amount dialog) when the deterministic keyword parser misses, which is exactly how "14000 pasaje" ends up re-asking the amount (`telegram.service.ts:989-1031` — `handleRegistration` → `quickCaptureParse` miss → `tryBrainInterpret` → possibly `register_expense(amount:null)` → collect dialog). The owner's redesign removes this entire failure class.
- The redesign is a **menu-first, deterministic-capture, buttons-everywhere** model: free text never starts capture, prefixes/keywords/category-in-message are eliminated, the preview becomes the single capture surface (amount+note → category buttons → save), editing moves into sub-menus, and the LLM is reduced to query/greeting classification only.
- Most infrastructure is **reusable as-is**: callback channel (`telegram.bot.ts`, `telegram.parser.ts`), `BotStateRepository`, `QueryExecutor`, `CategoryExecutor`, `MovementLifecycleExecutor` (delete window, mark-paid window, by-id executions), save-token idempotency, delete confirmation gate, `ReplyPort` keyboard/edit port, and the guarded `CategoryService`.
- The dominant cost is **test rework**: the telegram feature alone holds **679 tests** (`telegram.service.test.ts` 239, `bot-brain.test.ts` 117, `reply-text.test.ts` 90), almost all encoding the flows being removed (prefixes, keyword inference, "otro"+correction dialogs, type-toggle preview, LLM capture fallback, text category CRUD).
- **Open product questions must be resolved before spec**: income registration and savings rules have no home in the 6-button menu; the `compartido:` (shared) flag is dropped with the prefixes; and free-text "monto+nota" is deliberately refused ("no puedo resolver eso" + menu) — a visible behavior change that must be spec'd explicitly.

---

## Current State Map (file/line evidence)

### Entry and routing
- `/start`, `/menu`, `/ayuda`, `/listar_categorias`, `/configurar_categorias` commands: `telegram.commands.ts:42-105`; handled in `telegram.service.ts:2842-2955` (`handleCommand`). `/start` and `/menu` render the 5-button menu (`sendMenu`, `telegram.service.ts:562-575`).
- **Free text in idle DOES start capture**: `handleUpdate` (`telegram.service.ts:333-439`) → any non-command message → prefix strip (`parseArrivalPrefixes`, `telegram.parser.ts:127-158`) → savings-override strip (`parseSavingsOverride`, `telegram.parser.ts:174-191`) → `handleRegistration` (`telegram.service.ts:438`).
- Setup gate: an owner with zero categories is forced into `awaiting_setup` before any routing (`handleRegistration`, `telegram.service.ts:1001-1010`).

### Capture (current, being replaced)
- Deterministic-first: `quickCaptureParse` (`telegram.parser.ts:42-52`) = `parseAmountAndNote` + **keyword-rule category inference** (`matchCategory` against `listKeywordRules`). On match → `enterQuickCapturePreview` (`telegram.service.ts:651-679`) with payload `{amount, note, category, type, saveToken}`.
- On miss → **LLM fallback**: `tryBrainInterpret` → `routeEnvelopeIntent` → `executeRegistration` (`telegram.service.ts:1023-1030`, `1179-1308`). The brain can still produce `register_expense(amount:null)` → collect dialog asking the amount (`askAmountReply`), the amount-conflict dialog (`askAmountConfirmation`, `:1311-1344`), or category suggestion resolved via `matchNote`/`resolveSuggestion`.
- "otro" fallback: unmatched amounts register in "otro" then open `awaiting_category` with a text/button correction offer (`registerOtroWithCorrection`, `telegram.service.ts:3048-3104`).
- Preview keyboard: `[✅ Guardar] [✏️ Corregir]` + **Real/Previsto toggle row** (`previewKeyboard`, `telegram.service.ts:682-695`; callbacks `pv:save/pv:edit/pv:typ`, `:601-648`). Type is toggleable in the preview today — the redesign removes this.
- Menus `m:new`/`m:prev` (`:501-510`) only reply with prompts (`capturePromptReply`/`pendingCapturePromptReply`) and **remember no intent** — the type is not carried to the next message today.

### Editing / lifecycle (current, partially reused)
- Delete: menu `m:del` → `movementLifecycleExecutor.deleteWindow` (last 10, `movement-lifecycle-executor.ts:170-176`) → `dk:<id>` pick (`handleDeletePickCallback`, `telegram.service.ts:790-855`) → persisted `awaiting_delete_confirmation` gate → `dc:ok/dc:no` (`:732-774`) → `deleteById` + menu. **"As today, OK" per the owner — reuse as-is.**
- Mark paid / delete / correct via text: LLM intents `mark_paid`, `delete_expense`, `correct_category` → `runMovementLifecycle` (`:2447-2514`) / `runMovementCorrection` (`:2606-2675`), with ambiguity asks (`awaiting_movement_selection` + `pickMovementSelection`, `:2787-2816`). These deterministic executors are reusable; the *entry* moves from free text to buttons.
- Category CRUD via text: `CategoryExecutor` (`category-executor.ts:29-40`) driven by LLM intents `create_category/delete_category/rename_category` and by text commands (`registrar categoria:`, `renombrar categoria:`, `borrar categoria:`, `configurar categorias` batch, `telegram.commands.ts:15-24`, `handleSetupReply` `:1504-1593`).

### Reports (current, partially reused)
- `m:rep` executes the recent query directly (`executeRecentQuery`, `telegram.service.ts:578-598`). Free-text queries via LLM `query`/`query_*` intents → `QueryExecutor` (`query-executor.ts:23-38`) supporting `categories|recent|balance|month|savings|planned` → `queryReplyTemplate` (`reply-text.ts:308-323`).

### LLM (current, being shrunk)
- `GroqBotBrain` (`bot-brain.ts:513-600`): `interpret` over `BOT_INTENTS` (18 intents, `:4-24`) + per-dialog addenda/few-shots (`:394-499`); `reply` renders executed results. Wired in `app.ts:60-65` (absent when `GROQ_API_KEY` unset → deterministic-only).

### Persisted bot state
- `BOT_STATES` enum (`bot-state.repository.ts:3-12`): `idle, awaiting_setup, awaiting_category, awaiting_amount_confirmation, awaiting_movement_selection, awaiting_registration, awaiting_preview, awaiting_delete_confirmation`. Payloads live in `BotState.pendingNote` as zod-validated JSON (no Prisma migration) — the same pattern extends to new states.

### Main specs in force (will need delta updates)
`openspec/specs/`: `bot-main-menu` (5 buttons), `quick-capture` (keyword-category parser + type-by-button), `bot-inline-interactions` (callback routing), `telegram-bot` (states/routing/dedup), `conversational-categories` (closed-set buttons), `registration-collection` (collect dialog), `movement-correction`, `bot-expense-lifecycle` (delete gate), `planned-fixed-expenses`, `money-movements`, `savings`, `movement-categories`.

---

## Gaps vs. Target (redesign requirements → delta surface)

| # | Redesign requirement | Current state | Gap |
|---|---|---|---|
| 1 | Entry: /start always shows menu; free text never starts capture | /start shows menu, but idle free text routes to capture (`telegram.service.ts:438`) | Remove idle→capture; new idle classifier (query/greeting/other) |
| 2 | Main menu: exactly 6 buttons (➕ Nuevo gasto, 📅 Gasto previsto, 🗂 Administrar categorías, 🧾 Administrar gastos, 📊 Reportes, ❓ Ayuda) | 5 buttons (`telegram.service.ts:562-575`; `bot-main-menu` spec) | Add 🗂 and 🧾; replace Borrar→Administrar gastos and Reporte→Reportes |
| 3 | Capture: only `monto+nota`; no prefixes, no category in message; type chosen in menu, not message/preview | Prefixes stripped (`telegram.parser.ts:127-191`); keyword category inference; preview type toggle (`pv:typ`) | Remove prefixes/keyword inference/type toggle; **remember capture type between menu tap and next message** (new state) |
| 4 | Preview ALWAYS: "¿Guardamos? $ 14.000 (pasaje)" + category buttons (existing only, NO "otro") + ➕ Crear categoría; Guardar only after category chosen; [✅ Guardar] [✏️ Corregir] | Preview shows pre-resolved category + type toggle; Guardar not category-gated | Preview category selection (mandatory) + gated Guardar; category row without "otro"; ➕ button |
| 5 | Create category from preview: ➕ → name → create → back to preview with it selected | No such flow (closest: `then_reassign` chain `:2571-2598`) | New state for name input during preview; re-render preview with selected category |
| 6 | Category never inferred; keywords out for now | `matchCategory`/`matchNote` in capture (`telegram.parser.ts:42-52`, `telegram.service.ts:1143/1167/1213/1267`) | Remove keyword usage from capture path (keep data model for later) |
| 7 | Every completed action returns to menu | Only registration/delete return (`telegram.service.ts:3038-3040`, `:762/773`) | Universal post-action menu |
| 8 | Delete: Administrar gastos → last-10 buttons → confirm → delete + menu | Already exists via `m:del`→`dk`→`dc` | Re-route entry to sub-menu (reuse as-is) |
| 9 | Administrar gastos sub-menu: Borrar / Corregir categoría / Marcar pagado (button-driven) | Text/LLM-driven correction & mark-paid (`runMovementCorrection`/`runMovementLifecycle`); delete via button | New sub-menu + button-pick chains for correction (movement pick → category pick) and mark-paid (PENDING pick → execute) |
| 10 | Reportes sub-menu: Últimos / Saldo / Resumen mes / Ahorro mes / Previstos + free-text LLM | `m:rep` runs recent only; free text works | New 5-button sub-menu mapping to `QueryExecutor` types |
| 11 | Non-capture message: query→LLM, greeting→greet+menu, else "no puedo resolver eso"+menu | `off_topic`/`greeting`/`help` replies without menu (`telegram.service.ts:2379-2396`) | Idle classifier + menu tail; new "no puedo resolver eso" text |
| 12 | LLM only for queries and greetings | Brain covers 18 intents incl. capture/editing fallback | Shrink brain surface; trim prompts/few-shots/goldens |
| 13 | Ayuda: menu explained + real examples | `ayudaReply` explains prefixes/commands (`reply-text.ts:347-360`) | Rewrite for 6-button menu + examples ("30000 gym" / "Gasto previsto") |
| 14 | Administrar categorías: buttons + minimal text (create/rename/delete) | Text commands + `/configurar` batch + LLM CRUD | New button-driven admin flow via `CategoryExecutor` |

---

## Reusable Pieces (keep)

- **Callback infrastructure**: `normalizeTelegramCallback`/`buildCallbackData`/`InlineKeyboard` (`telegram.parser.ts:12-100`), `dispatchCallback` switch (`telegram.service.ts:469-495`), `ReplyPort` with keyboard+edit (`telegram.service.ts:119`, `telegram.bot.ts:50-65`), offline `recordApiCalls` harness (`telegram.bot.ts:24-29`).
- **`BotStateRepository` + `pendingNote` payload pattern** (`bot-state.repository.ts`) — extend with new states/payloads, no migration.
- **`MovementLifecycleExecutor`** (`movement-lifecycle-executor.ts`): `deleteWindow` (last-10), `markPaid` PENDING window (`:109-139`), `markPaidById`/`deleteById` — feed the new sub-menu lists and executions.
- **`pickMovementSelection`** (`telegram.service.ts:2787-2816`) — candidate-pick resolution; reusable for correction/mark-paid picks.
- **Delete gate** (`dc` + `DeleteConfirmPayload`, `telegram.service.ts:284-295, 732-774`) — keep as the confirmation pattern; extend the same token/idempotency idea to new gates.
- **Save-token idempotency** (`newSaveToken`, `:153-157`; `pv:save` gate `:613-619`) — reuse for gated Guardar after category selection.
- **`CategoryExecutor`** (`category-executor.ts`) — guarded create/delete/rename with result shaping; reuse for Admin categorías and preview ➕.
- **`QueryExecutor` + `query.types` + `queryReplyTemplate`** — reuse for the Reportes sub-menu (all 5 query types already implemented).
- **`CategoryService`/`CategoryRepository` guards** (`categories.service.ts`) — `createCategory` reserved/duplicate handling, `ensureOtro`/`ensureAhorro` for legacy invariants.
- **Amount parsing** (`message.parser.ts` `parseAmountAndNote`/`extractNote`/`parseAmount`) — keep for `monto+nota` capture; drop the keyword-category glue.
- **`GroqBotBrain` transport** (`bot-brain.ts:513-600`) — keep, but only for query/greeting intents (and the reply renderer for queries).

## Must Remove / Change

- `parseArrivalPrefixes` + `parseSharedPrefix` + `parseSavingsOverride` usage in `handleUpdate` (`telegram.parser.ts:108-191`, `telegram.service.ts:370-393`) — prefixes (`previsto:`/`compartido:`/`sin ahorro`/`con X%`) eliminated. Decide: hard-remove vs. refuse-with-redirect for legacy messages.
- `quickCaptureParse` keyword-category inference (`telegram.parser.ts:42-52`) — replaced by a parser yielding `{amount, note}` only.
- Preview type toggle `pv:typ` + `previewKeyboard` type row (`telegram.service.ts:630-644, 682-695`) — type comes from the menu tap.
- "otro" + text-correction flow: `registerOtroWithCorrection`, `awaiting_category`, `KEEP_OTRO_ANSWERS`/`CATEGORY_AFFIRM_ANSWERS` (`telegram.service.ts:297-312, 1595-1706, 3048-3104`) — eliminated; category is mandatory at preview.
- Collect dialog: `awaiting_registration` + `COLLECT_ABANDON_ANSWERS` (`telegram.service.ts:196-206, 1714-2012`) and amount-conflict dialog `awaiting_amount_confirmation` (`:1311-1344`) — no LLM amount to conflict with; capture is one-shot.
- LLM capture/editing fallback: `executeRegistration` brain paths (`:1179-1308`), `runMovementCorrection` text entry, `runMovementLifecycle` text entry, text category CRUD (`handleCommand` `register/rename/associate`, `telegram.commands.ts:15-24`) — editing becomes button-driven.
- `matchNote`/`listKeywordRules` calls in capture paths (`telegram.service.ts:1143, 1167, 1213, 1267`; `associate keyword` intent) — keywords not used by the bot "for now".
- Brain intents beyond query/greeting: trim `BOT_INTENTS`, `INTERPRET_SYSTEM_PROMPT`, `FEW_SHOTS`, dialog addenda; regenerate `__goldens__`.
- `pendingCapturePromptReply` prefix teaching (`reply-text.ts:72-74`), `helpReply`/`ayudaReply` prefix content, `reservedCategoryReply` prefix wording (`:173-187`).

## Missing (to build)

- **Capture-type memory**: menu tap (➕/📅) must persist an expected type (REAL/PENDING) so the next `monto+nota` message opens the preview with that type (new state, e.g. `awaiting_capture` with `{type}` payload, or extend an existing idle-side record).
- **Preview category selection**: payload `{amount, note, type, category: null|name, saveToken}`; keyboard = category buttons (`cat:<id>`-style, no "otro") + ➕ Crear categoría + `[✅ Guardar] [✏️ Corregir]`; Guardar only enabled/executes once a category is selected (idempotent gate).
- **Create-category-from-preview**: new state for the category name input; on name → `CategoryExecutor.create` (reserved/duplicate guards) → re-render preview with the new category selected.
- **Administrar gastos sub-menu** + button chains: Borrar (reuse), Corregir (movement list pick → category list pick → `updateMovement`), Marcar pagado (PENDING list pick → `markPaidById`).
- **Administrar categorías sub-menu**: Crear/Renombrar/Borrar with minimal text prompts → `CategoryExecutor`.
- **Reportes sub-menu**: 5 buttons → `QueryExecutor` types (recent/balance/month/savings/planned) → `queryReplyTemplate`.
- **Idle classifier**: free text → LLM (query/greeting/off_topic only) → query answer / greet+menu / "no puedo resolver eso"+menu; deterministic fallback when no brain (heuristic or fixed "no puedo resolver eso"+menu).
- **Universal post-action menu tail** and rewritten `menuReply`/`ayudaReply`/capture prompts.

---

## Approaches

1. **Full redesign in one change (recommended by the owner's "redesign from scratch")**
   - One SDD change, delta specs across `bot-main-menu`, `quick-capture`, `telegram-bot`, `bot-inline-interactions`, `conversational-categories`, `registration-collection`, `movement-correction`, `bot-expense-lifecycle`, `savings`; implementation replaces the capture/edit surface while keeping executors.
   - Pros: coherent UX contract; single verify; no intermediate half-states (the current hybrid is already the "broken intermediate").
   - Cons: large diff → 400-line review budget risk → must plan chained PRs (`delivery_strategy`); 679 tests reworked in one cycle.
   - Effort: High.

2. **Two-slice change (capture first, then sub-menus)**
   - Slice A: menu entry + capture (items 1-7, 13) deterministic preview. Slice B: sub-menus + LLM shrink (8-12, 14).
   - Pros: smaller PRs; capture bug ("14000 pasaje") fixed earlier.
   - Cons: owner asked for the full cycle this session; two archive/verify cycles; LLM surface stays fat during slice A.
   - Effort: High (split).

3. **Minimal patch of the current hybrid** (keep prefixes/keywords; fix only the ask-amount bug)
   - Pros: cheapest.
   - Cons: contradicts the authoritative redesign; keeps the fragile LLM-in-capture path and the "otro" flow the owner explicitly eliminated. Rejected.

**Recommendation**: Approach 1 with chained PRs planned in `sdd-tasks` (delivery strategy `auto-chain`/`ask-on-risk`): the redesign is a coherent contract and the owner committed to the full cycle this session. Preserve the deterministic executors as the shared backbone so both slices share code.

---

## Risks

- **CRITICAL — Test rework scope**: 679 telegram tests (`telegram.service.test.ts` 239, `bot-brain.test.ts` 117, `reply-text.test.ts` 90, `telegram.parser.test.ts` 45, `telegram.bot.test.ts` 19, integration 63, executors ~70) encode removed behavior (prefixes, keywords, otro+correction, dialogs, type toggle, text CRUD). Strict TDD will rewrite a large fraction; goldens (`__goldens__/`) must be regenerated.
- **CRITICAL — Product holes in the 6-button menu**: income registration and savings rules (`registerIncomeSplit`, `registrar ahorro:`) have no entry point; `compartido:` (shared) is dropped with the prefixes. Must be resolved in proposal/spec or flagged as deferred with dead-code removal.
- **CRITICAL — Free-text refusal is a visible behavior change**: "14000 pasaje" (and any amount text) will now get "no puedo resolver eso" + menu. Intended by the owner, but MUST be a spec'd scenario with an educational redirect (e.g., hint "mandalo desde ➕ Nuevo gasto") so it reads as guidance, not regression.
- **WARNING — Capture-type memory state**: the type chosen in the menu must survive to the next message; stale "awaiting capture" must not trap queries/greetings (soft intent, superseded by any non-capture message). New state + recovery rules needed.
- **WARNING — "otro" legacy data**: `ensureOtro` keeps the reserved "otro" category; old movements stay in "otro"; preview must exclude it; Admin categorías must forbid deleting it (reserved guard already does).
- **WARNING — LLM shrink correctness**: trimming `BOT_INTENTS`/prompts/few-shots must keep query vs greeting vs off-topic classification robust (the only three idle intents); regression risk in `bot-brain.test.ts`.
- **INFO — Keyboard limits**: category row + ➕ + Guardar/Corregir must respect ≤8 rows / ≤64 bytes (`buildCallbackData` enforces bytes); reuse `cp:` pagination for large category sets.
- **INFO — Review budget**: the change exceeds 400 authored lines; `sdd-tasks` must forecast and chain PRs.
- **INFO — Persisted-payload compatibility**: old `pendingNote` payloads (preview/collect/confirmation) survive restarts; corrupt-payload recovery paths (`decode*` → null) already handle them; new states must keep the same recovery discipline.

---

## Open Questions (for proposal/spec)

1. **Income**: does the bot capture incomes in v2? No button exists (only Nuevo gasto / Gasto previsto). If not: remove/neutralize `registerIncomeSplit` + savings-rule bot surface? Keep `registrar ahorro:` command?
2. **Shared (`compartido:`)**: dropped entirely this iteration (no prefix, no button)? Existing shared movements remain readable via queries?
3. **Savings overrides** ("sin ahorro"/"con X%"): removed with the other prefixes — confirm.
4. **Free-text capture-shaped messages**: strictly "no puedo resolver eso" + menu, or a friendlier redirect teaching the menu button (recommended)? Needs an explicit scenario.
5. **Legacy prefixes after deploy** (`compartido:`/`previsto:` messages): refuse with an educational redirect to the new flow, or silently treat as plain text?
6. **"otro"**: stop calling `ensureOtro` for new owners (category now mandatory at preview), keeping it only as a legacy reserved row?
7. **New-owner setup gate** (`awaiting_setup`): replaced by the preview ➕ flow (categories can be created on first capture)? Or keep `/configurar` for batch onboarding?
8. **Old dialog states** (`awaiting_category`, `awaiting_registration`, `awaiting_amount_confirmation`): fully removed, or kept as corrupt-payload recovery only?
9. **Keyword data**: keep `associateKeyword`/`listKeywordRules` untouched for the dashboard, removing only bot usage?
10. **Menu idempotency**: reopening the menu mid-flow (e.g., during preview) — abandon the preview or keep it? (Current: `m:new`/`m:prev` don't touch state; new "capture type memory" must define the interaction.)

---

## Resolved Product Decisions (owner, 2026-09-30)

1. **Income**: dedicated menu button (➕ Ingreso). Same monto+nota → preview flow with category, but type INGRESO; triggers the automatic savings rule (% set aside by the pre-defined savings rule).
2. **Compartido**: menu button that starts shared-expense capture — tap Compartido → monto+nota → preview with type COMPARTIDO (same mechanics as Nuevo gasto).
3. **Savings**: NO button — automatic % applied on each INCOME receipt per the user-defined savings rule.
4. **Free-text with capture shape** ("14000 pasaje"): friendly educational redirect (e.g. "mandalo desde ➕ Nuevo gasto"), NOT a dry refusal.
5. **Legacy prefixes after deploy** (`previsto:`/`compartido:`/`sin ahorro`/`con X%`): educational redirect explaining the new button flow, not silent plain-text.
6. **"otro"**: stop creating it for new owners (category is mandatory at preview); keep only as legacy reserved row for old movements.
7. **Setup gate (awaiting_setup)**: KEEP BOTH — awaiting_setup stays for new owners and `/configurar categorias` remains as batch onboarding; the preview ➕ create-category flow also exists for owners past setup.
8. **Old dialog states**: fully remove `awaiting_category`, `awaiting_registration`, `awaiting_amount_confirmation` from the enum; persisted corrupt payloads fall into the generic corrupt-payload recovery discipline.
9. **Keywords**: keep the data model/associations intact for the dashboard; remove only bot usage.
10. **Menu idempotency**: opening the menu mid-flow (e.g. during an active preview) ABANDONS the pending preview and starts fresh (menu tap supersedes any pending capture/preview).

## Ready for Proposal

**Yes.** The product decision is authoritative, the codebase map is complete, and all 10 open questions are now resolved by the owner. The proposal and delta specs must encode these decisions (menu = 8 buttons: ➕ Nuevo gasto, 📅 Gasto previsto, ➕ Ingreso, 👥 Compartido, 🗂 Administrar categorías, 🧾 Administrar gastos, 📊 Reportes, ❓ Ayuda).

## Affected Areas (files)

- `apps/api/src/features/telegram/telegram.service.ts` — routing, states, callbacks, sub-menus, universal menu tail (major rework).
- `apps/api/src/features/telegram/telegram.parser.ts` — capture parser (amount+note only), prefix removal, new callbacks.
- `apps/api/src/features/telegram/bot-brain.ts` — intent/prompt/few-shot shrink to query+greeting.
- `apps/api/src/features/telegram/reply-text.ts` — menu/ayuda/capture/preview texts, "no puedo resolver eso".
- `apps/api/src/features/telegram/bot-state.repository.ts` — new states (capture type memory, preview-category-name, sub-menu picks).
- `apps/api/src/features/telegram/{movement-lifecycle-executor, movement-corrector, category-executor, query-executor}.ts` — reused; minor additions (PENDING pick list, correction pick chain).
- `apps/api/src/features/telegram/telegram.commands.ts` — command surface trim.
- `apps/api/src/features/telegram/telegram.bot.ts` — `BOT_COMMANDS`/`setMyCommands` list.
- `apps/api/src/features/telegram/*.test.ts` + `__goldens__/` — massive rework.
- `apps/api/src/app.ts` — brain wiring (unchanged shape; brain scope shrinks).
- `openspec/specs/*` — delta specs for `bot-main-menu`, `quick-capture`, `telegram-bot`, `bot-inline-interactions`, `conversational-categories`, `registration-collection`, `movement-correction`, `bot-expense-lifecycle`, `savings`.