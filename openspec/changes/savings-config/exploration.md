# Exploration: Savings Configuration (automatic rule + manual per-income choice)

- **Change**: `savings-config`
- **Date**: 2026-10-01
- **Product request**: configure the savings percent applied on INCOME with (1) an automatic keyword→percent rule, and (2) a manual per-income choice when registering an income (choose percent or set aside nothing).

## Executive Summary

- Option 1 (automatic rule) **already exists** as a text command (`registrar ahorro: <palabra> al <X>%`) with a validated, migrated `SavingsRule` model and deterministic note matching. What is missing is **discoverability and management**: no menu button, not in `ayuda`, not in `setMyCommands`, no list-rules command, and **no delete** (only redefinition upsert).
- Option 2 (manual per-income choice) **does not exist** in the v2 button flow. The service layer is already ready: `resolveSplit` accepts `{kind:"disabled"}` and `{kind:"percent"}` overrides with the exact precedence needed (manual choice supersedes the rule; "no apartar" → whole). Only the **preview payload, callbacks, and keyboard** need to carry the choice to `registerCapture`, which today hardcodes `{kind:"none"}` at `telegram.service.ts:1176`.
- **No DB migration is required** for either option. `SavingsRule` is already migrated (`20260927090000_savings_rule`); the manual choice rides the `BotState.pendingNote` preview payload (schema change only). The prompt's suspicion "SavingsRule has no migration" is **verified false**.
- The LLM is never involved — savings is deterministic (`defineRule`/`matchNote`/`resolveSplit`); no brain prompt/golden impact unless help text changes (fixed text, no goldens).
- **Key existing quirk to decide**: a split INGRESO currently drops the preview-picked category — `registerIncomeSplit` hardcodes `category: "ahorro"` for BOTH the net INCOME and the SAVINGS movement (`telegram.service.ts:1210-1218` → `expenses.repository.ts:119-171`). The manual-choice flow must decide whether the net income keeps the user category.

## Current State (verified, file/line evidence)

### 1. Savings-rule surface today — text command only

| Step | Evidence |
|------|----------|
| Parse | `telegram.commands.ts:21` `SAVINGS_RULE_RE`; `parseCommand` returns `{type:"savings-rule", keyword, percent}` (lines 96-109) or `savings-rule-invalid` for out-of-range percent (100-103) |
| Dispatch | Commands parsed BEFORE state consumption in every state — `telegram.service.ts:289-294` |
| Execute | `handleCommand` case `savings-rule` → `savingsService.defineRule(...)` → `savingsRuleDefinedReply` / `savingsRuleInvalidReply` — `telegram.service.ts:1880-1897`, `reply-text.ts:206-212` |
| Validate | `SavingsRuleService.defineRule` — `0 < percent <= 100`, non-empty keyword after `normalizeForMatch` — `savings.service.ts:20-29` |
| Persist | Prisma `SavingsRule` model `{ownerId, keyword, percent Decimal(12,2), createdAt}`, unique `[ownerId, keyword]` — `schema.prisma:71-80`; migration EXISTS `apps/api/prisma/migrations/20260927090000_savings_rule/migration.sql` (also adds `MovementType SAVINGS` + `CategoryType`) |
| Repository | `SavingsRuleRepository` = `upsert` + `listByOwner` only (oldest-first) — `savings.repository.ts:5-10, 33-48`. **NO delete; listByOwner used only internally by `matchNote`** |
| Match | `matchNote` — `normalizeForMatchTolerant` both sides + `boundaryRegex`, oldest-wins — `savings.service.ts:38-47` |
| Contracts | `savingsRuleSchema` — `packages/contracts/src/index.ts:140-147`; **no API route serves it** (savings feature folder has no route file; no endpoints) |
| Dashboard | No rule config surface — only displays "Ahorrado" KPI card (`apps/dashboard/src/features/movements/KpiCards.tsx:30`) and "ahorro" category rows in the list |

### 2. INGRESO capture path — where `{kind:"none"}` is passed

