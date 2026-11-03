# Exploration: Manual Savings Registration (change `manual-savings`)

Status: exploration (sdd-explore)
Date: 2026-10-12
Repo: AutomatizacionRita (pnpm monorepo — apps/api Fastify+Prisma+grammY, apps/dashboard Vite+React read-only, packages/contracts, openspec canonical specs)
Owner intent (verbatim, Spanish): "registrar un ahorro de x monto" that "sale desde el total de ingresos pero no representa un gasto como tal", and the "dinero restante" (Disponible/balance) must reflect that x amount is no longer available.

---

## 1. Product Context

The owner wants a STANDALONE manual savings registration: register amount `x` as savings, NOT tied to an income registration and NOT an expense. Net effect on the UI/bot numbers:

- `Disponible` (balance) must decrease by `x` (the money is reserved, no longer available for spending).
- The registration must not appear in expense totals nor per-category expense breakdowns.
- It is a distinct action from the existing automatic income-split savings rules (`registrar ahorro: X al Y%`).

Product decisions still owned by the orchestrator (flagged, not resolved here):
- How the owner triggers it (bot menu button inside the 💰 Ahorro sub-menu vs. a text command vs. both).
- Whether manual savings counts in `kpis.savings` ("Ahorro del mes") — strongly suggested yes.
- Default visibility (INDIVIDUAL suggested; SHARED is observable via the viewer predicate if ever chosen).

---

## 2. Codebase Facts (verified, file:line)

### 2.1 Money model and KPI invariants

- `MovementType` enum: `EXPENSE | INCOME | SAVINGS` — `apps/api/prisma/schema.prisma:10-14`; contract `movementTypeSchema` at `packages/contracts/src/index.ts:44`.
- `Expense` model (`apps/api/prisma/schema.prisma:34-52`): `type` defaults to EXPENSE, `category` is a free-text `String?` (NOT a FK), `visibility` defaults INDIVIDUAL, `sharedTotal` nullable. There is NO column distinguishing an auto-split SAVINGS row from a future manual one (no sourceIncomeId / savingsRuleId / origin field).
- Balance is computed in the service: `movements.service.ts:94` → `const balance = kpis.income - kpis.expenses;`.
- `SAVINGS_EXCLUDED` fragment: `movements.repository.ts:91` → `"type" <> 'SAVINGS'::"MovementType"`, composed into `summaryKpis` (line 193), `summaryDaily` (line 267), `summaryCategories` (line 300). `summaryMonths` (line 226-261) does NOT compose it, but its income/expense CASE columns only sum INCOME/EXPENSE types, so SAVINGS rows are excluded from those columns too; it adds a dedicated SAVINGS CASE column for per-month savings.
- `summaryKpis` (`movements.repository.ts:189-224`): `income` = SUM(amount) where type=INCOME, `expenses` = SUM(amount) where type=EXPENSE; excludes SAVINGS and PENDING.
- `summarySavings` (`movements.repository.ts:351-365`): SUM(amount) where type=SAVINGS, viewer-scoped, ARS, **always called with the current-month period** (`movements.service.ts:80-82`, D3). So `kpis.savings` = current-calendar-month SAVINGS sum regardless of `from`/`to`.
- `summaryMonths` (`226-261`): income = net INCOME per month; savings column = SAVINGS sum per month (covers last 6 months including current).
- `summaryDaily` / `summaryCategories` / `topByType`: SAVINGS fully excluded.
- `movementSummarySchema` (`packages/contracts/src/index.ts:155-206`) carries `kpis.savings`. Dashboard renders "Ingresos"/"Gastos"/"Disponible"/"Ahorro del mes" from `kpis.income/expenses/balance/savings` (`apps/dashboard/src/features/movements/KpiCards.tsx:70-79`); fetched at `apps/dashboard/src/infra/api.ts:167-178`. Dashboard is read-only by design (`apps/dashboard/package.json:6`), no create form — out of scope for the UI; only the API value changes matter.

### 2.2 The ONLY producer of SAVINGS rows today (auto-split)

