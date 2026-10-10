# Exploration: shared-expense-split

## Current State

**COMPARTIDO capture path (verified in `telegram.service.ts`):**
1. Main menu button `[👥 Compartido]` = callback `m:shr` → `handleMenuCallback` case `"shr"` → `startCapture("COMPARTIDO")` → sets `BotState{state:"awaiting_capture", pendingNote:{type:"COMPARTIDO"}}` → `capturePromptReply()`.
2. Free text `monto+nota` in `awaiting_capture` → `handleAwaitingCaptureMessage` → `captureParse` → `enterPreview(amount, note, "COMPARTIDO")` → sets `awaiting_preview` with `previewPayloadSchema{amount,note,type,category:null,saveToken}` and renders `previewReply` + `previewKeyboard` (category buttons only).
3. Category tap `cat:<id>` → `handleCategoryPickCallback` → `renderPreviewConfirmation` → **confirmation message** with `previewConfirmKeyboard`. The savings row (`sv:*`) is appended **only for `type === "INGRESO"`**.
4. `[✅ Guardar]` = `pv:save:<token>` → `handlePreviewCallback` case `"save"` → gated on `category !== null` → `savePreview` (sets `IDLE` first, then) → `registerCapture(...)`.
5. `registerCapture` (line ~1636): `type === "INGRESO"` runs the savings split; otherwise **one** `createMovement` row. For COMPARTIDO: `movementType=EXPENSE`, `status = type==="PENDING" ? "PENDING" : "PAID"`, `visibility = "SHARED"`. **No split, no partner row, no percentage question.** Legacy `compartido:` prefix text is redirected, never captured.

**Savings `[Otro]` interaction pattern to mirror (the exact template):**
- `previewConfirmKeyboard` → row `sv:5 | sv:10 | sv:other | sv:off` (INGRESO only), callback data carries only the 8-hex `saveToken`.
- `handleSavingsChoiceCallback` is gated by `state === AWAITING_PREVIEW && payload.saveToken === token` (mismatch → `alreadyProcessedReply`).
- `sv:other` persists `savingsPercentPayloadSchema{preview}` into `pendingNote`, sets `state = "awaiting_savings_percent"`, replies `savingsPercentPromptReply()`.
- `handleUpdate` switch routes `AWAITING_SAVINGS_PERCENT` → `handleAwaitingSavingsPercent` → `parseSavingsPercentInput` (optional `%`, comma decimal, `0 < p <= 100`). Invalid → `savingsPercentInvalidReply()`, state stays open. Valid → back to `AWAITING_PREVIEW` with the override persisted, `renderPreviewConfirmation(..., editMessageId)` edits in place.
- `BOT_STATES` enum (in `bot-state.repository.ts`) is the authoritative state list; removed states recover to `idle` via `normalizeState`.

**Arithmetic invariant pattern:** `savings.service.ts#computeSplit` uses `Prisma.Decimal(gross).times(pct).div(100).toDecimalPlaces(2)`, then `net = gross - savings`, guaranteeing `net + savings === gross` exactly. This is the pattern the shared split MUST reuse (`partnerPart = total - senderPart`).

**Partner resolution:** `HouseholdService.partnerOf(ownerId)` returns the other member or `null` (single-user / degraded). Compiled in `movements.route.ts#buildViewerScope`. `registerCapture` currently does **not** resolve the partner.

**Schema:** `Expense` has no split/group column. Latest migration is `20261003220000_typed_categories`; migrations are plain SQL under `apps/api/prisma/migrations/`.

**Display surfaces:**
- API DTO `movementSchema` (packages/contracts) extends `expenseSchema` with `type`, `visibility?`, `registrantId?`, `status?` — **no `sharedTotal`**.
- `/movements` SELECT in `movements.repository.ts` explicitly lists columns; `MovementRow` + `mapMovementRow` would drop any new column unless added.
- Dashboard `MovementList.tsx` renders the table "Monto" cell and the card amount via `formatARS(movement.amount)`; the SHARED badge is a ✅ on a dedicated column.
- Bot confirmation uses `successReply` (single amount) for COMPARTIDO.

## Affected Areas

**API — data layer**
- `apps/api/prisma/schema.prisma` — add nullable `sharedTotal Decimal? @db.Decimal(12,2)` on `Expense`.
- `apps/api/prisma/migrations/<timestamp>_shared_expense_split/migration.sql` — new; nullable column, no backfill.
- `apps/api/src/features/expenses/expenses.repository.ts` — add `createSharedSplit(...)` (2-row `$transaction`, mirroring `createIncomeWithSavings`) and `sharedTotal` in the interface; keep `mapExpenseRow`/`NewExpense` in sync if the field rides `Expense`.
- `apps/api/src/features/expenses/expenses.service.ts` — add `createSharedExpenseSplit(...)` delegating to the repository.
- `apps/api/src/features/expenses/expenses.types.ts` — extend `Expense`/`NewExpense` with `sharedTotal`.