- Menu: 8 buttons, `m:inc` → `startCapture("INGRESO")` — `telegram.service.ts:497-513` (button row 504).
- `handleAwaitingCaptureMessage` → `enterPreview(amount, note, type, ...)` builds `PreviewPayload {amount, note, type, category: null, saveToken}` — **NO savings field** — `telegram.service.ts:591-606`; schema `telegram.service.ts:155-162`.
- Category pick `cat:<id>` → updates payload `category` + renders the two-step CONFIRMATION `previewConfirmReply` with `previewConfirmKeyboard` (only `[✅ Guardar][✏️ Corregir]`) — `telegram.service.ts:746-848`, `642-649`.
- `pv:save` → `savePreview` (state→idle first = idempotency) → `registerCapture(payload.amount, payload.note, payload.type, payload.category, ownerId, reply)` — `telegram.service.ts:734-737`.
- `registerCapture` INGRESO branch: `resolveSplit(ownerId, note ?? "", { kind: "none" })` — **the v2 hardcoded neutral override** — `telegram.service.ts:1174-1180` (line 1176).
- Split tail: `registerIncomeSplit` → `ensureAhorro` + `createIncomeWithSavings({gross, percent, note, occurredAt, category: "ahorro", visibility: "INDIVIDUAL"})` → `successSplitReply(gross, net, savings)` + menu — `telegram.service.ts:1202-1227`.
- `createIncomeWithSavings`: one `$transaction`; **both** movements get `data.category` (`"ahorro"`) — `expenses.repository.ts:119-171` (net INCOME at 138-151, SAVINGS at 153-168).
- Legacy overrides: `legacyPrefixKind` detects `sin ahorro` / `con X%` → `savingsOverrideRedirectReply` + menu, zero LLM — `telegram.parser.ts:99-117`, `telegram.service.ts:1017-1029`. Per-message overrides were **removed by design** in the archived v2 change (`openspec/changes/archive/2026-10-01-bot-hybrid-ux-v2/`: savings delta "Per-message overrides no longer exist"; proposal "Savings: automatic % on Ingreso per pre-defined rule; **no button**").

### 3. UI / discoverability for rules — NONE today

- Main menu is FULL: 8 rows `m:new/m:prev/m:inc/m:shr/m:cats/m:adm/m:rep/m:help` — `telegram.service.ts:502-509` (Telegram inline limit ≤ 8 rows, `telegram.parser.ts:11`).
- `ayudaReply` does NOT mention savings or `registrar ahorro:` — `reply-text.ts:405-418`.
- `BOT_COMMANDS` (setMyCommands) does NOT register it — `telegram.bot.ts:36-41`.
- Only mentions of the command: `savingsOverrideRedirectReply` (`reply-text.ts:124-126`) and the reserved-category reply (`reply-text.ts:284`).

## Gaps vs. the owner request

### Option 1 — automatic rule: exists, missing management/discoverability

- ✅ Parse, validation (0 < pct ≤ 100), upsert persistence, tolerant matching, split execution all work.
- ❌ **Discoverability**: no button, not in help, not in the visible command list. The owner must know the exact syntax.
- ❌ **List rules**: no command/UI; `listByOwner` exists but is internal to matching.
- ❌ **Delete rule**: repository has no delete; the original savings-rule proposal declared "rule deletion beyond re-definition upsert" OUT OF SCOPE. Only redefining (upsert) changes a rule.
- ❌ Percent editing UX: changing percent means retyping the whole command; no feedback on which notes match.
- ✅ No conflict with the "ahorro" category: rule keywords match income notes; the ahorro category is SAVINGS-typed with create/rename/delete guards (`categories.service.ts:68-97, 153`).

### Option 2 — manual per-income choice: does not exist; service layer is ready

- ❌ `previewPayloadSchema` has no savings field (`telegram.service.ts:155-162`); `registerCapture` hardcodes `{kind:"none"}` (line 1176); confirmation keyboard/text have no savings line.
- ✅ **`resolveSplit` already implements the required precedence** (`savings.service.ts:55-64`): `{kind:"disabled"}` → whole; `{kind:"percent"}` → use it (replaces the rule percent for this movement only); `{kind:"none"}` → rule decides. Unit tests exist for all three (`savings.service.test.ts:193-238`).
- Design space: offer savings-choice buttons for INGRESO only (REAL/PENDING/COMPARTIDO never split — `telegram.service.ts:1174` guards this already), e.g. "Ahorrar 5% / 10% / Otro / No apartar", as a step before Guardar. Requires: payload field (optional, backward-compatible), new callback tokens (e.g. `sv:5:<saveToken>`, `sv:off:<saveToken>` — ASCII, well under the 64-byte budget, `telegram.parser.ts:77-86`), passing the override through `savePreview` → `registerCapture` → `resolveSplit`, and a confirmation text line.
- **Interaction precedence (rule × manual)**: manual per-movement choice supersedes the rule for that movement only; "No apartar" → `{kind:"disabled"}`; explicit percent → `{kind:"percent"}`; no choice → `{kind:"none"}` → rule applies. This is exactly `resolveSplit` today — zero service changes needed.

