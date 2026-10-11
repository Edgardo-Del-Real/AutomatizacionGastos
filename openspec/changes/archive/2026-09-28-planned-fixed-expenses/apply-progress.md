# Apply Progress: Planned Fixed Expenses — PR 1 (Contracts + Status Migration) + PR 2 (Movements Core) + PR 3 (Telegram) + PR 4 (Dashboard)

**Mode**: Strict TDD (RED → GREEN → REFACTOR per task)
**Store**: hybrid (OpenSpec file + Engram mirror `sdd/planned-fixed-expenses/apply-progress`)
**Branch**: `feat/multi-user-phase-2-dashboard` (local work-unit commits; no push — user decides PR later)
**Delivery**: chained PRs, `stacked-to-main` — **PR 1 slice = Phase 1 tasks 1.1–1.4** (done), **PR 2 slice = Phase 2 tasks 2.1–2.6** (done), **PR 3 slice = Phase 3 tasks 3.1–3.5** (done), **PR 4 slice = Phase 4 tasks 4.1–4.4** (this batch)
**Result**: success — 4/4 Phase 1 + 6/6 Phase 2 + 5/5 Phase 3 + 4/4 Phase 4 tasks complete, full suites green (Phase 5 verification pending — separate phase).

---

# Part 1 — PR 1 (Contracts + Status Migration)

## Summary

Implemented the contracts + status-migration slice of planned-fixed-expenses: `movementStatusSchema` (`PAID | PENDING`), `movementSchema.status?` (additive optional), `createMovementSchema.status` with the EXPENSE-only PENDING refine (absent type counts as EXPENSE), `movementSummarySchema.planned` (optional in PR 1 — see deviation), the `MovementStatus` Prisma enum with `status @default(PAID)`, and the `20260928100000_movement_status` migration mirroring the `20260921130000_movement_visibility` precedent (`CREATE TYPE` + `ADD COLUMN ... NOT NULL DEFAULT 'PAID'`, atomic backfill, no explicit UPDATE). Migration deployed to both the dev DB and the test DB; Prisma client regenerated.

- Contracts: **58/58** passing (baseline 39 + 19 new).
- Migration pins: **7/7** passing (`movements.status.integration.test.ts`).
- API full suite: **758/758** passing (37 files).
- Dashboard suite: **140/140** passing (22 files) — unchanged, proving PR-1 tree independence.
- Typecheck clean: contracts, api, dashboard. Lint clean: contracts, api.

## Tasks Completed (Phase 1 / PR 1)

- [x] 1.1 RED `packages/contracts/src/index.test.ts`: status values; PENDING-INCOME rejected; `{status}`/`{occurredAt}` empty-patch rejected; `planned` parses
- [x] 1.2 Add `movementStatusSchema`, `movementSchema.status?`, `createMovementSchema.status` EXPENSE-refine, `movementSummarySchema.planned` in `packages/contracts/src/index.ts`; `pnpm --filter @rita/contracts build`
- [x] 1.3 `enum MovementStatus { PENDING PAID }` + `status @default(PAID)` in `apps/api/prisma/schema.prisma`
- [x] 1.4 Create `apps/api/prisma/migrations/20260928100000_movement_status/migration.sql` (`CREATE TYPE` + `ADD COLUMN ... DEFAULT 'PAID'`); deploy + generate

## TDD Cycle Evidence (PR 1)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/contracts/src/index.test.ts` | Unit | 39/39 | ✅ 12 failing | ✅ 58/58 | ✅ 6 cases (PAID/PENDING/PARTIAL; EXPENSE/no-type/INCOME/SAVINGS) | ✅ Clean |
| 1.2 | (contracts implementation) | — | — | — | ✅ 58/58 | — | ✅ Clean |
| 1.3 | `apps/api/src/features/movements/movements.status.integration.test.ts` | Integration | 732/732 (API baseline) | ✅ 7 failing (enum missing) | ✅ 7/7 | ✅ static + DB pins (default/PENDING/preserved) | ✅ Clean |
| 1.4 | (schema.prisma + migration) | — | — | — | ✅ 7/7 | — | ✅ Clean |

**Test summary (PR 1)**: 26 new tests authored (contracts +19, migration pins +7). All passing.

## Work Unit Evidence (PR 1)