**API — bot flow**
- `apps/api/src/features/telegram/telegram.service.ts` — the main changes:
  - `previewPayloadSchema`: add `sharedPercent?: number` (additive optional, so persisted payloads keep decoding).
  - New `sharedPercentPayloadSchema{preview}` (mirror of `savingsPercentPayloadSchema`).
  - New const `AWAITING_SHARED_PERCENT = "awaiting_shared_percent"`; route it in the `handleUpdate` switch; add `handleAwaitingSharedPercent`.
  - `previewConfirmKeyboard`: add the `sp:*` row for `type === "COMPARTIDO"` **only when a partner exists** (needs `hasPartner`, resolved once).
  - New `handleSharedChoiceCallback` (dispatch prefix `sp`) mirroring `handleSavingsChoiceCallback` (state+token gate).
  - `registerCapture`: for COMPARTIDO with a partner + `sharedPercent`, split into two SHARED rows; else keep the legacy single row.
  - Maybe a `computeSharedSplit` helper (reuse the Decimal pattern).
- `apps/api/src/features/telegram/bot-state.repository.ts` — add `"awaiting_shared_percent"` to `BOT_STATES`.
- `apps/api/src/features/telegram/telegram.commands.ts` — add `parseSharedContributionInput(input, total)` returning the resolved percent `1..99` or `null` (percent-or-amount disambiguation).
- `apps/api/src/features/telegram/reply-text.ts` — `sharedPercentPromptReply()`, `sharedPercentInvalidReply()`, and a split-confirmation reply (`successSharedReply(...)` / annotation).

**Contracts / display**
- `packages/contracts/src/index.ts` — add `sharedTotal: z.number().nullable().optional()` additively to `movementSchema` (and `expenseSchema` if the bot/API returns it there).
- `apps/api/src/features/movements/movements.repository.ts` — add `sharedTotal` to `MovementRow`, the `listByOwner`/`topByType` SELECTs, and `mapMovementRow`.
- `apps/dashboard/src/features/movements/MovementList.tsx` — annotate the amount ("parte de {sharedTotal} compartido") in the table "Monto" cell and the card view.

## Existing Tests Affected

- `telegram.service.savings.test.ts` — `"COMPARTIDO NEVER splits..."` (line 224): harness `partnerOf: () => null`, so legacy single row stays green, but the test title becomes misleading and should be reworded; add a partner-present split test.
- `telegram.service.household.integration.test.ts` — `"a capture from the 👥 menu button registers a SHARED movement under the sender"` (line 234) uses a 2-member household → after the feature this becomes **two** SHARED rows; must be updated.
- `telegram.service.integration.test.ts` — `"capture e2e: COMPARTIDO registers a SHARED EXPENSE row"` (line 382) and the `openPreview` helper → the shared question becomes part of the flow; update.
- `telegram.service.test.ts` — `"COMPARTIDO registers EXPENSE + PAID + SHARED"` (line ~936) and `seedAwaitingCapture`; same review.
- `telegram.bot.test.ts` — harness `partnerOf: () => null` (line 175): unaffected if legacy no-partner path is preserved.
- `MovementList.test.tsx` — SHARED tests (lines 415–540) and `sharedMovements` fixtures; extend for the annotation.
- `expect` surfaces: `expenses.split.test.ts` / `expenses.split.integration.test.ts` are about the **income savings** split — extend or add new cases for the shared split (do not conflate).
- `packages/contracts/src/index.test.ts` — `movementSchema` tests for the additive `sharedTotal`.
- `movements.route.test.ts` / `movements.repository.visibility.integration.test.ts` — SHARED fixtures unaffected (additive DTO).

## Approaches

1. **Confirmation row + gated save (mirror savings exactly)** — add `sp:25|50|75|other:<token>` to the COMPARTIDO confirmation (partner only); `sp:other` → `awaiting_shared_percent`; free text parsed by `parseSharedContributionInput`; `registerCapture` splits on save. Mirror the existing "Guardar gated until a category is chosen" by requiring a chosen percent (or defining an explicit default).
   - Pros: exact reuse of the proven state+token gate, edit-in-place, invalid re-prompt; minimal new state; consistent UX. Tests mirror `telegram.service.savings.test.ts`.
   - Cons: adds a save gate for COMPARTIDO; needs a decision for "user taps Guardar without picking".
   - Effort: Medium.

