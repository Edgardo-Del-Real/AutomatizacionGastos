# Tasks: Manual Savings Registration

## Review Workload Forecast

Estimated changed lines (additions + deletions, tests included): PR1 ~100 · PR2 ~290 · PR3 ~255 · total ~645. As one PR this is High vs the 400 guard (fits the session 5000 budget but not review focus); the 3-slice chain keeps every review unit under 400.

| Field | Value |
|-------|-------|
| Estimated changed lines | ~645 total (PR1 ~100, PR2 ~290, PR3 ~255) |
| 400-line budget risk | Medium overall (Low / Medium / Low per slice; High as a single PR) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 (stacked to main) |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

Threat matrix: N/A per design — no new shell/subprocess/git/executable/process-integration boundaries; `sa:manual` follows the existing in-process `dispatchCallback` path.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Data model + additive contracts + migration pins | PR 1 | `pnpm --filter @rita/contracts build && pnpm --filter @rita/api exec vitest run src/features/savings/savings.migration.integration.test.ts src/features/movements/movements.savings.integration.test.ts src/features/expenses/expenses.repository.test.ts` | docker PG 16 up (`docker compose up -d --wait`); `migrate deploy` + `prisma generate`; legacy rows stay NULL; summary byte-identical | `DROP COLUMN "savingsOrigin"; DROP TYPE "MovementSavingsOrigin";` + revert contract fields; nothing backfilled |
| 2 | KPI/guards: summaryManualSavings + balance + PATCH pin + create-guard + createManualSavings + wiring + kpis.manualSavings (one unit) | PR 2 | `pnpm --filter @rita/api exec vitest run src/features/movements src/features/expenses/expenses.manual-savings.integration.test.ts src/features/expenses/expenses.route.test.ts` | real API on docker PG: POST /expenses `{type:"SAVINGS",amount:50}` → GET /movements/summary → balance = income − expenses − 50, manualSavings 50 | revert service/repo/app wiring; any MANUAL rows turn inert (deduction code gone); no data repair |
| 3 | Bot surface: `sa:manual` sub-menu, AWAITING state, text command, replies, setMyCommands, help | PR 3 | `pnpm --filter @rita/api exec vitest run src/features/telegram` | bot boot with token (Telegram): 💰 Ahorro → 4 actions → `sa:manual` → "500 fondo vacaciones" → confirm + menu; `registrar ahorro manual: 500` → saved | revert bot files; state leaves `BOT_STATES` → `normalizeState` returns owners to idle |

## Slice 1 — PR 1: Data Model & Additive Contracts

- [x] 1.1 RED `apps/api/src/features/savings/savings.migration.integration.test.ts` (extend): static pins — dir `*_manual_savings_origin/migration.sql` = `CREATE TYPE "MovementSavingsOrigin"` + `ADD COLUMN "savingsOrigin" … NULL`, no UPDATE/DELETE on "Expense"; DB pins — enum {AUTO_SPLIT, MANUAL}; raw insert without origin persists NULL (→ Migration preserves legacy rows). Run with docker PG 16 up first (localhost:5433).
- [x] 1.2 GREEN: add `enum MovementSavingsOrigin` + nullable `savingsOrigin` to `Expense` in `apps/api/prisma/schema.prisma` (beside `sharedTotal`, inert-NULL comment); hand-write `apps/api/prisma/migrations/20261012HHMMSS_manual_savings_origin/migration.sql` (plain SQL, no backfill); `npx prisma migrate deploy` + `npx prisma generate` → 1.1 green.
- [x] 1.3 RED→GREEN `packages/contracts/src/index.test.ts` + `packages/contracts/src/index.ts`: `movementSavingsOriginSchema`; `movementSchema.savingsOrigin` nullable-optional (AUTO_SPLIT row ✓, legacy row ✓); `createMovementSchema.savingsOrigin` + D8 refine (SAVINGS+absent ✓, SAVINGS+MANUAL ✓, SAVINGS+AUTO_SPLIT ✗, EXPENSE+MANUAL ✗); then `pnpm --filter @rita/contracts build` (→ create scenarios, carried/omitted on read).
- [x] 1.4 RED `apps/api/src/features/movements/movements.savings.integration.test.ts` (extend): `createIncomeWithSavings` row reads back `savingsOrigin === "AUTO_SPLIT"` via raw Prisma (→ Auto-split stamps AUTO_SPLIT).
- [x] 1.5 GREEN `apps/api/src/features/expenses/expenses.types.ts` (`NewExpense.savingsOrigin`) + `apps/api/src/features/expenses/expenses.repository.ts` (`create` conditional spread; `createIncomeWithSavings` stamps AUTO_SPLIT on its SAVINGS row, INCOME row origin-less) → 1.4 green.
- [x] 1.6 Slice sweep: contracts build + filtered API tests + `pnpm --filter @rita/api typecheck lint` green (dashboard untouched).