## Approaches

| # | Approach | Pros | Cons | Complexity |
|---|----------|------|------|------------|
| A | **Confirmation-step savings row (recommended)** — after category pick, the INGRESO confirmation keyboard gains a savings row ("Ahorrar 5% / 10% / Otro / No apartar"), edited in place like category re-picks; payload carries `savings` override; Guardar passes it to `resolveSplit` | Natural spot (right before Guardar); edit-in-place precedent exists (`telegram.service.ts:818-837`); keyboard stays small; default `{kind:"none"}` keeps behavior identical when untouched | One extra tap; new reply text | Medium |
| B | **Preview-step savings row** — savings choice on the initial preview keyboard (INGRESO only) | Choice visible before category; single message | Preview keyboard hits the 8-row ceiling when >5 categories (5 cats + nav + ➕ + savings = 8); pushes the confirmation later | Medium |
| C | **Separate savings state step** (`AWAITING_SAVINGS`) | Cleanest state isolation | New state + state-machine surface + more tests; unnecessary — the preview payload already persists per-movement facts | High — rejected |
| D | **Rule management for Option 1** — add `listar ahorros` / `borrar ahorro: <palabra>` text commands (repository gains `delete`), plus mention the command in `ayuda` and/or `BOT_COMMANDS` | Closes the discoverability/management gap with the same text-command channel | Text commands only; no menu home (menu is full — a button needs a sub-menu like `m:cats`/`m:adm`) | Low-Medium |

## Recommendation

**Approach A for Option 2 + Approach D (minimal) for Option 1.**

- Option 2: confirmation-step savings row for INGRESO only. Add optional `savings?: { kind: "disabled" } | { kind: "percent"; percent: number }` to `previewPayloadSchema` (backward-compatible with persisted payloads), new `sv:*` callbacks dispatched inside `handlePreviewCallback` (`telegram.service.ts:669-726`), carry the override through `savePreview` → `registerCapture` → `resolveSplit` (replacing the hardcoded `{kind:"none"}` at line 1176 with `payload.savings ?? {kind:"none"}`), and render the choice in `previewConfirmReply`.
- Option 1: keep the text command as-is; add (a) repository `delete(ownerId, keyword)`, (b) `borrar ahorro: <palabra>` + `listar ahorros` command types with replies, (c) mention `registrar ahorro:` in `ayudaReply`. Optionally register it in `BOT_COMMANDS` (it is a real owner-facing command).
- Scope decision for proposal: is Option 1 management (list/delete/discoverability) in-scope now, or deferred? The owner's ask names both options; the minimal viable slice is Option 2 alone, with Option 1's additions as a second slice.
- The net-income category quirk (split INGRESO drops the picked category, both movements land in "ahorro") should be surfaced to the owner and decided explicitly — the manual-choice flow makes the income category visible, and "Categoría: ahorro" on a net income may surprise.

## Reusable Pieces

- `SavingsRuleService.defineRule / matchNote / resolveSplit / computeSplit` — resolveSplit already implements the manual-override precedence; computeSplit has the rounding invariant (`savings.service.ts:71-75`).
- `SavingsOverride` type (`savings.types.ts:15`) — exact vocabulary for the payload field.
- `createIncomeWithSavings` transaction (`expenses.repository.ts:119-171`) — atomic net+SAVINGS creation, unchanged.
- Confirmation flow: `previewConfirmReply` + `previewConfirmKeyboard` + `successSplitReply` (`reply-text.ts:35-37, 71-79`; `telegram.service.ts:642-649`) — extend, don't rebuild.
- Sub-menu chain precedent for any future menu home for rules: `m:cats` → `ac:*` dispatch (`telegram.service.ts:422-489`).
- `savingsRuleSchema` (`packages/contracts/src/index.ts:140-147`) — ready if rule management ever gains an API surface.
- Legacy-prefix redirect (`telegram.parser.ts:99-117` + `savingsOverrideRedirectReply`) — the "no per-message text override" boundary that manual buttons must NOT break (button choice is not text parsing).