2. **Post-save question** — `pv:save` for COMPARTIDO defers registration and enters `awaiting_shared_percent`; the text reply registers the split.
   - Pros: literally "after capturing, the bot asks".
   - Cons: must carry all capture facts across the question (category/status/type) in a new payload; abandoning the question registers nothing; breaks the "state IS the consumption record" idempotency convention; diverges from the savings pattern.
   - Effort: High.

3. **Store only the percent, no gate (optional row)** — like 1 but Guardar without a chosen percent registers the legacy single SHARED row.
   - Pros: no gate; back-compatible.
   - Cons: the feature becomes opt-in and easy to miss; risks surprising/ambiguous behavior.
   - Effort: Low.

## Recommendation

**Approach 1**, because it is a byte-for-byte structural mirror of the already-shipped, already-tested savings `sv:*` / `awaiting_savings_percent` flow: same state+token gate, same edit-in-place confirmation, same invalid re-prompt discipline, same payload-carries-preview pattern. Concretely:

- Prefix `sp` (`sp:25:<token>`, `sp:50:<token>`, `sp:75:<token>`, `sp:other:<token>`; 50% first per the brief).
- `previewPayloadSchema.sharedPercent?: number`; `sharedPercentPayloadSchema{preview}`; `AWAITING_SHARED_PERCENT`.
- `parseSharedContributionInput(input, total)`: trailing `%` → percent; bare number `<= 100` → percent; bare `> 100` or currency-formatted → amount → `pct = amount/total*100`; valid only when the resolved percent is `1..99` (amount `> 0` and `< total`).
- Split via `Prisma.Decimal`: `senderPart = round2(total*pct/100)`, `partnerPart = total - senderPart` → invariant exact.
- Both rows `visibility=SHARED`, same `category`, `note`, `occurredAt`, and `sharedTotal=total`; status `PENDING` only if the capture status is PENDING, else `PAID`; sender row under `ownerId`, partner row under `partnerOf(ownerId)`.
- No partner → **unchanged legacy** single SHARED row, no question (brief item 6).
- Settle in spec: the save-without-percent behavior (gate vs default) and the shared-previsto ambiguity below.

## Risks

- **CRITICAL — COMPARTIDO+PENDING mismatch (needs a decision).** The brief's ground truth says COMPARTIDO can be PAID or "PENDING for gasto previsto", but the code has no shared-planned path: `m:shr` → type COMPARTIDO → always `status=PAID`; the `📅 Gasto previsto` button is a **separate** type (`PENDING`) that is `INDIVIDUAL` by design. Either (a) the feature only applies to COMPARTIDO (PAID) and the PENDING clause is a dormant status pass-through, or (b) the product wants shared planned expenses — which is **new scope** (a combined capture entry point). Recommend the minimal reading (generic status pass-through, no new entry point) and have `sdd-propose` confirm explicitly with the user.
- **WARNING — viewer-scoped KPI semantics shift.** Two SHARED rows (each `total*pct` / remainder) replace one `total` row. With `visibility=all|shared` a viewer still sums to `total` (correct gross), but `visibility=mine` now shows only the viewer's share (previously the full amount), and `count`, `maxAmount`, `avgPerMovement`, and `topByType` change. Must be asserted per viewer.
- **WARNING — editing/deleting one half.** Each split row is an independent `Expense`. Deleting/PATCHing/marking-paid one half leaves the other orphaned and the `sharedTotal` annotation no longer reconciles. No linking column is proposed; document as a known limitation or plan a `sharedGroupId` follow-up.
- **WARNING — amount-vs-percent parsing ambiguity in es-AR.** `45.000` must mean 45000 (amount), while the savings parser treats `.`/`,` as a decimal separator. `parseSharedContributionInput` needs its own locale handling; a bare number `<= 100` is a percent while `> 100` is an amount — edge cases (`100`, `0`, exactly `total`) must be tested.
- **SUGGESTION — same category on both rows.** Because `summaryCategories` sums by category, identical categories keep the per-category gross correct; do not invent a partner-specific category.
- **SUGGESTION — stale `[Otro]`/`sp:*` taps** are already covered by the state+token gate; keep the `alreadyProcessedReply` discipline and encode only the token (never the percent) in callback data.

## Ready for Proposal

**Yes.** Proceed to `sdd-propose`, but the proposal MUST resolve the CRITICAL COMPARTIDO/PENDING ambiguity (scope) and the save-without-percent behavior before `sdd-spec`.
