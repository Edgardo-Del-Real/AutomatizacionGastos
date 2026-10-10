# Tasks: Shared Expense Split

## Review Workload Forecast

Estimate: ~650–900 lines (incl. tests); above 400, within the accepted 2000-line budget.

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

Work unit: single PR (schema→bot→dashboard). Test: `pnpm --filter @rita/api test`. Harness: Telegram, 2-member household: 👥 COMPARTIDO "2000 super" → [50%] → Guardar. Rollback: revert; column inert or `DROP COLUMN`; no backfill.

Open questions: OQ1 — annotate the `{false &&}` card too via an extracted exported `MovementAmount`, tested directly; do NOT flip the gate. OQ2 — share line locked to `parte de {total} compartido` (es-AR).

## Phase 1: Data + Contracts
- [x] 1.1 RED `packages/contracts/src/index.test.ts`: split row validates `sharedTotal` 2000; legacy omits/null.
- [x] 1.2 GREEN: add `sharedTotal: z.number().nullable().optional()` to `movementSchema` in `packages/contracts/src/index.ts`; run `pnpm --filter @rita/contracts build`.
- [x] 1.3 Add nullable `sharedTotal Decimal? @db.Decimal(12,2)` to `Expense` in `apps/api/prisma/schema.prisma`; add NULL column in `apps/api/prisma/migrations/20261008120000_shared_expense_split/migration.sql`.
- [x] 1.4 Extend `Expense`/`NewExpense` with `sharedTotal` in `apps/api/src/features/expenses/expenses.types.ts`.

## Phase 2: Movements Read Path
- [x] 2.1 RED `apps/api/src/features/movements/movements.repository.visibility.integration.test.ts`: SELECT carries `sharedTotal` on a split row, null legacy.
- [x] 2.2 GREEN: add `sharedTotal` to `MovementRow`, both SELECTs (`listByOwner`, `topByType`), `mapMovementRow` in `apps/api/src/features/movements/movements.repository.ts`.

## Phase 3: Split Registration
- [x] 3.1 RED `apps/api/src/features/expenses/expenses.split.test.ts`: 10.00@33% → 3.30/6.70; 40000@50% → 20000/20000; exact sum.
- [x] 3.2 GREEN: `createSharedSplit(...)` 2-row `$transaction` (mirror `createIncomeWithSavings`) in `apps/api/src/features/expenses/expenses.repository.ts`; both SHARED·EXPENSE·PAID·ARS, same category/note/occurredAt, `sharedTotal=total`.
- [x] 3.3 Delegate `createSharedExpenseSplit(...)` in `apps/api/src/features/expenses/expenses.service.ts`.
- [x] 3.4 RED→GREEN `apps/api/src/features/expenses/expenses.split.integration.test.ts`: two rows, exact sum, sender/partner owners.

## Phase 4: Parser + Replies
- [x] 4.1 RED `apps/api/src/features/telegram/telegram.commands.test.ts`: "30%"→30, "25"→25, "30000"/40000→75, "45.000"/90000→50, "$45.000"/"45.000 ars"→50, "45,5"→45.5, "100"/"0"/"=total"→null.
- [x] 4.2 GREEN: `parseSharedContributionInput(input, total): number|null` (own es-AR parsing) in `apps/api/src/features/telegram/telegram.commands.ts`.
- [x] 4.3 RED `apps/api/src/features/telegram/reply-text.test.ts`: `sharedPercentPromptReply`, `sharedPercentInvalidReply`, `sharedPickFirstReply`, `successSharedReply` (share + `parte de {total} compartido`).
- [x] 4.4 GREEN: add the four replies in `apps/api/src/features/telegram/reply-text.ts` (OQ2 wording).

## Phase 5: Bot State + Callbacks
- [x] 5.1 Add `"awaiting_shared_percent"` to `BOT_STATES` in `apps/api/src/features/telegram/bot-state.repository.ts`.
- [x] 5.2 RED `apps/api/src/features/telegram/telegram.service.savings.test.ts`: asks percent; `sp:50` re-renders; `sp:other`→prompt; valid 30→preview; invalid→re-prompt; stale→"ya procesado"; Guardar w/o percent→pick-first, nothing registered; no-partner→legacy row; no SAVINGS.
- [x] 5.3 GREEN `apps/api/src/features/telegram/telegram.service.ts`: `previewPayloadSchema.sharedPercent?` (1..99), `sharedPercentPayloadSchema`, `AWAITING_SHARED_PERCENT`, `handleUpdate` route, `handleSharedChoiceCallback` (gated), `handleAwaitingSharedPercent`, `previewConfirmKeyboard` `sp:*` row (50% first, token-only, partner only), confirmation share line, save gate, `registerCapture` split.
- [x] 5.4 Verify `savePreview` passes `sharedPercent` through; persisted previews still decode.

## Phase 6: Dashboard Annotation
- [x] 6.1 RED `apps/dashboard/src/features/movements/MovementList.test.tsx`: "$ 1.000" + "parte de $ 2.000 compartido" (cell + `MovementAmount`); no annotation without `sharedTotal`.
- [x] 6.2 GREEN: extract `MovementAmount`; render it in the "Monto" cell and `{false &&}` card in `apps/dashboard/src/features/movements/MovementList.tsx` (OQ1).

## Phase 7: Existing Tests + Verification
- [x] 7.1 Reword savings "COMPARTIDO NEVER splits…"; add partner-present split case.
- [x] 7.2 Update `apps/api/src/features/telegram/telegram.service.household.integration.test.ts` (~234): two SHARED rows.
- [x] 7.3 Update `apps/api/src/features/telegram/telegram.service.integration.test.ts` (`openPreview`, ~382), `apps/api/src/features/telegram/telegram.service.test.ts` (~936), `apps/api/src/features/telegram/telegram.bot.test.ts` (`partnerOf`).
- [x] 7.4 RED→GREEN: KPI per-viewer (`mine` vs `all`/`shared`; count/maxAmount/avgPerMovement) in `apps/api/src/features/movements/movements.route.test.ts`.
- [x] 7.5 Run `pnpm --filter @rita/api test`, `pnpm --filter @rita/dashboard test`, `pnpm typecheck`, `pnpm lint` — all green.
