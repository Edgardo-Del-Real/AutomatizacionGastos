# Apply Progress: shared-expense-split

Status: **DONE — 25/25 tasks implemented.** One pre-existing failure per suite blocks a fully green `pnpm test` certificate (see Risks/Findings); all lines authored by this change pass and typecheck/lint are green.

## Task Checklist (all `[x]` in tasks.md)

- [x] 1.1 RED contracts `movementSchema` carries `sharedTotal` 2000 / null / absent; rejects non-number
- [x] 1.2 GREEN `movementSchema += sharedTotal: z.number().nullable().optional()`; `pnpm --filter @rita/contracts build` OK
- [x] 1.3 Prisma `Expense.sharedTotal Decimal? @db.Decimal(12,2)` + `20261008120000_shared_expense_split/migration.sql` (plain SQL, no backfill); migration deployed to main DB; client regenerated (types + runtime DMMF carry the column)
- [x] 1.4 `NewExpense += sharedTotal?`; repository `create()` passes it through (contract `Expense` untouched per D8)
- [x] 2.1 RED visibility integration: SELECT carries `sharedTotal` (split row) / null (legacy) on `listByOwner`
- [x] 2.2 GREEN `MovementRow += sharedTotal`, both raw SELECTs (`listByOwner`, `topByType`), `mapMovementRow` (null preserved)
- [x] 3.1 RED split unit: 10.00@33% → 3.30/6.70 exact; 40000@50% → 20000/20000
- [x] 3.2 GREEN `createSharedSplit` — 2-row `$transaction` mirroring `createIncomeWithSavings`; both SHARED·EXPENSE·PAID·ARS, same category/note/occurredAt, `sharedTotal=total`; sender under ownerId, partner under partnerId
- [x] 3.3 `ExpenseService.createSharedExpenseSplit` delegates
- [x] 3.4 Integration: two rows, exact sum, owners, rollback on partner-create failure (real `$transaction` wrap)
- [x] 4.1 RED parser: "30%"→30; "25"→25; "30000"/40000→75; "45.000"/90000→50; "$45.000"→50; "45.000 ars"→50; "45,5"→45.5; "100"/"0"/"=total"/amount==total→null
- [x] 4.2 GREEN `parseSharedContributionInput(input, total)` — own es-AR parsing (`.`=thousands, `,`=decimal, `$`/`ars` marks), percent-or-amount vs total, 1..99 only, amount-derived percents rounded to 4dp
- [x] 4.3 RED reply texts: `sharedPercentPromptReply`, `sharedPercentInvalidReply`, `sharedPickFirstReply`, `successSharedReply` (OQ2 `parte de {total} compartido`)
- [x] 4.4 GREEN the four replies in reply-text.ts
- [x] 5.1 `BOT_STATES += "awaiting_shared_percent"`
- [x] 5.2 RED shared-flow suite (10 tests): row rendering (partner/no-partner/non-COMPARTIDO), `sp:50` re-render, `sp:other`→prompt, valid 30→preview, amount→75, invalid→re-prompt keeps state, stale→"ya procesado", Guardar gate→pick-first nothing registers, 2-row split + no SAVINGS, persisted-percent save (5.4)
- [x] 5.3 GREEN service: `previewPayloadSchema.sharedPercent?` (1..99), `sharedPercentPayloadSchema`, `AWAITING_SHARED_PERCENT` route, `handleSharedChoiceCallback` (state+token gate), `handleAwaitingSharedPercent`, `previewConfirmKeyboard(payload, hasPartner)` sp row `[50%][25%][75%][Otro]` token-only partner-only, share line in confirmation, save gate (D7), `registerCapture` split branch
- [x] 5.4 `savePreview` passes `sharedPercent` through; persisted previews without it keep decoding (optional field; existing decode tests green)
- [x] 6.1 RED dashboard: `MovementAmount` annotation + cell assertions + no-annotation legacy
- [x] 6.2 GREEN exported `MovementAmount` rendered in "Monto" cell AND in the dormant `{false &&}` card (OQ1 — gate NOT flipped)
- [x] 7.1 Reword savings COMPARTIDO test → no-partner legacy + explicit no-sharedTotal + partner-present split covered in 5.2
- [x] 7.2 Household integration: 👥 capture now taps `sp:50`, asserts TWO SHARED rows (1000/1000, sharedTotal 2000, same facts); + Guardar-without-percent registers nothing
- [x] 7.3 Integration test COMPARTIDO e2e → legacy single row + `sharedTotal` null assertion; `telegram.service.test.ts` COMPARTIDO → legacy + no `sharedTotal` key; `telegram.bot.test.ts` harness `partnerOf: () => null` reviewed (legacy path preserved, no change needed)
- [x] 7.4 KPI per-viewer: `mine` → own 1000 share (count 1, maxAmount 1000, avgPerMovement 1000, balance −1000); `all`/`shared` → total 2000 (count 2)
- [x] 7.5 `pnpm --filter @rita/api test`, `pnpm --filter @rita/dashboard test`, `pnpm typecheck`, `pnpm lint` — see Test Results (baseline reds documented in Findings)