| Unit | Focused test command + result | Runtime harness + result | Rollback boundary |
|------|-------------------------------|--------------------------|-------------------|
| Unit 1 (contracts) | `vitest run packages/contracts/src/index.test.ts` → 58/58 pass | N/A — pure zod schema definitions; no runtime boundary in this unit | Revert contracts commit; contracts files revertable without touching prisma/ |
| Unit 2 (migration) | `vitest run src/features/movements/movements.status.integration.test.ts` → 7/7 pass | `prisma migrate deploy` on `automatizacionrita_test` (docker :5433, healthy) + `automatizacionrita` dev DB → applied cleanly; `prisma generate` regenerated client | Revert migration commit; DB rollback: `ALTER TABLE "Expense" DROP COLUMN "status"` + `DROP TYPE "MovementStatus"` (default-only backfill — no data loss) |

## Deviations from Design (PR 1)

- **`movementSummarySchema.planned` was OPTIONAL in PR 1** (design interface sketch showed required). Rationale: chained-PR independence — dashboard's `fetchMovementSummary` validates API responses against `movementSummarySchema` at runtime (`safeParse`) and `MovementService.getSummary` is typed `Promise<MovementSummary>`. A required `planned` would break the API service typecheck and the dashboard's runtime summary validation until PR 2's `summaryPlanned` producer lands. **Flipped to REQUIRED in PR 2** alongside `getSummary().planned` (see PR 2 deviations).
- No other deviations — contracts match the design interface sketch.

## Issues Found (PR 1)

- Known Windows prisma EPERM + 10s hook-timeout flake (pre-existing, documented in the savings-rule apply-progress): `prisma generate` EPERM (query-engine DLL locked by tsx watch dev server) → stopped dev tree, regenerated, restarted detached. First migration-test run exceeded the beforeAll hook timeout on cold start; passes consistently warm. Not caused by this change.

---

# Part 2 — PR 2 (Movements Core)

## Summary

Implemented the movements-core slice of planned-fixed-expenses: the central `PENDING_EXCLUDED` SQL fragment applied to the 5 KPI aggregates (`summaryKpis`, `summaryDaily`, `summaryCategories`, `topByType`, `summaryMonths` — the savings CASE column untouched), `"status"` added to the raw SELECTs so the movement list and top lists carry it (`listByOwner` keeps PENDING rows, unfiltered), the new `summaryPlanned(scope, month)` aggregate deriving each row's target month in SQL (`occurredAt AT TIME ZONE 'UTC' AT TIME ZONE BA + interval '1 month'`), the guarded single-write `markPaidById` (EXPENSE ∧ PENDING in the WHERE; `occurredAt=now`), `ConflictError` (409) in `infra/errors.ts`, service `nextBaMonth()` + `getSummary().planned` + `markMovementPaid` (404 vs 409 disambiguation), the `POST /movements/:id/paid` route, and the expenses `create` persistence of `status ?? "PAID"` (the planned-creation pass-through). `movementSummarySchema.planned` flipped from optional to REQUIRED (PR 1 deviation closure).

- Movements + expenses focused suites: **135/135** passing (baseline 112 + 23 new).
- API full suite: **781/781** passing (37 files).
- Dashboard suite: **140/140** passing (22 files) — fixture-only ripple from the contracts flip, no dashboard feature work.
- Typecheck clean: contracts, api, dashboard. Lint clean: contracts, api, dashboard.
- Runtime harness: every route test runs through `app.inject` (real Fastify + real Prisma + test DB on :5433) — the mark-paid transition, PENDING exclusion, planned block, and PATCH-pending flows were all exercised through the real HTTP boundary.

## Tasks Completed (Phase 2 / PR 2)

- [x] 2.1 RED `movements.route.test.ts`: per-aggregate exclusion (900/300/PENDING 2500 ⇒ 900/300/600); summaryMonths SAVINGS+PENDING; planned next-month, ignores from-to, zero; BA boundary
- [x] 2.2 RED mark-paid: 200→PAID+now in KPIs; PAID/INCOME→409; missing/owner→404; double→409
- [x] 2.3 `movements.repository.ts`: `PENDING_EXCLUDED` in 4 summaries + topByType (keep savings CASE); `"status"` in SELECTs; `listByOwner` unfiltered
- [x] 2.4 `movements.repository.ts`: `summaryPlanned(scope, month)`; `markPaidById` guarded; `ConflictError` 409 in `infra/errors.ts`
- [x] 2.5 `movements.service.ts`: `nextBaMonth()`, `getSummary.planned`, `markMovementPaid`; `movements.route.ts` `POST /movements/:id/paid`
- [x] 2.6 `expenses.repository.ts`: `create` persists `status ?? "PAID"`; PATCH pending (2600 stays PENDING)

