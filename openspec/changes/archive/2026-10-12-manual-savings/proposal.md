# Proposal: Manual Savings Registration

Status: proposal (sdd-propose) · Change: `manual-savings` · Date: 2026-10-12
Input: `openspec/changes/manual-savings/exploration.md` (Option A locked; all file:line anchors re-verified 2026-10-12).

## Intent

The owner wants to register a standalone savings amount `x` that is NOT an expense: `Disponible` (balance) must decrease by `x` — the money is reserved and no longer spendable — without appearing in expense totals or category breakdowns. Today SAVINGS rows exist only as automatic income splits (`createIncomeWithSavings`, `expenses.repository.ts:145-198`) and balance = income − expenses (`movements.service.ts:94`), so a manual reservation cannot be represented without polluting expenses.

## Confirmed Decisions (owner — binding, do not re-open)

1. Bot entry: BOTH — new `sa:manual` action in the 💰 Ahorro sub-menu AND text command `registrar ahorro manual: <monto> [nota]`. Deterministic only; no new brain intents (v2 brain rejects legacy intents).
2. Capture UX: prompt = amount + optional note; category FIXED "ahorro" (no picker).
3. `kpis.savings` ("Ahorro del mes") counts auto + manual (no origin filter on `summarySavings`).
4. PATCH: a MANUAL SAVINGS movement's category is pinned to "ahorro".
5. API: POST /expenses accepts a manual-savings creation (`type: SAVINGS`, origin MANUAL) and ENFORCES category "ahorro" — closes today's creation-side gap (POST accepts SAVINGS with any category; the guard exists only on PATCH/bot paths).
6. Visibility: manual savings default INDIVIDUAL.

## Scope

### In Scope
- Prisma: `MovementSavingsOrigin` enum (`AUTO_SPLIT | MANUAL`) + nullable `savingsOrigin` on `Expense`; historical rows stay NULL (inert); NO backfill.
- `createIncomeWithSavings` stamps `AUTO_SPLIT` on its SAVINGS row; new `createManualSavings` path (SAVINGS + "ahorro" + MANUAL + INDIVIDUAL + PAID + ARS).
- New `summaryManualSavings(scope, period)` (period-scoped, viewer-scoped, ARS); `balance = income − expenses − manualSavings` (`movements.service.ts:94`); `kpis.manualSavings` added to the summary contract.
- POST /expenses SAVINGS-create guard: category must be "ahorro" (absent → defaulted); `savingsOrigin` accepted absent or MANUAL only (AUTO_SPLIT → 422).
- PATCH pin in `MovementService.updateMovement` (`movements.service.ts:29-46`).
- Bot: `sa:manual` 4th sub-menu action; `AWAITING_MANUAL_SAVINGS` state; amount[+note] prompt; es-AR confirmation; `registrar ahorro manual:` command; `registrar_ahorro_manual` in setMyCommands; help-text mention.

### Out of Scope
- Dashboard code (read-only; existing cards/badges render the new values automatically — SAVINGS rows already badge "Ahorro").
- New brain intents.
- mom/daily/categories formula changes (trend views keep income−expenses balance; the manual deduction is visible via `kpis.manualSavings` and the per-month `savings` column — documented limitation, future work).
- SHARED manual savings (not expressible: visibility is out-of-band and not patchable).
- Percent input / rounding logic (single amount; N/A).

## Capabilities

> Contract for sdd-spec.

### New Capabilities
- `manual-savings`: standalone manual savings registration — bot entries (`sa:manual` sub-menu action, `registrar ahorro manual:` command), creation semantics (SAVINGS ∧ "ahorro" ∧ MANUAL ∧ INDIVIDUAL), balance-deduction invariant, inclusion in `kpis.savings`.

### Modified Capabilities
- `savings`: "KPI-Exclusion Invariants" — balance = net income − expenses − MANUAL savings (auto-split stays excluded via net-income rows; only MANUAL rows deduct).
- `money-movements`: "Movement Contracts" (additive `savingsOrigin` on `movementSchema`/`createMovementSchema`), "Movement Summary Endpoint" (balance formula + `kpis.manualSavings`), "Movement Update Endpoint" (MANUAL category pin → 422).
- `bot-manage-savings`: "Sub-Menu Entry" — three → four actions; main menu stays 8 buttons.
- `bot-main-menu`: "setMyCommands Registration" (+ `registrar_ahorro_manual`) and "Static Help" (mention manual savings).

Unaffected: `dashboard-web` (no code change; contract fields additive), `bot-inline-interactions` (`sa:manual` fits the existing `sa:*` family; 4-row keyboard, 9-byte callback data — within limits).

## Approach (Option A — discriminator, locked)

Crux (verified): auto-split months store NET income (gross 1000 → INCOME 900 + SAVINGS 100), so subtracting ALL savings double-counts (900−300−100=500 ≠ 600 — guarded by `movements.savings.integration.test.ts:210-224`). Deducting only `savingsOrigin = MANUAL` is provably inert on history (no MANUAL rows exist) and correct for new rows.