## Slice 2 — PR 2: KPI, Guards & Wiring

- [x] 2.1 RED `packages/contracts/src/index.test.ts`: `movementSummarySchema.kpis` requires `manualSavings: z.number()` → fails now.
- [x] 2.2 GREEN `packages/contracts/src/index.ts`: add `manualSavings` to kpis; build — contract ships WITH its emitter (one work unit, dashboard lockstep).
- [x] 2.3 RED `apps/api/src/features/movements/movements.savings.integration.test.ts` (extend; `SeedMovement` + `savingsOrigin?`): 900/300/MANUAL-50 → balance 550, manualSavings 50 (→ Manual savings deduct); mixed month → 550, savings 150, manualSavings 50 (→ Mixed month totals); period-scope 50 vs prior 30 with from/to (→ deduct within the period); seeded NULL-origin → manualSavings 0, existing :210-224 guard byte-identical (→ history identical); delete manual → balance 600 (→ Deleting returns the money).
- [x] 2.4 RED `apps/api/src/features/movements/movements.repository.visibility.integration.test.ts`: partner INDIVIDUAL MANUAL excluded from `summaryManualSavings` + balance (→ follow the viewer predicate).
- [x] 2.5 GREEN `apps/api/src/features/movements/movements.repository.ts`: `MovementRow.savingsOrigin` + `mapMovementRow` + column in `listByOwner`/`topByType` SELECTs; `summaryManualSavings(scope, period)` (viewer predicate, ARS, SAVINGS, origin=MANUAL, period bounds).
- [x] 2.6 GREEN `apps/api/src/features/movements/movements.service.ts`: 10th `Promise.all` entry `summaryManualSavings(scope, period)` + D3 scope comments at BOTH savings call sites; `balance = kpis.income − kpis.expenses − manualSavings`; `kpis.manualSavings` in the return.
- [x] 2.7 RED `apps/api/src/features/movements/movements.service.test.ts` (unit, mocked): `summaryManualSavings` called with the REQUESTED period (≠ thisMonthPeriod); balance formula 900−300−50=550; `kpis.manualSavings` present.
- [x] 2.8 RED `apps/api/src/features/movements/movements.patch-guard.integration.test.ts`: MANUAL PATCH category "bolsillo" → 422 row unchanged; `null` → 422 (→ drift/null rejected); amount 80 → applied, balance recomputes (→ amount edit allowed); AUTO_SPLIT + NULL-origin keep category freedom (→ AUTO_SPLIT freedom kept).
- [x] 2.9 GREEN `apps/api/src/features/movements/movements.service.ts` `updateMovement`: widen to `category !== undefined` (null included); SAVINGS ∧ MANUAL ∧ category ≠ "ahorro" → 422 ValidationFailedError; `assertOwnerCategory` only for non-null.
- [x] 2.10 RED new `apps/api/src/features/expenses/expenses.manual-savings.integration.test.ts` (+ `apps/api/src/features/expenses/expenses.route.test.ts`): POST SAVINGS 50 → 201 row MANUAL·ahorro·PAID·INDIVIDUAL (→ created via API; origin observable via GET /movements); "bolsillo" → 422 nothing stored (→ Category enforced); absent → "ahorro" (→ defaulted); AUTO_SPLIT → 422 (→ AUTO_SPLIT rejected); amount 0 → 422; origin on non-SAVINGS create → 422 (D8).
- [x] 2.11 GREEN `apps/api/src/features/expenses/expenses.service.ts`: 2nd constructor param `categoryService` (D6); SAVINGS branch = `ensureAhorro` + category check + stamp MANUAL·PAID·INDIVIDUAL·ARS; `createManualSavings({ownerId, amount, note?, occurredAt})` (D7).
- [x] 2.12 Wiring: `apps/api/src/app.ts` move category wiring above `new ExpenseService` + pass; `apps/api/src/scripts/cleanup-phantom-data.ts` build `CategoryService`; update `apps/api/src/features/expenses/expenses.service.test.ts` ctor + 2 telegram integration stubs.
- [x] 2.13 Slice sweep: contracts build + API tests + typecheck + lint green.