## TDD Cycle Evidence (PR 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `apps/api/src/features/movements/movements.route.test.ts` | Integration | 112/112 (movements+expenses) | ✅ 17 failing (batch RED incl. 2.2) | ✅ exclusion + list-status tests pass after 2.3 (6 of the 17) | ✅ 11 cases (kpis / mom+daily / categories / top / SAVINGS+PENDING / next-month / ignores-filters / zero / BA boundary ×2 / list status) | ✅ Clean |
| 2.2 | `apps/api/src/features/movements/movements.route.test.ts` | Integration | same | ✅ 17 failing (batch RED incl. 2.1) | ✅ mark-paid tests pass after 2.4+2.5 (200/409/409/404/404-owner/409-double) | ✅ 6 cases (200+KPIs / already-PAID 409 / INCOME 409 / missing 404 / other-owner 404 / double 409) | ✅ Clean |
| 2.3 | `apps/api/src/features/movements/movements.route.test.ts` | Integration | same | ✅ (RED covered by 2.1 batch) | ✅ 6 exclusion/status tests pass | ✅ per-aggregate (see 2.1 triangulation) | ✅ Clean |
| 2.4 | (repository + infra/errors implementation) | — | — | — | ✅ route suite drops to 1 failing | — | ✅ Clean |
| 2.5 | `apps/api/src/features/movements/movements.service.test.ts` + route | Unit + Integration | 112/112 | ✅ route tests RED; service unit tests added RED-first | ✅ all planned + mark-paid route tests pass; service 3 new tests pass | ✅ markPaid 3 cases (success / 404 / 409) + planned threading | ✅ Clean |
| 2.6 | `apps/api/src/features/movements/movements.route.test.ts` (POST /expenses persists + PATCH pending) | Integration | same | ✅ POST-persistence RED (status PAID not PENDING) | ✅ 135/135 movements+expenses | ✅ PATCH pending (2600 stays PENDING) + POST /expenses PENDING persist | ✅ Clean |

**Test summary (PR 2)**: 23 new tests authored in movements/expenses (route +21, service +3, minus 1 replaced contracts test = net +23 in API). Contracts test updated: "parses without planned" → "rejects without planned". All passing. Triangulation notes: per-aggregate exclusion exercised kpis/mom/daily/categories/top independently; planned covered next-month sum, filters-ignored (from/to = a past month excluding the row — the discriminator), zero, and the BA boundary both directions (next-month 02:59Z included via BA wall time; fixed 2026-08-01T02:59Z → derived 2026-08 excluded from planned); mark-paid covered 200 + KPI entry, already-PAID 409, INCOME 409, missing 404, other-owner 404, double-mark 409. Pure functions created: `nextBaMonth` (service), `baNow`/`baMonthKey`/`nextBaMonthKey`/`thisMonthNoonIso` (test helpers).

## Work Unit Evidence (PR 2)

| Unit | Focused test command + result | Runtime harness + result | Rollback boundary |
|------|-------------------------------|--------------------------|-------------------|
| Unit A — PENDING exclusion + status | `vitest run src/features/movements/movements.route.test.ts` → exclusion/status tests green (36/47 after 2.3; full file 47/47 at end) | `app.inject` GET /movements/summary + GET /movements on test DB (:5433) — real Fastify + Prisma; per-aggregate exclusions and list status proven over real rows | Revert repository SELECT/WHERE changes + test file; no other feature touched |
| Unit B — planned summary | same command → planned tests green after 2.4+2.5 | `app.inject` GET /movements/summary with PENDING seeds; next-month total, filters-ignored, zero, BA boundary (next-month 02:59Z) proven end-to-end | Revert `summaryPlanned` + `getSummary` wiring + contracts flip; dashboard/telegram fixture `planned` additions revert with the flip |
| Unit C — mark-paid | same command → mark-paid tests green after 2.4+2.5 | `app.inject` POST /movements/:id/paid — real single-write UPDATE verified via DB re-read (status PAID + occurredAt≈now), 409/404 transitions, KPI entry after payment | Revert `markPaidById` + `markMovementPaid` + route + `ConflictError`; DB rows written by the transition are normal PAID rows (no schema change) |
| Unit D — creation pass-through | `vitest run src/features/movements src/features/expenses` → 135/135 | `app.inject` POST /expenses (status PENDING) → GET /movements shows PENDING — the dashboard channel's persistence proven | Revert `expenses.repository.ts` one-line status persistence |

## Deviations from Design (PR 2)

