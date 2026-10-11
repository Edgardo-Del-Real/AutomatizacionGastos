# Exploration: bot-expense-lifecycle

## Product Context

The Telegram bot (apps/api/src/features/telegram) is a conversational expense assistant driven by an LLM brain (`GroqBotBrain`). A real-world test on 2026-09-30 exposed failures with nine mapped root causes (CR-1..CR-9). Product scope is CONFIRMED and NOT to be reopened:

1. The bot MUST be able to mark a planned expense as paid (PENDING→PAID) conversationally, reusing the existing REST service.
2. The bot MUST be able to delete an expense conversationally, reusing the existing REST service.
3. Hard guards: "no"/"si" (with or without punctuation) MUST NEVER create a category or register an expense; abandonment/affirmation words MUST be recognized with punctuation stripping; the reserved set MUST be extended (e.g. "provisorio" variants).
4. Category dialogs MUST resolve "Otros"→"otro" (evaluate: deterministic resolver runs when it should vs. prompt receives the owner's category list).
5. The "configurar categorías" flow MUST list existing categories (no fixed text) and the batch MUST recognize commands like "borrar categoría: X" instead of creating literal categories.
6. The contradictory double reply when registering during a dialog MUST be eliminated.
7. A data-cleanup plan for contaminated data (phantom categories + junk expense) MUST be produced WITHOUT touching the valid planned expense.

## Current State

### Conversation pipeline

`handleUpdate` (telegram.service.ts:220) resolves the owner, dedupes, parses commands first (`parseCommand`), strips `compartido:`/`previsto:` prefixes and savings overrides, then dispatches by bot state: `awaiting_setup` → `handleSetupReply`; dialog states → `handleDialogMessage`; else → `handleRegistration`.

- `handleRegistration` (telegram.service.ts:302) lists categories FIRST (line 310), gates setup when empty, then asks the brain for a `ConversationEnvelope`; a null envelope degrades to `deterministicRegistration`. Envelopes route through `routeEnvelopeIntent` (telegram.service.ts:1553).
- Dialog controller (`handleDialogMessage`, :1276): pre-brain interception for affirmation words, brain interpret WITH `InterpretContext` (`renderDialogContext`), routes on `dialog_action` — `resolve` → deterministic resolution from the persisted payload only; `abandon`/null-brain → D6 deterministic fallbacks; null → shared intent routing with the pending untouched.
- Deterministic category cascades exist in three places with the SAME shape: exact normalized match → folded plural match → affirmation keep-open → amount reprocess → single-token guarded auto-create → multi-word category list. (`d6AwaitingCategory` :848, `resolveRegistrationCategory` :1115, `resolveAwaitingCategory` :1415).

### Gaps verified against the code

- **CR-1 (no mark-paid)**: `MovementService.markMovementPaid(ownerId, id)` exists (movements.service.ts:61-71; repo `markPaidById` movements.repository.ts:383-387; route `POST /movements/:id/paid` movements.route.ts:77-82). Grep of the telegram feature finds ZERO references to `markMovementPaid`/`markPaidById`. The LLM degrades "ya lo pagué"/"pásalo a pagado" into `register_expense`, `query_planned` or `help`.
- **CR-2 (no delete-expense)**: `ExpenseService.deleteExpense(id, ownerId)` exists (expenses.service.ts:47-52; route `DELETE /expenses/:id` expenses.route.ts:41-46). `MovementService.deleteMovement` also exists (movements.service.ts:48-53). Telegram never calls either. The LLM emits an intent outside `BOT_INTENTS` (bot-brain.ts:4-22) → `conversationEnvelopeSchema` z.enum rejects (bot-brain.ts:205, 550-551) → `interpret` returns null → deterministic path → `helpReply` ("No entendí el mensaje").
- **CR-3/CR-8 (category-blind prompt + exact-only resolve)**: `INTERPRET_SYSTEM_PROMPT` (bot-brain.ts:226-251) never embeds the owner's categories; `resolveSuggestion` (telegram.service.ts:782-791) matches by `normalizeForMatch` EXACT equality only and treats only the literal folded `"otro"` as no-suggestion. The tolerant resolvers that fold "otros"→"otro" (`normalizeForMatchTolerant`) run ONLY in dialog `resolve` cascades, not on the idle path. `MovementCorrector.resolveTargetCategory` (movement-corrector.ts:126-161) DOES fold — so a `correct_category` envelope with "Otros" works; the failure happens when the LLM emits a redirectable intent (associate_keyword / create_savings_rule / off_topic) because the prompt gives it no category knowledge.
- **CR-4/CR-6 (guard sets + punctuation)**: guard sets `KEEP_OTRO_ANSWERS` / `CATEGORY_AFFIRM_ANSWERS` / `COLLECT_ABANDON_ANSWERS` (telegram.service.ts:190-204) are matched with `normalizeForMatch` WITHOUT punctuation stripping. "no." → "no." ∉ any set → falls into the single-token guarded auto-create (`trimmed.split(/\s+/).length === 1` at :915, :1190, :1474) → `createCategory("no.")` → phantom "No.". Same for "si." The `normalizeForMatch` length-preserving contract (matcher.ts:13-19) is load-bearing for command slicing and keyword boundaries — it must NOT be changed globally.
- **CR-9 (reserved aliases)**: `RESERVED_ALIASES` (reserved.ts:34-36) covers only `provisto → previsto`. "gasto provisorio" folds to "gasto provisorio" → not reserved → phantom category. Note `foldSpanishPluralToken` already folds "provisorios"→"provisorio" (rule 13), so a single alias entry covers both.
- **CR-7 (setup flow)**: `setupQuestionReply` is fixed text (reply-text.ts:83-85); the `configurar` command (telegram.service.ts:1891-1900) sets `AWAITING_SETUP` and sends it without consulting `listCategories`; `extractCategoryNames` splits only on `[\n,]+` (telegram.service.ts:2135-2141) — "Borrar categoría: no" is one token → created as a literal category (+ `ensureOtro`).
- **CR-5 (double reply)**: `routeEnvelopeIntent` case `register_expense` with an open dialog (telegram.service.ts:1607-1624) sends the abandon reply FIRST, then `executeRegistration` sends its own reply — two contradictory messages ("Dale, cancelé…" + "¡Listo! Se registró…").
- **Data contamination (cleanup target)**: phantom categories "No.", "Borrar categoría: no", "si", "gasto provisorio" (possible "otro" duplicate to verify); junk expense 30000 PAID in "No.". The planned 30.000 "gastos hormiga" PENDING stays (valid). Movements keep plain-string category names (no FK) — deleting a category does NOT delete its movements (categories.repository.ts:61-73), so both deletions are independent operations.

## Affected Areas

- `apps/api/src/features/telegram/bot-brain.ts` — `BOT_INTENTS`, `conversationEnvelopeSchema`, `INTERPRET_SYSTEM_PROMPT`, `REPLY_SYSTEM_PROMPT`, `FEW_SHOTS`, `DIALOG_*` (new intents + prompt wording; possibly a dynamic category fragment).
- `apps/api/src/features/telegram/telegram.service.ts` — `routeEnvelopeIntent` (new intent routing), new movement-lifecycle executor (mark-paid / delete), `resolveSuggestion` (tolerant fold), guard-word checks with punctuation stripping in all three single-token cascades, setup flow (`handleSetupReply`, `extractCategoryNames`, `configurar`), CR-5 single-reply fix.
- `apps/api/src/features/telegram/movement-corrector.ts` — extract/share the candidate-scoring window (delete reuse); a PENDING-scoped variant for mark-paid (the current `correct()` excludes PENDING by design).
- `apps/api/src/features/telegram/category-executor.ts` — pattern reference for a new `MovementLifecycleExecutor` (deterministic executor + fixed template + brain reply).
- `apps/api/src/features/telegram/reply-text.ts` — new templates (mark-paid confirm/conflict, deleted confirm, setup-with-list, combined abandon+register), updated `setupQuestionReply`, `capabilitiesSummaryReply` (new capabilities), `helpReply` maybe.
- `apps/api/src/features/telegram/query-executor.ts` — PENDING filter precedent (recent query excludes PENDING at the service layer, query-executor.ts:57-60); mark-paid window can do the same over `listMovements`.
- `apps/api/src/features/categories/matcher.ts` — new punctuation-stripping guard normalization (NOT a change to `normalizeForMatch`); used by guard sets and the single-token reject.
- `apps/api/src/features/categories/reserved.ts` — extend `RESERVED_ALIASES` ("provisorio"→"previsto").
- `apps/api/src/features/movements/movements.service.ts` / `expenses.service.ts` — reused as-is (no change expected).
- Tests: `bot-brain.test.ts`, `telegram.service.test.ts`, `telegram.service.integration.test.ts`, `reply-text.test.ts`, `category-executor.test.ts`, `movement-corrector.test.ts`, `__goldens__/*`.
- `openspec/specs/bot-brain/spec.md` — line 34 enumerates the intents; a delta `MODIFIED` is required for new intents. `openspec/specs/telegram-bot/spec.md`, `planned-fixed-expenses/spec.md`, `conversational-categories/spec.md` may need delta updates during the spec phase.

## Approaches

### A. New intents for mark-paid / delete-expense

1. **Two new intents in `BOT_INTENTS` + a new deterministic executor** — add `mark_paid` and `delete_expense` to the enum, teach them in `INTERPRET_SYSTEM_PROMPT`/`FEW_SHOTS`, and route them through a `MovementLifecycleExecutor` (pattern of `CategoryExecutor`/`QueryExecutor`) that reuses `movementService.markMovementPaid` and `expenseService.deleteExpense`, with the movement-corrector's scoring window for reference resolution (delete) and a PENDING-scoped window (mark-paid).
   - Pros: explicit semantics, clean routing, mirrors REST capabilities 1:1, envelope schema auto-accepts, easy fixed templates + brain reply grounding; the movement-selection ask pattern already exists for ambiguity (AWAITING_MOVEMENT_SELECTION).
   - Cons: enum growth increases LLM misclassification surface slightly; `bot-brain` spec line 34 + prompt goldens + prompt assertions must be updated; new few-shots needed.
   - Effort: Medium.

2. **Reuse existing intents with overloaded fields** (e.g. `correct_amount`/`register_expense` with a new `status:"paid"` envelope field; delete through `correct_category` with a `delete:true` flag).
   - Pros: no enum growth, smaller golden delta.
   - Cons: overloads semantics (a "mark paid" is NOT an amount correction); the prompt becomes harder to teach; the schema refines multiply; routing becomes conditional on flag combinations; spec delta is messier; contradicts the established one-intent-per-capability pattern (register / correct_* / query_* / category CRUD all have dedicated intents).
   - Effort: Medium.

   **Recommendation: A1.** New intents are the smallest, most honest delta; the executor pattern is already established. `BotAction` can reuse `"registered"` (mark-paid is a status update the reply prompt already covers: "el movimiento se guardó o actualizó") or add `"marked_paid"` — design-phase decision.

### B. Category resolution: prompt with categories vs. aggressive deterministic resolver

1. **Prompt receives the owner's category list** — append a dynamic fragment (like `renderDialogContext`, bot-brain.ts:464) with the owner's category names to the interpret prompt at call time; keep `INTERPRET_SYSTEM_PROMPT` a static constant (goldens stay static) and golden-test the fragment with a fixed fixture.
   - Pros: the LLM suggests REAL category names → `resolveSuggestion` exact match works; also improves category suggestions for register/collect dialogs; fixes CR-3 at the source.
   - Cons: the idle path already fetches categories before interpret (telegram.service.ts:310) but dialog paths do NOT — every dialog message would need an extra `listCategories` call before interpret; token growth per call; category names are user data in the prompt (minor PII surface); the LLM can still emit a name that matches nothing → fallback still needed (the deterministic resolver stays the safety net).
   - Effort: Low-Medium.

2. **Keep the prompt category-blind; make the deterministic resolver tolerant** — change `resolveSuggestion` to fold through `normalizeForMatchTolerant` (exact first, then folded), and treat folded "otro" as no-suggestion; ALSO add the folded check to `registerOtroWithCorrection`'s path. This mirrors what the dialog cascades and `MovementCorrector` already do.
   - Pros: single deterministic matching authority (matcher.ts), no per-message prompt cost, no PII in prompts, no golden churn beyond intents; fixes CR-8 ("cafes"→"Cafe", "otros"→"otro") and hardens CR-3 for every envelope that DOES carry a category; keeps the collect dialog as the fallback when nothing folds.
   - Cons: does not help when the LLM emits a redirectable intent with NO category (CR-3's actual observed path) — that needs the prompt wording (a hint that the bot resolves suggestions against the owner's categories and that "otro" is the fallback category) rather than the full list; a folded match can over-match in rare cases (acceptable, same semantics as the dialog cascades).
   - Effort: Low.

   **Recommendation: B2 as the core invariant, plus a MINIMAL prompt hint (B1-lite)** — no per-message category list; instead add one prompt sentence ("el bot resuelve la categoría contra las categorías del dueño; 'otro' es la categoría de respaldo") and make `resolveSuggestion` folded. This fixes CR-8 deterministically, fixes CR-3's category-valued envelopes, and steers the LLM away from redirectable intents for category assignments without dynamic prompts. If the design phase wants stronger suggestion quality, B1 can be layered on later.

### C. Guards: punctuation stripping and reserved expansion

1. **Dedicated guard normalization** — add `normalizeForMatchGuard(text)` (matcher.ts): `normalizeForMatch` + strip `[^\w\s]` punctuation (and fold "sí"→"si" naturally via accent folding) + collapse whitespace. Apply it to `KEEP_OTRO_ANSWERS` / `CATEGORY_AFFIRM_ANSWERS` / `COLLECT_ABANDON_ANSWERS` checks AND add an early reject in the three single-token auto-create cascades: if the guard-normalized answer is a guard word, route to abandon/affirm handling instead of `createCategory`.
   - Pros: "no."/"si."/"no," become "no"/"si" → never create categories; the length-preserving `normalizeForMatch` contract (command slicing, boundary regex) stays untouched; all three cascades share one helper.
   - Cons: new normalization must be added to the affected match sites (5-6 call sites); tests for each cascade need a punctuation case.
   - Effort: Low.

2. **Reserved aliases expansion (CR-9)** — extend `RESERVED_ALIASES` (reserved.ts:34-36) with `provisorio: "previsto"` (the plural fold already reduces "provisorios"); consider "provisorias" (fold: "provisorias"→"provisoria" — NOT covered by the singular alias; decide whether to add both). The reserved guard already runs before every creation path (categories.service.ts:27-33), so no other change is needed.
   - Effort: Trivial.

### D. Setup flow (CR-7)

1. **Dynamic setup question + command-aware batch**: `configurar` and `handleSetupReply` list existing categories first; `setupQuestionReply` becomes `setupQuestionReply(existing)` showing what exists; `extractCategoryNames` recognizes batch commands (`borrar categoria: X`, `renombrar categoria: X a: Y`, `registrar categoria: X`) before the comma/newline split, executing them via the CategoryService instead of creating literals.
   - Pros: fixes the observed failure directly; reuses the existing command regexes (`telegram.commands.ts` REGISTER/RENAME patterns); categories list matches the `query categories` template.
   - Cons: `extractCategoryNames` grows responsibilities (parse + execute) — keep it a pure parser and execute in `handleSetupReply`; setup replies change → reply-text tests + service tests updated.
   - Effort: Medium.

### E. Double-reply fix (CR-5)

1. **Single merged reply** — when `register_expense` abandons a dialog, produce ONE `Sender` call whose text combines the abandon fact and the registration outcome (or the collect ask that follows); the brain reply prompt gains a note for the combined case, or the merged text is fixed-only.
   - Pros: one message, no contradiction, minimal routing change (the abandon block in `routeEnvelopeIntent` :1607-1624 merges into the subsequent send).
   - Cons: brain reply for the merged result needs a deterministic shape (the abandon fact is not representable in the current `ExecutionResult` — either extend it with an `abandoned` field or make the merged reply fixed-only).
   - Effort: Low-Medium.

### F. Data cleanup (item 7)

1. **One-off script (recommended)**: a `scripts/` TS script (tsx) against Prisma that (a) deletes the junk expense (owner, amount 30000, category "No.", PAID, test date), (b) deletes phantom categories "No.", "Borrar categoría: no", "si", "gasto provisorio" via the CategoryService delete path (gets the guards and cascade for free), (c) verifies no "otro" duplicate exists (ensureOtro is a unique upsert — a duplicate can only exist with different case, which `assertNameAvailable` prevents; verify only), (d) leaves the PENDING 30.000 "gastos hormiga" untouched (assert in the script).
   - Pros: auditable, reuses service guards, idempotent-ish, can assert invariants before/after; runs against the real DB with the owner scoped.
   - Cons: needs a DB runbook step (which owner id? confirm with the user).
2. **Manual SQL**: faster but bypasses guards, error-prone, no audit trail.
   - Effort: Low (both).

## Blast Radius (tests and goldens)

- **`bot-brain.test.ts` (1410 lines)** — the largest prompt surface. Prompt goldens are `toMatchFileSnapshot` (lines 1107-1162) over 8 files: `interpret-system-prompt.txt`, `reply-system-prompt.txt`, `interpret-few-shots.json`, `dialog-*-addendum.txt` ×3, `dialog-*-few-shots.json` ×3, `dialog-context-rendered.txt`. Any BOT_INTENTS/prompt change REQUIRES regenerating these (vitest `-u`). Exact prompt equality is asserted at :745, :920, :1030; ~40 `toContain` prompt assertions (1168-1360+) must be extended for the new intents/actions. The `it.each(BOT_INTENTS...)` schema test (:86) auto-covers new intents (positive, no churn).
- **`telegram.service.test.ts` (3894 lines)** — resolver cascades (single-token auto-create, guard sets), setup batch, the CR-5 double-reply sequence, `resolveSuggestion` behavior, capabilities/help assertions: all touched by C/D/E/B.
- **`reply-text.test.ts` (556 lines)** — `setupQuestionReply`, `capabilitiesSummaryReply`, and every new/updated template.
- **`telegram.service.integration.test.ts` (1371 lines)** — registration/planned flows; new mark-paid/delete integration tests will be added; existing assertions on planned replies unaffected unless templates change.
- **`category-executor.test.ts` (206) / `movement-corrector.test.ts` (357) / `query-executor.test.ts` (356)** — pattern references; a new `MovementLifecycleExecutor` gets its own test file; `movement-corrector` only if the scoring window is extracted.
- **`openspec/specs/bot-brain/spec.md`** — intent enumeration must be delta-MODIFIED; `telegram-bot`/`planned-fixed-expenses`/`conversational-categories` specs may need delta updates in the spec phase.
- **`apps/dashboard`** — untouched (REST already exposes mark-paid/delete; no dashboard change in scope).

## Recommendation

Ship the change in this shape:

1. **A1**: new `mark_paid` + `delete_expense` intents, a `MovementLifecycleExecutor` reusing `markMovementPaid` / `deleteExpense`, with the movement-corrector's scoring window (delete) and a PENDING-scoped window (mark-paid); ambiguity reuses the `AWAITING_MOVEMENT_SELECTION` ask pattern.
2. **B2 + minimal prompt hint**: tolerant (folded) `resolveSuggestion` + one prompt sentence about owner-category resolution and "otro" as fallback — no per-message category list.
3. **C**: `normalizeForMatchGuard` punctuation-stripped guard checks in all guard sets and as an early reject in the three single-token cascades; `RESERVED_ALIASES` += `provisorio`.
4. **D1**: dynamic setup question listing existing categories + command-aware batch parsing in `handleSetupReply`.
5. **E1**: single merged reply for register-during-dialog (extend `ExecutionResult` with an abandon fact or make it fixed-only).
6. **F1**: one-off cleanup script with pre/post assertions, leaving the valid planned expense untouched.

This keeps the deterministic layer as the invariant (matching is the matcher's job), minimizes prompt churn (goldens regenerate once for the new intents only), and reuses the REST services exactly as the product scope requires.

## Risks

- **Golden regeneration**: any prompt/`BOT_INTENTS` change breaks the 8 snapshot files and ~40 `toContain` assertions in `bot-brain.test.ts`; regeneration is mandatory and must be reviewed (goldens are excluded from the 400-line authored budget but are part of snapshot identity).
- **LLM surface**: two new intents increase misclassification surface; the prompt hint must be worded carefully so "marcá pagado" never routes to `register_expense` (the highest-frequency intent).
- **Contaminated data**: cleanup runs against the real DB; without an owner-scoped pre-flight check the script could touch the wrong rows; the valid planned expense must be asserted untouched.
- **`normalizeForMatch` contract**: the length-preserving invariant is load-bearing (command slicing, keyword boundaries) — guard changes MUST use a new function, never mutate `normalizeForMatch`.
- **Double-reply fix**: extending `ExecutionResult` for the abandon fact affects the reply prompt contract and its goldens; alternatively the merged reply is fixed-only (smaller surface).
- **Spec drift**: `bot-brain` spec line 34 enumerates intents; forgetting the delta `MODIFIED` leaves specs inconsistent with the code.

## Ready for Proposal

Yes — the orchestrator should tell the user that exploration confirmed all nine root causes against the code, the REST services are reusable as-is, and the recommended approach (new intents + folded deterministic resolution + punctuation-stripped guards + dynamic setup + single-reply fix + cleanup script) fits the confirmed scope without dashboard changes.