- `createIncomeWithSavings` — `apps/api/src/features/expenses/expenses.repository.ts:145-198`: transactional, persists NET INCOME (amount = gross − savings, category = netCategory) + SAVINGS row (amount = savings, category = `savingsCategory`, i.e. "ahorro"). Both rows share `visibility` and `occurredAt`. Invoked from `ExpenseService.createIncomeWithSavings` (`expenses.service.ts:61-72`) → bot-only path `registerIncomeSplit` (`telegram.service.ts:1863-1891`), which always passes `visibility: "INDIVIDUAL"` and `savingsCategory: "ahorro"` and ensures the category exists (`ensureAhorro`).
- Pre-redesign shared incomes could produce SHARED SAVINGS (legacy data; the SHARED inheritance requirement is in the `savings` spec).
- The net income row is INCOME type only → `kpis.income` for a split month is already NET (e.g. gross 1000 → INCOME 900 + SAVINGS 100). The test at `movements.savings.integration.test.ts:210-224` asserts income=900, expenses=300, balance=600 for exactly this shape, and `savings` spec "KPI-Exclusion Invariants" (balance = net income − expenses) confirms the semantic.

**This is the crux**: balance already excludes auto-split savings implicitly because the net income row is net. Subtracting a running TOTAL of all SAVINGS rows from balance would double-count every auto-split (900 − 300 − 100 = 500 ≠ 600 correct).

### 2.3 Category guard

- "ahorro" is the reserved SAVINGS category: `categories.service.ts:8` (`AHORRO`), `ensureAhorro` (:144-147), create/rename/delete guards (D9: `SavingsForbiddenError` on PATCH rename/delete; `assertOwnerCategory` :159-183 rejects SAVINGS category on EXPENSE/INCOME movements and non-SAVINGS categories are rejected when typed INCOME/EXPENSE; the SAVINGS movement type itself is only restricted by category typing rules, not the "ahorro" name).
- `POST /expenses` accepts `type: "SAVINGS"` via `createMovementSchema` (`contracts/src/index.ts:108-118`, optional `type`) and `createExpense` (`expenses.service.ts:19-33`), but there is NO creation-side ahorro-category assertion — a SAVINGS movement could be created with any category via the API. The guard exists only on PATCH (via `updateMovement`) and on bot creation paths.

### 2.4 Bot wiring (deterministic surfaces)

- Command router: `telegram.commands.ts` — `registrar ahorro: X al Y%` → savings-rule (SAVINGS_RULE_RE :23), `listar ahorros` (:26), `borrar ahorro: X` (:27). These define RULES, not savings registrations.
- Main menu = exactly 8 buttons (`telegram.service.ts:621-642`); 💰 Ahorro entry lives on the Ayuda reply (`:613-618`) → `sa:menu` sub-menu with 3 actions: `sa:new`, `sa:list`, `sa:del` (`handleSavingsAdminCallback` :1082-1170; spec `bot-manage-savings` "Sub-Menu Entry" — main menu must NOT gain a ninth button).
- INGRESO capture preview offers the per-income savings choice `sv:5/10/other/off` (`previewConfirmKeyboard` :792-817, `handleSavingsChoiceCallback` :957-1013); final persistence `registerCapture` :1802-1853 → `resolveSplit` :1815 → `registerIncomeSplit`.
- Bot brain (bot-brain.ts) has NO `create_savings_rule` intent anymore (legacy/rejected) — new flows MUST be deterministic menu/command, NOT brain intents.
- Bot reads balance and month savings from the same summary (`query-executor.ts:72-80` balance, :96-103 savings).

### 2.5 Tests that assert balance invariants