## Risks

- **INFO** — No DB migration needed: `SavingsRule` migration exists; manual choice lives in `pendingNote`. Prompt's "no migration" suspicion verified false.
- **WARNING** — Keyboard budget: main menu is full at 8 rows (any new button needs a sub-menu or replacement); INGRESO preview keyboard reaches 8 rows at the ceiling if savings is added there (approach B) — approach A avoids this.
- **WARNING** — Net-income category quirk: split INGRESO assigns "ahorro" to BOTH movements, dropping the preview-picked category (`telegram.service.ts:1216`; `expenses.repository.ts:144,160`). Changing this affects `createIncomeWithSavings` and its tests (`expenses.split.integration.test.ts`, `telegram.service.savings.test.ts`). Decide and spec it explicitly.
- **WARNING** — Test impact: `{kind:"none"}` assertions in `telegram.service.savings.test.ts:177,198`, `telegram.service.test.ts:809`; `previewPayloadSchema.parse` call sites (`telegram.service.savings.test.ts:167,216,236`, `telegram.service.integration.test.ts:161`, household integration `:141,205,239`); reply-text tests for new texts; command tests if `borrar ahorro:`/`listar ahorros` added (`telegram.commands.test.ts`).
- **INFO** — LLM never involved; no golden prompt regeneration. Help-text changes are fixed strings (no goldens).
- **INFO** — Rule list/delete has no API or dashboard surface today; keep it bot-only unless the owner asks for dashboard config (out of scope per request, but flag in proposal).
- **INFO** — Backward compatibility: the new payload field MUST be optional so persisted previews and the strict `previewPayloadSchema.safeParse` (used for idempotency/decoding) keep decoding; corrupt-payload recovery must not regress (`telegram.service.ts:652-662`).

## Open Questions

1. Is Option 1 management (list/delete rules + discoverability in `ayuda`/`setMyCommands`) in scope for this change, or is Option 2 the only deliverable? (Drives delta spec surface.)
2. Which quick percentages does the manual choice offer? ("Ahorrar 5% / 10% / Otro / No apartar" is a guess; "Otro" needs a free-form percent input — new small state or accept text in a re-used state?)
3. When the manual choice is used AND the note matches a rule, confirm precedence = manual wins for that movement only (recommended, matches `resolveSplit`). Owner sign-off needed.
4. Should a split INGRESO keep the preview-picked category on the NET income instead of "ahorro"? (Existing behavior change — needs owner decision.)
5. Does "No apartar" need to be reversible before Guardar (tap again to change)? (Edit-in-place precedent supports yes.)

## Resolved Product Decisions (owner, 2026-10-01)

1. **Automatic rule discoverability**: ADD a savings sub-menu (create/list/delete rules with buttons) + mention in Ayuda + register commands in setMyCommands.
2. **Delete rules**: YES — add rule deletion (`borrar ahorro: <palabra>` command and/or the sub-menu button).
3. **Manual per-income choice**: BUTTONS in the confirmation step (step 2 of the INGRESO preview): [5%] [10%] [Otro] [No apartar]. If an automatic rule matches the note, show the suggested % plus options to change it / set aside nothing.
4. **Net-income category**: the net INCOME keeps the preview-picked category; ONLY the SAVINGS movement goes to "ahorro" (change from current behavior where both go to "ahorro").
5. **Precedence**: manual choice wins for that income. If nothing chosen manually, the automatic rule applies (if it matches). "No apartar" disables savings for that income only.

## Ready for Proposal

**Yes.** The service layer is ready (`resolveSplit` overrides), no migration needed, deterministic (no LLM). The proposal and specs must encode these 5 decisions.

**Yes.** Evidence is complete and the service layer already supports the manual override semantics. The orchestrator should tell the owner: (1) the automatic rule already exists as a text command but has no button/help/list/delete; (2) the manual per-income choice is a UI-only change at the service layer (no migration, no LLM); (3) the net-income category quirk and the quick-percent buttons need explicit owner decisions; (4) scope decision: Option 1 management in this change or a follow-up.