- **Data model** (`apps/api/prisma/schema.prisma`): `enum MovementSavingsOrigin { AUTO_SPLIT MANUAL }`; `savingsOrigin MovementSavingsOrigin?` on `Expense` (nullable-additive precedent: `sharedTotal`, schema.prisma:46-48). NULL = legacy (all auto-split by construction). No new index (existing `@@index([ownerId, occurredAt])` serves the SAVINGS subset).
- **KPI behavior**: `summaryManualSavings` mirrors `summarySavings` (`movements.repository.ts:351-365`) but filters `savingsOrigin = 'MANUAL'` and uses the REQUESTED period (not month-pinned). Service: `balance = kpis.income − kpis.expenses − manualSavings`; `avgPerMonth` follows; `count`/`avgPerMovement`/mom/daily/categories untouched (`SAVINGS_EXCLUDED` stays). `kpis.savings` UNCHANGED — `summarySavings` already sums every SAVINGS row (auto+manual) month-scoped → decision 3 costs zero query change. `mom.months[].savings` already sums all SAVINGS.
- **Contract deltas (minimal, additive)**: `movementSchema.savingsOrigin: enum("AUTO_SPLIT","MANUAL").nullable().optional()` (AD5/D8 precedent — legacy rows parse without it; SELECTs/mappers carry it). `createMovementSchema.savingsOrigin` optional; refine: on a SAVINGS create it must be absent (server stamps MANUAL) or MANUAL; AUTO_SPLIT → 422 (auto-split rows are produced only by the internal split transaction). `movementSummarySchema.kpis.manualSavings: z.number()` REQUIRED (repo precedent: `countThisMonth`, `planned` — contracts+dashboard ship in lockstep in the monorepo). Justification: it exposes `balance = income − expenses − manualSavings` as a consumer-verifiable invariant (otherwise Disponible is unexplainable from the other KPIs) and gives the bot/dashboard a manual-savings breakout for free; balance-only would force a second contract change later.
- **Creation path**: `ExpenseService.createExpense` (`expenses.service.ts:19-33`) — when `type === "SAVINGS"`: `ensureAhorro(ownerId)` upsert, reject `category` ≠ "ahorro" (422 ValidationFailedError; absent → "ahorro"), stamp `savingsOrigin: "MANUAL"`, status PAID, visibility INDIVIDUAL (AD7 out-of-band default — never in the shared schema), currency ARS. No new route: POST /expenses IS the creation endpoint (decision 5 "(or equivalent)" resolved to the existing route; response stays the frozen `expenseSchema` shape — `type`/`savingsOrigin` observable via GET /movements). Bot-internal path: new `ExpenseService.createManualSavings({ownerId, amount, note?, occurredAt})`, invoked after `ensureAhorro` (mirror `registerIncomeSplit`, `telegram.service.ts:1863-1891`).
- **PATCH pin**: `MovementService.updateMovement` — the category-guard block (:34-40) widens to `category !== undefined` (null included): load the movement; if `type = SAVINGS ∧ savingsOrigin = MANUAL` and the patch category ≠ "ahorro" (or null) → 422 ValidationFailedError. `assertOwnerCategory(ownerId, "ahorro", "SAVINGS")` passes for the allowed value. Type changes are already impossible (`updateMovementSchema` = amount | note | category). AUTO_SPLIT rows keep existing D9 freedom.
- **Bot flow** (es-AR surface; code/artifacts English): `sa:manual` (new case in `handleSavingsAdminCallback`, :1082-1170; four-action keyboard) → state `AWAITING_MANUAL_SAVINGS` (constant beside :133-148) + prompt reply → next text parsed with `captureParse` (`telegram.parser.ts:36`); unparseable → re-prompt keeping state (mirror :690-692); valid → `createManualSavings` → `manualSavingsSavedReply(amount, note)` + `sendMenu`. Text command: `MANUAL_SAVINGS_RE` (amount + optional note, values sliced from the original text) matched BEFORE `SAVINGS_RULE_RE` — disjoint by construction ("manual" precedes the colon; `registrar ahorro: manual al 10%` remains a RULE with keyword "manual"); amount ≤ 0 / non-numeric → recognized `manual-savings-invalid` command, validation reply, nothing stored (mirror :107-108). `/registrar_ahorro_manual` works via `normalizeCommandSyntax` (:68-70). New replies in `reply-text.ts`: `manualSavingsPromptReply`, `manualSavingsSavedReply`, `manualSavingsInvalidReply`.
- **Migration**: one Prisma migration (enum + nullable column). NULL rows are inert by construction (only MANUAL is deducted) — `savings.migration.integration.test.ts` legacy-shape assertions must stay green. Backfill: NONE (optional future normalization NULL→AUTO_SPLIT, not needed for correctness).

## Edge Cases