## Changed Files

| File | Action | What was done |
|---|---|---|
| `packages/contracts/src/index.ts` | Modified | `movementSchema += sharedTotal` (additive, nullable optional) |
| `packages/contracts/src/index.test.ts` | Modified | 4 new contract cases |
| `apps/api/prisma/schema.prisma` | Modified | `Expense.sharedTotal Decimal? @db.Decimal(12,2)` |
| `apps/api/prisma/migrations/20261008120000_shared_expense_split/migration.sql` | Created | `ALTER TABLE "Expense" ADD COLUMN "sharedTotal" DECIMAL(12,2) NULL;` — deployed to main DB |
| `apps/api/src/features/expenses/expenses.types.ts` | Modified | `NewExpense += sharedTotal?` |
| `apps/api/src/features/expenses/expenses.repository.ts` | Modified | `create()` pass-through + `createSharedSplit` (2-row `$transaction`) |
| `apps/api/src/features/expenses/expenses.service.ts` | Modified | `createSharedExpenseSplit` delegate |
| `apps/api/src/features/expenses/expenses.split.test.ts` | Modified | `createSharedSplit` unit (2 cases) |
| `apps/api/src/features/expenses/expenses.split.integration.test.ts` | Modified | 3 integration cases (two rows, even split, rollback) |
| `apps/api/src/features/movements/movements.repository.ts` | Modified | `MovementRow`, both SELECTs, `mapMovementRow` carry `sharedTotal` |
| `apps/api/src/features/movements/movements.repository.visibility.integration.test.ts` | Modified | 2 read-path cases |
| `apps/api/src/features/movements/movements.route.test.ts` | Modified | per-viewer KPI test |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modified | `BOT_STATES += awaiting_shared_percent` |
| `apps/api/src/features/telegram/telegram.commands.ts` | Modified | `parseSharedContributionInput` |
| `apps/api/src/features/telegram/telegram.commands.test.ts` | Modified | 10 parser cases |
| `apps/api/src/features/telegram/reply-text.ts` | Modified | 4 replies + `sharedLineLabel` + `previewConfirmReply` 6th param |
| `apps/api/src/features/telegram/reply-text.test.ts` | Modified | 5 reply cases |
| `apps/api/src/features/telegram/telegram.service.ts` | Modified | schema/payload/state/routing/gate/split/render (Phase 5.3) |
| `apps/api/src/features/telegram/telegram.service.savings.test.ts` | Modified | harness partner option + shared-flow suite (10) + reworded legacy test |
| `apps/api/src/features/telegram/telegram.service.household.integration.test.ts` | Modified | 2-row split + gate test |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Modified | COMPARTIDO e2e legacy + sharedTotal null |
| `apps/api/src/features/telegram/telegram.service.test.ts` | Modified | COMPARTIDO legacy + no sharedTotal key |
| `apps/dashboard/src/features/movements/MovementList.tsx` | Modified | exported `MovementAmount`, both render surfaces |
| `apps/dashboard/src/features/movements/MovementList.test.tsx` | Modified | fixture + 3 tests |

## Test Results (final)

- `pnpm --filter @rita/api test` → **965/966** (36/37 files). The 1 failing test is PRE-EXISTING at HEAD (verified by stashing all changes and re-running — same failure).
- `pnpm --filter @rita/dashboard test` → **168/169** (21/22 files). The 1 failing test is PRE-EXISTING at HEAD (verified identically).
- `pnpm typecheck` → **green** (contracts, api, dashboard).
- `pnpm lint` → **green** (contracts, api, dashboard).
- Targeted green runs: contracts 64, split unit+integration 12, parser 56, reply-text 92, savings+shared suite 26, household integration 9, dashboard MovementList 21, movements route 50 (per-viewer KPI) — all passed with the new code.