- **`movementSummarySchema.planned` flipped OPTIONAL → REQUIRED** — exactly the closure the PR 1 deviation mandated ("the producer PR 2 must flip it to required alongside `getSummary().planned`"). The dashboard runtime `safeParse` stays green because the API now always emits `planned`; dashboard fixture files (`api.test.ts`, `App.test.tsx`, `SummarySection.test.tsx`, `useMovementSummary.test.tsx`) and two telegram test fixture files (`query-executor.test.ts`, `telegram.service.test.ts`, `telegram.service.savings.test.ts`) gained `planned` in their summary literals to satisfy the required contract — a mechanical contract-ripple update, NOT PR 3/PR 4 feature work.
- **D5 ordering implemented as "guarded UPDATE first, existence check to disambiguate 404 vs 409"** per the orchestrator's slice instruction ("0 rows → check existence: missing → 404, exists-but-not-EXPENSE or already-PAID → 409"). D5's text ("`findById` first for 404 vs 409; 0 updated rows ⇒ concurrently marked ⇒ 409") is outcome-identical: missing/other-owner → 404, everything else that blocks the transition → 409. The single-write property is preserved (the guards live in the UPDATE WHERE; the existence check only classifies the 0-row outcome).
- The planned "ignores from/to" test uses a from/to range (a past month) that EXCLUDES the seeded row's month — a stronger discriminator than the spec's "current-month" scenario: a filter-respecting implementation would report 0; the correct one reports 2500.
- No other deviations — repository/service/route match the design's file-change table and interface sketches.

## Issues Found (PR 2)

- **Contracts flip ripple surfaced as typecheck errors in telegram test files** (PR 3 scope): `query-executor.test.ts` (4 summary literals), `telegram.service.test.ts` (3), `telegram.service.savings.test.ts` (2) construct `MovementSummary` literals; the required `planned` field broke `tsc`. Fixed with the additive `planned` fixture field — no telegram behavior touched; PR 3's own work is unaffected.
- The PR 1 contracts test "parses a summary without the planned block" became obsolete under the flip and was updated to assert rejection (required contract).
- No pre-existing failures encountered; the known Windows prisma EPERM/hook-timeout flake did not recur in this batch.

## Workload / PR Boundary

- Mode: chained PR slice 2 of 4 (stacked-to-main).
- Current work unit: PR 2 — movements core (Phase 2 tasks 2.1–2.6).
- Boundary: starts at PR 1 HEAD (`ecbee9f`); ends at the movements-core commit. PR 3 = telegram, PR 4 = dashboard planned UI.
- Estimated review budget impact: ~490 authored changed lines (movements route tests +21, service tests +3, repository +~70, service +~30, route +8, errors +11, expenses +2, contracts flip +2, dashboard/telegram fixtures +~14). Above the 400-line budget — recommendation: keep PR 2 as its own chained PR (it already is); the per-file diff is dominated by the honest route-test coverage the spec demands. No code was compressed to fit; tests/docs are intact.

---

# Part 3 — PR 3 (Telegram)

## Summary