- `movements.savings.integration.test.ts` — "GET /movements/summary computes balance = income − expenses with SAVINGS excluded" (:210-224, income 900/expenses 300/savings 100/balance 600); "reports kpis.savings month-scoped" (:166-178, 150 current month, prior excluded); mom per-month savings (:181-195).
- `movements.service.test.ts` — `getSummary` harness mocks `summaryKpis`/`summarySavings` and asserts call shapes (:166-276); a formula change adds anew repository call the harness must mock.
- `expenses.split.integration.test.ts` — rounding invariant net+savings=gross (:45-65), pct=100 edge (:76-82), savings-0 edge (:88-102).
- `movements.status.integration.test.ts` — no SAVINGS/balance assertions found (PENDING focus) → unaffected.
- `movements.repository.visibility.integration.test.ts` — viewer scoping of summary feeds (:290-308) → a new manual-savings sum must follow the viewerPredicate (shared partner rows count when visible).
- `categories.service.savings.integration.test.ts`, `savings.migration.integration.test.ts`, `telegram.service.savings.test.ts` — savings-rule domain; a migration adding a column affects `savings.migration.integration.test.ts` (it validates legacy row shape).

---

## 3. Approaches

### Option A — Discriminator column (`origin`/`source`) on the movement model + balance formula reposition

Move:
- Prisma migration: add nullable/enum column, e.g. `savingsOrigin MovementSavingsOrigin?` (enum `AUTO_SPLIT | MANUAL`, or `Origin` enum) on `Expense`. Default mapping: existing/historical SAVINGS rows are all auto-split (the only producer is `createIncomeWithSavings`), so a NULL or `AUTO_SPLIT` backfill keeps every historical invariant intact — zero double-count risk.
- `createIncomeWithSavings` writes `AUTO_SPLIT` on the SAVINGS row.
- New `createManualSavings` (repository/service): single SAVINGS row, `origin=MANUAL`, category enforced to "ahorro" (`ensureAhorro` + creation guard), `visibility=INDIVIDUAL` (default), `status=PAID`, ARS.
- Repository: new `summaryManualSavings(scope, period)` — SUM(amount) WHERE type=SAVINGS AND origin=MANUAL, viewer-scoped, ARS, period-scoped (respects from/to like income/expenses — unlike `summarySavings` which is month-always).
- Service `movements.service.ts`: `balance = kpis.income - kpis.expenses - manualSavings`. `kpis.savings` may stay ALL-SAVINGS (auto+manual) for the "Ahorro del mes" card, or add a discriminator variant — orchestrator/product decision; "manual counts" = yes is the cheap coherent default because `summarySavings` unchanged already sums every SAVINGS row this month.
- mom/daily/categories: unchanged (SAVINGS excluded as today; per-month savings column already sums all SAVINGS rows).
- Contracts: no change needed to `movementSummarySchema` (balance semantics just honest for manual rows); optionally expose `origin` additively on `movementSchema` (like `sharedTotal` precedent, `contracts/src/index.ts:60-73`).
- API: mirror `POST /expenses` with a dedicated route (e.g. `POST /movements` or `POST /savings`) that enforces `type=SAVINGS ∧ origin=MANUAL ∧ category=ahorro ∧ visibility`; or keep creation bot-internal only (dashboard is read-only; the API route is only needed for tests/curl).
- Bot: new deterministic entry — `sa:manual` button in the existing 💰 Ahorro sub-menu (4th action; spec `bot-manage-savings` says the sub-menu renders exactly three actions → delta spec MODIFIED) and/or a text command `registrar ahorro manual: X` (new regex, no collision with `registrar ahorro: X al Y%`).
- PATCH/DELETE: already work on SAVINGS rows via `/movements/:id` — amount/category/note edits and deletes flow through the existing endpoints with zero new surface. PATCH category guard: existing D9 allows SAVINGS rows to switch away from "ahorro" only if the new category is NORMAL/MIXED-typed; a manual-savings row SHOULD keep "ahorro" — optional extra guard or accepted gap.