## Strict TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1/1.2 | `packages/contracts/src/index.test.ts` | Unit | ✅ 61/61 | ✅ Written | ✅ Passed 64/64 | ✅ 4 cases | ➖ None needed |
| 2.1/2.2 | `movements.repository.visibility.integration.test.ts` | Integration | ✅ 10/10 | ✅ Written | ✅ Passed 12/12 | ✅ 2 cases | ➖ None needed |
| 3.1/3.2 | `expenses.split.test.ts` | Unit | ✅ 4/4 | ✅ Written | ✅ Passed 6/6 | ✅ 2 cases (33% odd, 50% even) | ➖ None needed |
| 3.3 | service delegate | Unit | — | N/A (asserted via 4) | ✅ (integration 3.4) | ➖ Single | ➖ None needed |
| 3.4 | `expenses.split.integration.test.ts` | Integration | ✅ 3/3 | ✅ Written | ✅ Passed 6/6 | ✅ 3 cases + rollback | ✅ Proxy→real-`$transaction` wrap |
| 4.1/4.2 | `telegram.commands.test.ts` | Unit | ✅ 46/46 | ✅ Written | ✅ Passed 56/56 | ✅ 10 cases | ✅ trailing-space trim fix |
| 4.3/4.4 | `reply-text.test.ts` | Unit | ✅ 87/87 | ✅ Written | ✅ Passed 92/92 | ✅ 5 cases | ✅ gate wording contains "porcentaje" |
| 5.1 | `bot-state.repository.ts` | Struct | — | N/A (enum) | N/A (enum) | ➖ Single | Triangulation skipped: purely structural |
| 5.2/5.3 | `telegram.service.savings.test.ts` | Unit | ✅ 16/16 | ✅ Written | ✅ Passed 26/26 | ✅ 10 cases | ✅ `*/` comment fix, harness partner option |
| 5.4 | pass-through test in 5.2 suite | Unit | ✅ 16/16 | ✅ Written | ✅ Passed | ✅ persisted-percent case | ➖ None needed |
| 6.1/6.2 | `MovementList.test.tsx` | Integration (RTL) | ✅ 18/18 | ✅ Written | ✅ Passed 21/21 | ✅ 3 cases | ✅ `ReactElement` type fix |
| 7.1/7.2/7.3 | existing-suite updates | Unit/Integration | ✅ all-but-baseline | N/A (update) | ✅ green | ✅ split + gate cases added | ➖ wording |
| 7.4 | `movements.route.test.ts` | Integration | ✅ 49/49 | ✅ Written (accepted KPI shift locked) | ✅ Passed 50/50 | ✅ mine/all/shared | ➖ None needed |
| 7.5 | full suites | All | — | — | 965/966, 168/169, typecheck ✅, lint ✅ | — | — |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command + result | `pnpm --filter @rita/api exec vitest run src/features/expenses/expenses.split.test.ts src/features/telegram/telegram.service.savings.test.ts` → 26+6 passed, 0 failed; entire change rides these RED→GREEN cycles |
| Runtime harness | Telegram service harness (partner-present COMPARTIDO → `sp:50` → Guardar → 2-row split) in `telegram.service.savings.test.ts`; real-DB integration in `expenses.split.integration.test.ts` + `telegram.service.household.integration.test.ts` (both persisted two SHARED rows, 1000/1000, `sharedTotal` 2000) |
| Rollback boundary | Revert the 24 changed files; the new column stays inert (NULL) or `DROP COLUMN "sharedTotal"`; legacy paths (no partner / no `sharedTotal`) behave exactly as before |

## Deviations from Design

1. **Task 1.4 wording vs D8**: "Extend `Expense`/`NewExpense`" — `Expense` (the contract type re-exported from `expenseSchema`) was intentionally NOT extended, because D8 forbids touching `expenseSchema`; `sharedTotal` is exposed only via `movementSchema`. `NewExpense` gained the optional field and `create()` persists it when present. No runtime deviation from design.
2. **Amount-derived percent rounding**: `parseSharedContributionInput` rounds amount-derived percents to 4 decimal places (e.g. 33.3333…) to keep persisted payloads clean. D9 (fractional percent) is honored; exact spec cases (50, 75, 45.5) are unaffected. Documented here for transparency.
3. **`previewConfirmReply` signature**: extended with a 6th optional `sharedPercent` param + `sharedLineLabel` ("Tu parte: X%") — D6's share line without overloading the savings param. Additive; all 4-arg callers unchanged.

## Findings / Issues

- **PRE-EXISTING (not introduced by this change, per strict-tdd Safety Net → reported, not fixed)**:
  1. `apps/api/src/features/telegram/telegram.service.test.ts:724` — "selects a category via cat:<id> and sends a NEW confirmation message" asserts `kb[0][0].text === "Cafe"` but the two-step confirmation keyboard's first row is `[✅ Guardar][✏️ Corregir]` (stale assertion from the two-step refactor). Verified failing at HEAD with the full suite. Suggested one-line fix: assert the PREVIEW keyboard (`keyboards.at(-2)` after `cat:`) contains "Cafe", or flip to the confirmation shape.
  2. `apps/dashboard/src/features/movements/SummarySection.test.tsx:122` — "renders the section content with the loaded summary" cannot find `$ 3.000,00`. Fails identically at HEAD with all changed files stashed (deterministic, not date-related to this change). Appears to be a stale fixture/rendering contract; out of scope.
- **ENV**: `prisma generate` exits 1 on the engine-DLL swap because a dev server (`tsx watch`) holds `query_engine-windows.dll.node`; the generated client types + runtime DMMF DO carry `sharedTotal` (verified in `.prisma/client/index.d.ts` / `index.js`). A clean `prisma generate` completes after the dev servers stop.
- Decimal formatting: decimal.js does not pad trailing zeros in `.toString()` (3.3 vs 3.30); assertions use numeric values; the DB column stores DECIMAL(12,2).

## Workload / PR Boundary

- Mode: single work unit (ask-on-risk; ~700 authored lines within the accepted 2000 budget). NO commits, NO PR per run policy.
- Boundary: schema → contracts → read path → split registration → parser/replies → bot state/callbacks → dashboard annotation → existing-suite updates.
- Estimated review budget impact: ~700 lines incl. tests.

## Status

25/25 tasks complete. Ready for **verify**, with the two pre-existing baseline failures documented above (verify should re-run on a clean baseline or accept the documented baseline).