Implemented the telegram slice of planned-fixed-expenses: the loop-based `parseArrivalPrefixes` (strips `compartido:`/`previsto:` in ANY order; `parseSharedPrefix` stays exported), the `planned` flag threaded through every registration path (forces `type="EXPENSE"` + `status="PENDING"`, skips the savings split — INCOME-only anyway — and persists in the amount-confirmation payload alongside `shared`/`override`), the `plannedReply` registration template (honest: does not imply the amount already counts), the distinct `query_planned` intent in `BOT_INTENTS` converging with the `"planned"` QUERY_TYPES entry in `deriveQueryType`, the `planned` query executor reading `summary.planned` with top-level `planned_month`/`planned_total` facts on the `answered` execution result (savings precedent), the PENDING exclusion in `recent` and the movement-corrector window (repository keeps PENDING for the dashboard — filtered at the telegram layer only), and the brain changes (interpret prompt teaches planned phrasings → `query_planned`; reply prompt gains the unconditional planned-facts instruction so the spec's hand-made-result scenario passes). All 8 goldens regenerated in-cycle — exactly 3 files changed bytes (`interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt`), CI stays green.

- Telegram suite: **474/474** passing (baseline 441 + 33 new: 32 unit + 1 integration e2e).
- API full suite: **814/814** passing (37 files).
- Dashboard suite: **140/140** passing (22 files) — unchanged, proving PR-3 tree independence.
- Typecheck clean: contracts, api, dashboard. Lint clean: contracts, api, dashboard.
- Runtime harness: the planned e2e integration test drives the REAL bot flow against the test DB (`previsto:` ×3 both orders → 3 PENDING EXPENSE rows, KPIs exclude them with `planned.total` = 5200, "¿cuánto tengo previsto?" answers 5200 from real data, recent/corrector exclude the PENDING rows).

## Tasks Completed (Phase 3 / PR 3)

- [x] 3.1 RED `telegram.service.test.ts`: `previsto: 2500 alquiler` → PENDING EXPENSE + confirmation (brain & brain-absent); `compartido:`+`previsto:` both orders; no savings split
- [x] 3.2 RED `query-executor.test.ts` planned (4000) + redirect; `movement-corrector.test.ts` PENDING → no_match; recent omits PENDING
- [x] 3.3 `telegram.parser.ts` `parseArrivalPrefixes` (strips `compartido:`/`previsto:` any order); `telegram.service.ts` `planned` → EXPENSE+PENDING, skip split, persist payload, `plannedReply`
- [x] 3.4 `query.types.ts`/`query-executor.ts`: `"planned"` type + executor; recent filters PENDING; `movement-corrector.ts` window excludes PENDING
- [x] 3.5 `reply-text.ts` planned replies; `bot-brain.ts` `query_planned` + facts + prompts; regenerate 8 goldens in-cycle (3 change bytes)

## TDD Cycle Evidence (PR 3)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `telegram.service.test.ts` + `telegram.parser.test.ts` | Unit | 441/441 (telegram) | ✅ 32 failing batch (incl. 3.2) | ✅ registration tests green after 3.3 (brain-absent / brain / matched-category / both orders / no-split / payload) | ✅ 8 cases (deterministic otro / matched category / brain path / compartido+previsto ×2 orders / savings-keyword no-split / payload persist + resolve) | ✅ Clean |
| 3.2 | `query-executor.test.ts` + `movement-corrector.test.ts` + `telegram.service.test.ts` | Unit | same | ✅ 32 failing batch (incl. 3.1) | ✅ executor + exclusion tests green after 3.4 | ✅ planned real-data (4000), planned zero, recent omits PENDING (PAID 2500 kept), corrector PENDING→no_match + PAID still reassigns, deriveQueryType query_planned/query+planned | ✅ Clean |
| 3.3 | (parser + service implementation) | — | — | — | ✅ service registration tests pass | — | ✅ Clean |
| 3.4 | (query.types/executor/corrector implementation) | — | — | — | ✅ executor tests pass | — | ✅ Clean |
| 3.5 | `reply-text.test.ts` + `bot-brain.test.ts` | Unit | same | ✅ 32 failing batch (incl. reply/brain RED) | ✅ reply/brain tests pass after 3.5; goldens regenerated in-cycle (`vitest -u`, 3 snapshots updated) | ✅ planned reply template + plannedQueryReply + queryReplyTemplate case; query_planned decode/interpret/reply-facts; prompt contracts (phrasings + unconditional planned instruction + few-shot) | ✅ Clean |

**Test summary (PR 3)**: 33 new tests authored (parser +4, telegram.service unit +11, query-executor +3, movement-corrector +2, reply-text +4, bot-brain +7, integration e2e +1). All passing. Triangulation notes: previsto exercised deterministic-otro, matched-category, brain path, both prefix orders, savings-keyword no-split, and the amount-conflict payload persistence + resolution; planned query exercised real-data (4000 via mock + 5200 via real DB), zero, failure redirect, and the top-level facts on the ExecutionResult (asserted exactly); recent/corrector exclusions proven at both unit and integration layers. Pure functions created: `parseArrivalPrefixes` (parser), `plannedReply`/`plannedQueryReply` (reply-text).

## Work Unit Evidence (PR 3)

| Unit | Focused test command + result | Runtime harness + result | Rollback boundary |
|------|-------------------------------|--------------------------|-------------------|
| Unit A — planned query machinery + brain | `pnpm --filter @rita/api exec vitest run src/features/telegram/query-executor.test.ts src/features/telegram/movement-corrector.test.ts src/features/telegram/bot-brain.test.ts src/features/telegram/reply-text.test.ts` → 4 files pass (planned executor, deriveQueryType convergence, PENDING exclusions, brain decode/reply-facts, prompt contracts, goldens) | `pnpm --filter @rita/api test telegram` → real bot flow over test DB (:5433): "¿cuánto tengo previsto?" answered 5200 from real `summaryPlanned` SQL data via the real service | Revert commit `f2c8483` (query.types/executor/corrector/reply-text/bot-brain + goldens + their tests); no registration behavior touched |
| Unit B — previsto registration | `pnpm --filter @rita/api exec vitest run src/features/telegram/telegram.service.test.ts src/features/telegram/telegram.parser.test.ts` → 2 files pass (previsto both orders, brain-absent, no-split, payload persistence) | `pnpm --filter @rita/api test telegram` → planned e2e integration test: `previsto: 2500 alquiler` + `compartido: previsto: 1500 expensas` + `previsto: compartido: 1200 luz` → 3 PENDING EXPENSE rows (INDIVIDUAL + 2 SHARED), `kpis.expenses` = 0, `planned.total` = 5200, recent/correction exclude them | Revert commit `09a761d` (parser + service + their tests); DB rows written are ordinary PENDING rows (no schema change) |

## Deviations from Design (PR 3)

- **`registerOtroWithCorrection` planned reply is the planned confirmation + the category offer** (`plannedReply(...) + " ¿Querés asignarle otra categoría?..."`) rather than a bare `plannedReply`. Rationale: the "otro" tail MUST keep the correction dialog offer (existing behavior), and the planned confirmation must not be lost — composing them keeps both the D11 honesty fact and the D6 dialog contract. The with-category tail uses the bare `plannedReply` exactly per design.
- The service-level planned-query tests assert the exact `ExecutionResult` shape (including `planned_month`/`planned_total` top-level facts) per D7; the fixed template fallback is `plannedQueryReply` via the existing `queryReplyTemplate` switch (no separate `plannedQueryReply` call site in the service — the template switch renders it, matching the savings precedent).
- No other deviations — parser/service/brain/reply-text match the design's file-change table and D6/D7/D10/D11 decisions.

## Issues Found (PR 3)

- **Full-suite migration-pin timeouts on cold start** (pre-existing, documented in PR 1): `movements.status.integration.test.ts` and `savings.migration.integration.test.ts` exceeded the 5000ms test timeout when the full suite ran right after heavy DB use; both pass warm in isolation (18/18) and in the clean full-suite run (814/814). Not caused by this change — the files are untouched migration pins from PR 1/earlier changes.
- **Line-ending normalization**: the `edit`-appended blocks in `telegram.service.test.ts` introduced 48 LF-only lines into the CRLF working-tree file; normalized the file to uniform CRLF (no BOM, UTF-8) before committing — no content change.
- One test-stub bug during the cycle: `matchNote` returns a category NAME string (not a `CategoryWithKeywords` object) and a canned brain stub that re-returned the conflicting envelope made the amount-confirmation resolution test re-ask instead of resolving; both fixed in the test mocks (context-aware stub with `dialog_action: "resolve"`).
- No pre-existing failures encountered in the telegram scope.

## Workload / PR Boundary

- Mode: chained PR slice 3 of 4 (stacked-to-main).
- Current work unit: PR 3 — telegram (Phase 3 tasks 3.1–3.5).
- Boundary: starts at PR 2 HEAD (`00c403e`); ends at commit `09a761d`. PR 4 = dashboard planned UI (Phase 4 tasks 4.1–4.4).
- Estimated review budget impact: ~860 authored changed lines across the slice (872 insertions / 64 deletions minus ~12 generated-golden lines). Above the 400-line budget — recommendation: keep PR 3 as its own chained PR (it already is); the diff is dominated by honest unit/integration coverage the specs demand (33 new tests). No code was compressed to fit; tests/docs intact.

## Status

4/4 Phase 1 + 6/6 Phase 2 + 5/5 Phase 3 tasks complete (15/16). Ready for next batch (PR 4 slice: dashboard) — not ready for full verify until all PR slices land.

---

# Part 4 — PR 4 (Dashboard)

## Summary

Implemented the dashboard slice of planned-fixed-expenses: the new `PlannedSection` ("Gastos fijos previstos") rendering `summary.planned` (next-month es-AR label via `Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" })`, es-AR total via `formatARS`, `$0` case included) placed immediately AFTER `KpiCards` in the kpis tab (D9), hosting the inline "Agregar previsto" form (amount/note/category via `useCategories`; positive-amount guard with a Spanish error that never reaches the API); the `createPlannedMovement` client (D8/D11 — reuses `POST /api/expenses` with `type: "EXPENSE"` + `status: "PENDING"` pinned and `occurredAt` = load date; the legacy Expense response validates against `expenseSchema`, not `movementSchema`); the `markMovementPaid` client (`POST /api/movements/:id/paid`, `movementSchema`); the `createPlanned` + `markPaid` mutations on `useMovementMutations` (busy/error states extended; both fire the App-level refresh token on success); the "Previsto" badge on PENDING rows and the "Marcar pagado" action on OWN rows only (`registrantOf(movement) === viewerId`), with a 409-specific Spanish error ("El movimiento ya no está pendiente.") that keeps the row unchanged; and the no-status-filter pin in `MovementFilters` (planned expenses surface only through the dedicated section). No status filter was added anywhere.

- Dashboard suite: **161/161** passing (23 files) — baseline 140/140 + 21 new tests.
- API route runtime harness (the endpoints the new dashboard code calls): **64/64** passing (`movements.route.test.ts` + `expenses.route.test.ts` via `app.inject` + real Prisma + test DB :5433) — `POST /expenses` PENDING persistence and `POST /movements/:id/paid` 200/409/404 transitions proven through the real HTTP boundary.
- Typecheck clean: contracts, api, dashboard (root `pnpm typecheck`). Lint clean: contracts, api, dashboard (root `pnpm lint`).
- Three work-unit commits on `feat/multi-user-phase-2-dashboard` (no push, no PR opened per slice instruction): `b0d5893` (client + mutations layer), `3d801f4` (planned section + App wiring), `ee8673d` (Previsto badge + Marcar pagado).

## Tasks Completed (Phase 4 / PR 4)

- [x] 4.1 RED `PlannedSection.test.tsx` (es-AR total, $0), `App.test.tsx` (after KpiCards), `MovementList.test.tsx` (badge, Marcar pagado, 409), `useMovementMutations.test.tsx` (refresh)
- [x] 4.2 `infra/api.ts` + `useMovementMutations.ts`: `createPlannedMovement` (POST `/api/expenses`), `markMovementPaid`, `markPaid` + `createPlanned`
- [x] 4.3 Create `PlannedSection.tsx`: next-month es-AR label, total, "Agregar previsto" form (positive-amount guard, Spanish error, no API call)
- [x] 4.4 `App.tsx` render after `KpiCards`; `MovementList.tsx` Previsto badge + Marcar pagado (own rows; 409 → error)

## TDD Cycle Evidence (PR 4)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `PlannedSection.test.tsx` (new) + `App.test.tsx` + `MovementList.test.tsx` + `useMovementMutations.test.tsx` + `api.test.ts` + `MovementFilters.test.tsx` | Component + Unit | 140/140 | ✅ 10 failing batch (PlannedSection module missing, hook/api fns missing, App heading absent; MovementFilters pin passed on existing code) | ✅ 61/61 focused (unit A) + 17/17 MovementList (unit B) → full suite 161/161 | ✅ 21 new tests (see test summary); per-behavior triangulation below | ✅ Clean |
| 4.2 | `api.test.ts` + `useMovementMutations.test.tsx` | Unit | 140/140 | ✅ (RED covered by 4.1 batch) | ✅ `createPlannedMovement`/`markMovementPaid` + hook `createPlanned`/`markPaid` green | ✅ api: PENDING EXPENSE body (type/status/occurredAt), empty-note/null-category normalization, legacy-Expense validation, 409 http; hook: success + failure ×2 (422/409) | ✅ Clean |
| 4.3 | `PlannedSection.test.tsx` | Component | 140/140 | ✅ 6 failing (module missing) | ✅ 6/6 after `PlannedSection.tsx` | ✅ month label "septiembre de 2026"; $0 vs $4.000,00; 0 and -5 both blocked with Spanish error + no API call; API failure surfaced | ✅ Clean |
| 4.4 | `App.test.tsx` + `MovementList.test.tsx` | Component | 140/140 | ✅ planned heading absent in App; Marcar pagado button absent in list | ✅ full suite 161/161 | ✅ DOM order after KpiCards (`DOCUMENT_POSITION_PRECEDING` bitmask); own vs partner rows (badge on own, action off partner); 409 keeps row PENDING + onMutated NOT fired; success bumps refresh | ✅ Clean |

**Test summary (PR 4)**: 21 new tests authored (PlannedSection +6, useMovementMutations +4, api +5, App +1, MovementList +4, MovementFilters +1 pin). All passing. Triangulation notes: planned render covered total 4000 → "$ 4.000,00" AND the $0 case; the amount guard covered 0 AND -5 (both Spanish error + zero API calls); mark-paid covered own-row success (bump), partner-row read-only, 409 → Spanish error + row unchanged; the no-status-filter pin (MovementFilters offers no estado/status control) passed on existing code — it pins the spec's MUST that was already true. Pure functions created: `monthLabel` (PlannedSection, es-AR month label from "YYYY-MM"), `PlannedMovementInput` normalization lives inline in `createPlannedMovement`.

## Work Unit Evidence (PR 4)

| Unit | Focused test command + result | Runtime harness + result | Rollback boundary |
|------|-------------------------------|--------------------------|-------------------|
| Unit A — planned section + createPlanned | `pnpm --filter @rita/dashboard exec vitest run src/features/movements/PlannedSection.test.tsx src/features/movements/useMovementMutations.test.tsx src/infra/api.test.ts src/App.test.tsx src/features/movements/MovementFilters.test.tsx` → 61/61 pass | `pnpm --filter @rita/api exec vitest run src/features/movements/movements.route.test.ts src/features/expenses/expenses.route.test.ts` → 64/64 — the exact endpoint `createPlannedMovement` calls (`POST /expenses` with PENDING persistence) proven through `app.inject` + real Prisma on :5433 | Revert commits `b0d5893` + `3d801f4`; PlannedSection + App wiring + client/mutations layer revert without touching MovementList |
| Unit B — Previsto badge + markPaid | `pnpm --filter @rita/dashboard exec vitest run src/features/movements/MovementList.test.tsx` → 17/17 pass | same API route run → 64/64 — `POST /movements/:id/paid` 200/409/404 transitions (the boundary behind `markMovementPaid`) proven end-to-end | Revert commit `ee8673d`; MovementList badge/action revert without removing the planned section |

## Deviations from Design (PR 4)

- **None in behavior.** Two implementation notes, both within the design's intent: (1) the mark-paid error message differentiates 409 ("El movimiento ya no está pendiente.") from other failures ("No se pudo marcar como pagado.") — a UX nicety inside the spec's "Spanish error" requirement; (2) the App DOM-order test asserts D9 via `compareDocumentPosition` + `DOCUMENT_POSITION_PRECEDING` (the KPI heading precedes the planned heading) — a behavioral order check, no CSS-class coupling.

## Issues Found (PR 4)

- **Empty-summary gate can hide the planned section**: `SummarySection` treats `mom.months.length === 0 && daily.length === 0` as empty and renders "No hay movimientos aún." instead of its children — so an owner whose ONLY movements are PENDING (all planned, nothing paid yet) sees the empty state and never sees `summary.planned` (total > 0). This is a pre-existing gate; `SummarySection.tsx` is not in the design's file-change table, so it was left untouched to avoid scope creep. Flagged for the verify phase: the Metrics Overview requirement ("Planned expenses section MUST show `summary.planned`") may warrant relaxing the empty gate when `planned.total > 0` in a follow-up.
- `monthLabel` needs explicit fallbacks (`year ?? 1970`, `monthIndex ?? 1`) under `noUncheckedIndexedAccess` — only reachable for a malformed month key; the API contract pins "YYYY-MM" (`movementSummarySchema.planned.month`).
- Line-ending note (same as PR 3): edit-tool writes on Windows can mix LF into the CRLF working tree; `core.autocrlf=true` normalizes to LF in the index (warning only) — verified via `git diff`, no content change.
- No pre-existing failures encountered in the dashboard scope.

## Workload / PR Boundary

- Mode: chained PR slice 4 of 4 (stacked-to-main).
- Current work unit: PR 4 — dashboard planned UI (Phase 4 tasks 4.1–4.4).
- Boundary: starts at PR 3 HEAD (`09a761d`); ends at commit `ee8673d` (3 commits: `b0d5893`, `3d801f4`, `ee8673d`). No push, no PR opened — per slice instruction, the user decides PR creation later; target `main` after PR 3 merges.
- Estimated review budget impact: ~870 authored changed lines (877 insertions / 7 deletions across 11 dashboard files). Above the 400-line budget — recommendation: keep PR 4 as its own chained PR (it already is); the diff is dominated by honest component/unit coverage the specs demand (21 new tests). No code was compressed to fit; tests/docs intact.

## Status

4/4 Phase 1 + 6/6 Phase 2 + 5/5 Phase 3 + 4/4 Phase 4 tasks complete (19/20 — Phase 5 verification + rollback note is a separate phase). All implementation slices have landed. Ready for verify — the verification phase must run the Phase 5 suites (`pnpm --filter @rita/api test`, `pnpm --filter @rita/dashboard test`, `pnpm typecheck`) and record the rollback note.