Pros: honest invariants for ALL history (formula changes only affect MANUAL rows, which don't exist yet); zero double-count; minimal formula surface (one new sum + one subtraction); reuses the whole SAVINGS row infrastructure (list, PATCH, DELETE, category guard, viewer scoping, month savings); kpis.savings semantics unchanged-yet-correct for the product default; backward compatible.
Cons: one migration + enum; a new repository query; PATCH category edge needs a decision; historical rows get a NULL/AUTO_SPLIT default (inert).
Effort: Medium (migration + 3-4 code sites + bot entry + tests).

### Option B — No discriminator; reposition the balance formula over ALL SAVINGS

`balance = income - expenses - ALL_savings_sum` with no new column.

Analysis: **incorrect with historical data, always.** Auto-split months already carry net income (INCOME 900 + SAVINGS 100 for gross 1000). Subtracting the 100 again → balance 500 instead of 600; every existing split month and test breaks (`movements.savings.integration.test.ts:210-224` fails; savings spec invariant broken). The ONLY way B becomes correct is redefining `kpis.income` as gross (adding SAVINGS sums back into income), which contradicts the savings spec ("Balance MUST equal net income − expenses", KPI-Exclusion Invariants), rewires mom/daily/top aggregates, and still needs a way to MAX out manual-only for period-scoped balance. Effectively you end up needing the discriminator anyway.
Pros: no migration.
Cons: wrong math today; double-counts all auto-splits; massive spec/test churn (income semantics change ripples through dashboard "Ingresos" card, mom, category percentages, avgPerMovement); still needs discriminator for full correctness.
Effort: High (and still broken → rejected).

### Option C — Other models (alternatives to a discriminator column)

- C1. New movement type (e.g. `MANUAL_SAVINGS` or `SAVINGS_MANUAL`): adds enum value to `MovementType` (Prisma + contract), touches every CASE/aggregate, the SAVINGS_EXCLUDED fragment semantics, category-type guard (CategoryType.SAVINGS only attaches to "ahorro"), `movementFiltersSchema` type filter, summaryMonths savings column, and the month-savings queries. Highest blast radius; the type distinguishes origin exactly like Option A's column but at 10× the surface. Effort: High.
- C2. Separate `SavingsLedger` table (ownerId, amount, occurredAt, ...): cleanest domain separation, but duplicates movement CRUD, viewer scoping, PATCH/DELETE endpoints, category enforcement, and the summary plumbing (a new ledger sum + merge with savings card); no existing table or pattern to reuse; adds a second money source that mom/daily/categories must reconcile. Effort: High.
- C3. Model manual savings as a negative INCOME (or reserved EXPENSE): pollutes `kpis.income`/`expenses` and category breakdowns; contradicts "no representa un gasto"; breaks the "Ingresos" card meaning. Rejected.
- C4. Reserved EXPENSE in "ahorro": would count as an expense in `expenses`/categories — directly contradicts the product statement. Rejected.

---

## 4. Comparison

| Approach | Migration cost | Correctness invariant (balance = income − expenses − manual-only) | kpis.savings behavior | Visibility semantics | Edit/Delete | Spec/contract touch | Effort |
|---|---|---|---|---|---|---|---|
| A. Discriminator column | Low (1 column, inert backfill) | ✅ holds for all history + future | Unchanged query, sums auto+manual (product default "yes") | INDIVIDUAL default; viewer predicate already covers SHARED if chosen | Free (existing PATCH/DELETE on SAVINGS rows) | `money-movements` (balance), `savings` (new manual req), `bot-manage-savings` (4th sub-menu action / command); contracts additive only | Medium |
| B. Formula over all SAVINGS, no column | None | ❌ double-counts every auto-split; breaks existing tests/spec | Would need manual/auto split anyway | n/a | n/a | Massive (income semantics change) | High (rejected) |
| C1. New movement type | Medium (enum) | ✅ possible | Needs CASE updates everywhere | Same as A | Same as A | Enum ripples through contracts/specs/aggregates | High |
| C2. Ledger table | Medium (new table) | ✅ possible | Needs merge with savings card | Same as A | Duplicated surface | Big (new domain) | High |
| C3/C4. Hijack income/expense | None | ❌ pollutes aggregates, contradicts product | n/a | n/a | n/a | Spec conflict | Low (rejected) |

---

## 5. Recommendation

**Option A — discriminator column (`savingsOrigin` enum `AUTO_SPLIT | MANUAL`, nullable, historical rows stay NULL/AUTO_SPLIT) + `balance = kpis.income - kpis.expenses - summaryManualSavings(period)`.**

Rationale:
- The invariants stay honest for every existing row: manual rows do not exist yet, so the formula change is provably inert on history and only acts on NEW manual registrations.
- Blast radius is small and surgical: 1 migration, 1 new sum query (period-scoped, viewer-scoped), 1 subtraction in `movements.service.ts:94`, 1 new creation path, 1 deterministic bot entry, tests.
- It reuses the entire existing SAVINGS infrastructure: category guard ("ahorro"), movement list, PATCH/DELETE, viewer predicate (visibility), `kpis.savings` month card (auto+manual = "Ahorro del mes"), per-month savings columns, monthly/daily bucketing.
- Contracts barely move: `movementSummarySchema` unchanged; optionally expose `origin` additively on `movementSchema` following the `sharedTotal` precedent (additive optional field).

Design decisions to lock during proposal:
1. Bot entry: add a 4th action `sa:manual` to the 💰 Ahorro sub-menu (delta MODIFIED on `bot-manage-savings` "Sub-Menu Entry" which currently asserts exactly three actions) and/or a text command `registrar ahorro manual: X` (new `TelegramCommand` variant; no regex collision with `SAVINGS_RULE_RE`).
2. Manual savings flow shape: amount + optional note; category forced "ahorro"; occurredAt = registration date; visibility INDIVIDUAL default (SHARED remains expressible).
3. Does manual count in `kpis.savings` ("Ahorro del mes")? Recommended YES (it is money saved this month; `summarySavings` already sums all SAVINGS rows — zero code).
4. PATCH guard: decide whether a MANUAL SAVINGS row's category must stay "ahorro" (extra guard) or whether existing D9-level freedom is acceptable (documented gap).
5. API surface: dedicated `POST /movements` (type SAVINGS + origin MANUAL + ahorro enforced + visibility) vs. bot-internal-only creation. Dashboard is read-only, so the route is for tests/consumers other than the bot; recommend a thin route mirroring `POST /expenses` for symmetry and validation, plus a create-time ahorro assertion (fixing the current creation-side gap noted in 2.3).

"Ready for Proposal": Yes.

---

## 6. Risks

- Double-count regression risk if the formula subtracts ALL SAVINGS (Option B trap) — Option A is immune by construction, and the existing integration test (`movements.savings.integration.test.ts:210-224`) guards the 600=900−300 invariant.
- `summarySavings` is month-always while the manual deduction MUST be period-scoped — introducing `summaryManualSavings(scope, period)` instead of reusing `summarySavings` avoids conflating the "Ahorro del mes" card with the balance deduction; mild risk that a future editor conflates the two.
- Historical rows: no backfill needed if the column is nullable/NULL=legacy; a required column with a default needs a migration guard to keep `savings.migration.integration.test.ts` green.
- PATCH on a manual SAVINGS row can currently move category/amount freely; amount edits automatically re-compute balance (desired); category drift away from "ahorro" is a semantic gap unless guarded.
- Bot callback-payload size limits (8 rows / 64 bytes per callback, spec bot-inline-interactions) constrain the new sub-menu render — 4 buttons are fine, but the manual flow's preview keyboard must stay within limits.
- Spec surface: `savings` (new manual-savings requirement + scenario), `money-movements` (balance formula wording), `bot-manage-savings` (fourth action), `bot-main-menu` (confirm no ninth main-menu button); contracts additive-only.

---

## 7. Open Questions for the Proposal/Spec Phase

1. Bot entry: `sa:manual` sub-menu button, text command, or both? Exact reply text/templates (reply-text.ts).
2. Manual savings capture UX: single-step (`monto+nota` prompt → preview → Guardar) reusing the existing preview keyboard pattern but without category selection (category fixed "ahorro")?
3. `kpis.savings` inclusion of manual: YES (recommended) or split breakdown?
4. PATCH category guard on MANUAL SAVINGS rows: enforced "ahorro" or existing freedom?
5. API route: thin `POST /movements` (recommended) vs bot-internal-only; create-time ahorro assertion to close the 2.3 gap?
6. Visibility default INDIVIDUAL with SHARED expressible — confirm product preference.