## Slice 3 — PR 3: Bot Surface

- [x] 3.1 RED `apps/api/src/features/telegram/telegram.commands.test.ts`: amount-only; amount+note (spelling preserved); `0`/`abc`/empty → `manual-savings-invalid`; `/registrar_ahorro_manual` normalizes; `registrar ahorro: manual al 10%` → savings-rule keyword "manual" (→ Rule stays a rule, disjoint); manual checked BEFORE rule (order pin).
- [x] 3.2 GREEN `apps/api/src/features/telegram/telegram.commands.ts`: `manual-savings` / `manual-savings-invalid` variants; `MANUAL_SAVINGS_RE` BEFORE `SAVINGS_RULE_RE` in `parseCommand`; `parseManualSavingsPayload` (first-token es-AR amount, remainder = note, null when non-numeric/≤0/empty).
- [x] 3.3 RED `apps/api/src/features/telegram/reply-text.test.ts`: prompt (monto + nota opcional), saved (formatARS amount), invalid (nothing stored); ayuda mentions both commands + 💰 button (→ Static Help).
- [x] 3.4 GREEN `apps/api/src/features/telegram/reply-text.ts`: three es-AR replies + help 💰 line and command list.
- [x] 3.5 RED `apps/api/src/features/telegram/telegram.bot.test.ts` (extend :447 pin): `registrar_ahorro_manual` present in the `setMyCommands` list (→ Savings commands registered).
- [x] 3.6 GREEN `apps/api/src/features/telegram/telegram.bot.ts`: `BOT_COMMANDS` + `{ command: "registrar_ahorro_manual", … }`.
- [x] 3.7 RED `apps/api/src/features/telegram/telegram.service.test.ts` (extend): `sa:menu` renders FOUR actions incl. `sa:manual` (9-byte payload ≤ 64, buildCallbackData) (→ four-action sub-menu); `sa:manual` → state + prompt (→ Sub-menu action starts capture); "500 fondo vacaciones" → `createManualSavings({ownerId,500,note,occurredAt})` + saved reply + menu (→ valid capture); "abc" → re-prompt, state kept, nothing stored (→ unparseable re-prompts); "0" → re-prompt (D10); idle text command → create + confirm + menu; invalid command → invalid reply, nothing stored; command during `AWAITING_MANUAL_SAVINGS` → supersedes (+ menu).
- [x] 3.8 GREEN `apps/api/src/features/telegram/telegram.service.ts`: `AWAITING_MANUAL_SAVINGS` constant; `sa:manual` case + 4-action keyboard in `handleSavingsAdminCallback`; `manualSavingsPayloadSchema = z.object({})`; state-switch case → `handleAwaitingManualSavings` (captureParse; ≤ 0 re-prompt D10, state kept); `handleCommand` `manual-savings` / `manual-savings-invalid`; `closeSavingsInputState` extended; `registerManualSavings` (D7 — no pre-`ensureAhorro`).
- [x] 3.9 GREEN `apps/api/src/features/telegram/bot-state.repository.ts`: `"awaiting_manual_savings"` in `BOT_STATES` (keeps `normalizeState` recovery honest).
- [x] 3.10 Slice sweep: API tests + contracts build + typecheck + lint green (sole failure = known pre-existing telegram cat:<id>, reproduced identical on PR2 code).

## Phase 4: Chain Verification

- [x] 4.1 Full-sweep integration gate: `pnpm --filter @rita/contracts build` (lockstep) + `pnpm --filter @rita/api test` + `pnpm typecheck` + `pnpm lint` — all green across the 3-slice chain; confirm rollback drill (PR1 down-step idempotent, PR2 MANUAL rows inert after revert, PR3 `AWAITING_MANUAL_SAVINGS` owners recover to idle via `normalizeState`).