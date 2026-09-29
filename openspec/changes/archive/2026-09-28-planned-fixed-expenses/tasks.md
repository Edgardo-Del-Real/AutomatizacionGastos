# Tasks: Planned Fixed Expenses

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main (resolved by user at apply — PR 1 = Phase 1, PR 2 = Phase 2, PR 3 = Phase 3, PR 4 = Phase 4; each merges to main in order)
400-line budget risk: High

Estimated changed lines: ~1400–1700 (no goldens).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Contracts + status migration | PR 1 (done — apply slice 1) | `pnpm --filter @rita/contracts test` | `prisma migrate deploy` :5433 | Revert contracts + migration |
| 2 | Movements core | PR 2 | `pnpm --filter @rita/api test movements` | `app.inject` :5433 | Revert movements/expenses |
| 3 | Telegram previsto: + planned query | PR 3 | `pnpm --filter @rita/api test telegram` | Bot flow, Groq optional | Revert telegram/ |
| 4 | Dashboard planned UI | PR 4 | `pnpm --filter @rita/dashboard test` | Dev server vs API | Revert dashboard/ |

## Phase 1: Contracts + Migration

- [x] 1.1 RED `packages/contracts/src/index.test.ts`: status values; PENDING-INCOME rejected; `{status}`/`{occurredAt}` empty-patch rejected; `planned` parses
- [x] 1.2 Add `movementStatusSchema`, `movementSchema.status?`, `createMovementSchema.status` EXPENSE-refine, `movementSummarySchema.planned` in `packages/contracts/src/index.ts`; `pnpm --filter @rita/contracts build`
- [x] 1.3 `enum MovementStatus { PENDING PAID }` + `status @default(PAID)` in `apps/api/prisma/schema.prisma`
- [x] 1.4 Create `apps/api/prisma/migrations/20260928100000_movement_status/migration.sql` (`CREATE TYPE` + `ADD COLUMN ... DEFAULT 'PAID'`); deploy + generate

## Phase 2: Movements Core

- [x] 2.1 RED `movements.route.test.ts`: per-aggregate exclusion (900/300/PENDING 2500 ⇒ 900/300/600); summaryMonths SAVINGS+PENDING; planned next-month, ignores from-to, zero; BA boundary
- [x] 2.2 RED mark-paid: 200→PAID+now in KPIs; PAID/INCOME→409; missing/owner→404; double→409
- [x] 2.3 `movements.repository.ts`: `PENDING_EXCLUDED` in 4 summaries + topByType (keep savings CASE); `"status"` in SELECTs; `listByOwner` unfiltered
- [x] 2.4 `movements.repository.ts`: `summaryPlanned(scope, month)`; `markPaidById` guarded; `ConflictError` 409 in `infra/errors.ts`
- [x] 2.5 `movements.service.ts`: `nextBaMonth()`, `getSummary.planned`, `markMovementPaid`; `movements.route.ts` `POST /movements/:id/paid`
- [x] 2.6 `expenses.repository.ts`: `create` persists `status ?? "PAID"`; PATCH pending (2600 stays PENDING)

## Phase 3: Telegram

- [x] 3.1 RED `telegram.service.test.ts`: `previsto: 2500 alquiler` → PENDING EXPENSE + confirmation (brain & brain-absent); `compartido:`+`previsto:` both orders; no savings split
- [x] 3.2 RED `query-executor.test.ts` planned (4000) + redirect; `movement-corrector.test.ts` PENDING → no_match; recent omits PENDING
- [x] 3.3 `telegram.parser.ts` `parseArrivalPrefixes` (strips `compartido:`/`previsto:` any order); `telegram.service.ts` `planned` → EXPENSE+PENDING, skip split, persist payload, `plannedReply`
- [x] 3.4 `query.types.ts`/`query-executor.ts`: `"planned"` type + executor; recent filters PENDING; `movement-corrector.ts` window excludes PENDING
- [x] 3.5 `reply-text.ts` planned replies; `bot-brain.ts` `query_planned` + facts + prompts; regenerate 8 goldens in-cycle (3 change bytes)

## Phase 4: Dashboard

- [x] 4.1 RED `PlannedSection.test.tsx` (es-AR total, $0), `App.test.tsx` (after KpiCards), `MovementList.test.tsx` (badge, Marcar pagado, 409), `useMovementMutations.test.tsx` (refresh)
- [x] 4.2 `infra/api.ts` + `useMovementMutations.ts`: `createPlannedMovement` (POST `/api/expenses`), `markMovementPaid`, `markPaid` + `createPlanned`
- [x] 4.3 Create `PlannedSection.tsx`: next-month es-AR label, total, "Agregar previsto" form (positive-amount guard, Spanish error, no API call)
- [x] 4.4 `App.tsx` render after `KpiCards`; `MovementList.tsx` Previsto badge + Marcar pagado (own rows; 409 → error)

## Phase 5: Verification + Rollback

- [x] 5.1 Suites green: `pnpm --filter @rita/api test` (814/814), `pnpm --filter @rita/dashboard test` (161/161), `pnpm typecheck` clean — verified 2026-09-28
- [x] 5.2 Rollback note: revert PRs; `DROP COLUMN "status"` + `DROP TYPE "MovementStatus"` (default-only backfill) — recorded in verify-report.md