| Case | Behavior |
|---|---|
| PATCH category ≠ "ahorro" (incl. null) on MANUAL SAVINGS | 422; row unchanged |
| PATCH amount/note on MANUAL SAVINGS | Allowed; balance recomputes |
| DELETE manual savings | Existing `DELETE /movements/:id`; deduction disappears (money returns to Disponible) |
| Amount ≤ 0 / non-numeric | API: positive-number 422 (`createMovementSchema`); bot: re-prompt (sub-menu) / invalid-command reply (text); nothing stored |
| Auto-split + manual same month | income = net; savings card = auto + manual; balance deducts manual only (no double-count) |
| Non-ARS SAVINGS create | Existing ARS-only totals exclude it (uniform with all types); no new guard |
| Rounding | N/A — single amount, no percent arithmetic |
| Historical rows | NULL origin; summaries byte-identical to pre-change |

## Test Plan (strict TDD — `pnpm --filter @rita/api test`)

| File | Work |
|---|---|
| `movements/movements.savings.integration.test.ts` | balance with manual + auto (no double-count); `kpis.manualSavings` period scope; savings card = auto + manual |
| `movements/movements.service.test.ts` | mock `summaryManualSavings`; assert call shape + balance formula |
| `movements/movements.repository.visibility.integration.test.ts` | viewer predicate scopes `summaryManualSavings` |
| `movements/movements.patch-guard.integration.test.ts` | MANUAL pin (≠ "ahorro" and null → 422); AUTO_SPLIT freedom unchanged; amount/note editable |
| `expenses/expenses.route.test.ts` + new `expenses/expenses.manual-savings.integration.test.ts` | POST SAVINGS: category ≠ "ahorro" → 422; "ahorro"/absent → 201 + MANUAL persisted; origin AUTO_SPLIT → 422 |
| `telegram/telegram.commands.test.ts` | command parse (amount; amount+note; invalid; disjoint from rule command) |
| `telegram/telegram.service.savings.test.ts` | `sa:manual`: four-action sub-menu, prompt state, capture → create → confirm + menu; text-command path |
| `telegram/reply-text.test.ts` | new es-AR replies |
| `savings/savings.migration.integration.test.ts` | legacy row shape green with NULL `savingsOrigin` |

## Affected Areas

| Area | Impact | Change |
|---|---|---|
| `apps/api/prisma/schema.prisma` + new migration | Modified | enum + nullable `savingsOrigin` |
| `apps/api/src/features/expenses/expenses.{service,repository,types}.ts` | Modified | SAVINGS-create guard + `createManualSavings`; split stamps AUTO_SPLIT |
| `apps/api/src/features/movements/movements.{repository,service}.ts` | Modified | `summaryManualSavings`; SELECTs/mappers; balance formula; PATCH pin |
| `packages/contracts/src/index.ts` | Modified | additive `savingsOrigin`; `kpis.manualSavings` |
| `apps/api/src/features/telegram/{telegram.commands,telegram.service,reply-text}.ts` | Modified | command, sub-menu action + state, replies; setMyCommands; help text |
| `apps/dashboard/**` | Unchanged | read-only; renders updated KPIs automatically |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Double-count regression (subtracting all SAVINGS) | Low | Only MANUAL deducted; existing 900/300/600 integration test guards |
| Editor conflates month-pinned `summarySavings` with period-scoped deduction | Med | Separate `summaryManualSavings` + D3-style comments at both call sites |
| Migration breaks legacy-shape test | Low | Nullable column, no backfill; verify in RED |
| Sub-menu spec says "exactly three actions" | Low | Delta MODIFIES bot-manage-savings "Sub-Menu Entry" |
| Review size (schema + API + bot + tests) | Med | delivery_strategy=auto-chain → chained PR slices: (1) data model + contracts, (2) API/KPI + guards, (3) bot surface |

## Rollback Plan

Revert the merged PRs; deploy the migration's down step (drop nullable `savingsOrigin` + enum — no data loss, nothing was backfilled). Additive contract fields revert with the same PRs (monorepo lockstep). Owners stuck in `AWAITING_MANUAL_SAVINGS` recover via the existing unknown-state recovery path (idle). Pre-change summaries are unchanged by construction (NULL origin inert), so no data repair is needed.

## Dependencies

- PostgreSQL 16 on localhost:5433 (docker compose) for integration tests.
- Build contracts first: `pnpm --filter @rita/contracts build` (config apply guideline).
- Prisma client regeneration after the migration.

## Success Criteria

- [ ] Registering `x` via button or command reduces Disponible by `x`; expense totals and category breakdowns untouched.
- [ ] Mixed month (auto-split + manual): balance = net income − expenses − manual; "Ahorro del mes" = auto + manual.
- [ ] POST /expenses SAVINGS create with category ≠ "ahorro" → 422 (creation gap closed).
- [ ] PATCH cannot move a MANUAL SAVINGS row off "ahorro"; amount/note/delete keep working.
- [ ] Pre-change data produces byte-identical summaries (NULL origin inert).
- [ ] `pnpm --filter @rita/api test` + typecheck green.

## Open Questions

None at the product level (all decisions confirmed). Cosmetic es-AR reply wording and button labels are delegated to the spec phase.
