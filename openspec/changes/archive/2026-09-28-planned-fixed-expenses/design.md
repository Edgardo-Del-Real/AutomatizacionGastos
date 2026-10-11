# Design: Planned Fixed Expenses

## Technical Approach

Add a `MovementStatus` enum (`PENDING | PAID`, default `PAID`) to `Expense`, mirroring the `20260921130000_movement_visibility` migration. A central `PENDING_EXCLUDED` SQL fragment (the `SAVINGS_EXCLUDED` precedent) excludes PENDING from the five KPI aggregates; the movement list keeps PENDING. The planned month is derived per row (`occurredAt` load date + 1 month, Buenos Aires; no stored column) and feeds a new `summaryPlanned` aggregate → `summary.planned { month, total }`, always fixed to next month and ignoring `from`/`to`. `POST /movements/:id/paid` performs the guarded single-write transition. Channels: bot `previsto:` prefix (arrival-parsed, composable with `compartido:` in any order, deterministic without the brain) and dashboard "Agregar previsto" via the existing `POST /expenses` registration path. A distinct `query_planned` intent maps to a deterministic `planned` query executor. Contracts rebuild first: `pnpm --filter @rita/contracts build`.

## Architecture Decisions

| # | Decision | Choice (vs alternative) | Rationale |
|---|----------|--------------------------|----------|
| D1 | Status column | Prisma enum + migration `CREATE TYPE "MovementStatus" AS ENUM ('PENDING','PAID')` + `ADD COLUMN "status" ... NOT NULL DEFAULT 'PAID'` — no explicit `UPDATE` | Mirrors the visibility migration; Postgres backfills atomically via `NOT NULL DEFAULT` (spec "Migration preserves existing rows") |
| D2 | PENDING exclusion surface | `PENDING_EXCLUDED = Prisma.sql\`"status" <> 'PENDING'::"MovementStatus"\`` in the WHERE of `summaryKpis`, `summaryDaily`, `summaryCategories`, `topByType`, `summaryMonths`; NOT `listByOwner`/`summarySavings` (per-query literals) | One fragment mirrors `SAVINGS_EXCLUDED`; CASE-only sums would leak into COUNT, MAX, monthsWithData, GROUP BY, top rows |
| D3 | `summaryMonths` trap | WHERE gains `PENDING_EXCLUDED`; the `SUM(CASE WHEN type='SAVINGS')` column stays untouched | PENDING rows are always EXPENSE-typed, so the savings column never intersects PENDING — one composition keeps both spec assertions (savings survives, PENDING dropped from income/expense sums) |
| D4 | Planned month derivation | SQL per row: BA load month + 1; target month computed once in the service (`nextBaMonth()`, `currentBaDate()+1` like `lastMonths`) | No stored month (spec); reuses the existing BA bucketing idiom (naive-UTC column → BA wall time) so the boundary scenario behaves identically |
| D5 | Mark-paid transition | `updateMany({ where: { id, ownerId, type: "EXPENSE", status: "PENDING" }, data: { status: "PAID", occurredAt: new Date() } })` — the guard lives in the WHERE; `findById` first for 404 vs 409; new `ConflictError` (409) in `infra/errors.ts` | Single atomic write (no check-then-write TOCTOU); 0 updated rows ⇒ concurrently marked ⇒ 409 |
| D6 | `query_planned` shape | Distinct intent in `BOT_INTENTS` **and** `"planned"` added to `QUERY_TYPES`; `deriveQueryType` adds `case "query_planned": return "planned"` | Spec leans distinct intent; QUERY_TYPES membership lets the generic `query` + `query_type: "planned"` route converge on the same executor (belt-and-braces, `query_savings` never existed but `query_recent` did) |
| D7 | Planned query result | Controller sends `action: "answered"` (D12 savings-query precedent) with `query` payload **plus** top-level `planned_month`/`planned_total`; reply prompt gains an unconditional planned-facts instruction | `answered` matches every existing query; the spec's `reply()` scenario (hand-made result) passes because the planned-facts instruction fires whenever the fields are present |
| D8 | Dashboard creation endpoint | Reuse `POST /expenses` with `{ type: "EXPENSE", status: "PENDING" }` (new `POST /movements` route rejected) | Spec: create through the existing registration path; `createMovementSchema` already validates both fields; response validates against `expenseSchema` |
| D9 | Planned section placement | `kpis` tab, immediately after `KpiCards`, inside `SummarySection` children; the "Agregar previsto" form lives in that section | Spec scroll order: KPI cards → planned section; form + total co-located; one refresh token already re-fetches list and summary across tabs |
| D10 | Bot `planned` threading | New `parseArrivalPrefixes` (loop-strips `compartido:`/`previsto:` in any order; `parseSharedPrefix` stays exported); `planned` forces `type="EXPENSE"` + `status="PENDING"`, skips the savings split (INCOME-only anyway), and persists in the amount-confirmation payload (like `shared`) | Prefix authoritative like `compartido:` (brain-absent works); survives the amount-conflict dialog; either-order composition |
| D11 | Registration reply honesty | `ExecutionResult` gains `planned_month`/`planned_total` (query facts) and `planned?: boolean` (registration fact); fixed templates `plannedReply` + `plannedQueryReply` | Mirrors the gross/net/savings precedent — the reply must not imply a planned expense already counts in KPIs |

## Data Flow

    "previsto: 2500 alquiler" ──> TelegramService.handleUpdate
      ├─ parseArrivalPrefixes ──> { text, shared, planned }
      └─ registerWithCategory(planned) ──> createExpense(type=EXPENSE, status=PENDING, occurredAt=load date)
             │
    GET /movements/summary ──> getSummary
      ├─ 5 aggregates ── WHERE PENDING_EXCLUDED (summaryMonths keeps the savings column)
      └─ summaryPlanned(scope, nextBaMonth) ──> planned { month, total }   // ignores from/to
             │
    POST /movements/:id/paid ──> markPaid ── guarded UPDATE (EXPENSE ∧ PENDING)
      ├─ missing / other owner ──> 404
      ├─ already-PAID / non-EXPENSE / race ──> 409
      └─ success ──> PAID + occurredAt=now ── enters aggregates on the payment date

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modify | `movementStatusSchema`; `movementSchema.status` optional; `createMovementSchema.status` + EXPENSE-only refine (absent `type` counts as EXPENSE); `movementSummarySchema.planned { month, total }`; `updateMovementSchema` untouched (unknown-key strip already rejects `{status}`/`{occurredAt}` as empty patch) |
| `apps/api/prisma/schema.prisma` + `migrations/20260928100000_movement_status/migration.sql` | Modify/Create | enum `MovementStatus` + column `status @default(PAID)`; SQL mirrors the visibility migration |
| `apps/api/src/features/movements/movements.repository.ts` | Modify | `PENDING_EXCLUDED` fragment on the 5 aggregates; `summaryPlanned(scope, month)`; `markPaidById` guarded update; `MovementRow.status` + SELECT lists gain `"status"` (`listByOwner`, `topByType`) |
| `apps/api/src/features/movements/movements.service.ts` | Modify | `nextBaMonth()`; `getSummary` adds `planned`; `markPaid(ownerId, id)` guards |
| `apps/api/src/features/movements/movements.route.ts` | Modify | `POST /movements/:id/paid` (x-owner-id) |
| `apps/api/src/infra/errors.ts` | Modify | `ConflictError` (statusCode 409) |
| `apps/api/src/features/expenses/expenses.repository.ts` | Modify | `create` persists `status: data.status ?? "PAID"` (status flows via `CreateMovementInput`, so `expenses.types.ts` needs no change) |
| `apps/api/src/features/telegram/telegram.parser.ts` | Modify | `parseArrivalPrefixes` loop; `parseSharedPrefix` unchanged |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | `planned` flag threading; forced EXPENSE+PENDING; no split; payload persistence; `plannedReply` use |
| `apps/api/src/features/telegram/query.types.ts` + `query-executor.ts` | Modify | `"planned"` QueryType + `PlannedQueryResult`; executor reads `getSummary().planned`; `recent` filters PENDING before the slice |
| `apps/api/src/features/telegram/movement-corrector.ts` | Modify | window filters PENDING (`status !== "PENDING"`) before the 10-row slice |
| `apps/api/src/features/telegram/bot-brain.ts` | Modify | `query_planned` intent; `QUERY_TYPES` import of "planned"; `ExecutionResult` planned facts; interpret prompt + few-shot ("cuánto tengo previsto", "gastos fijos previstos", "cuánto voy a gastar el mes que viene"); reply prompt planned instructions |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | `plannedQueryReply(month, total)`; `plannedReply(amount, note, category)` |
| `apps/api/src/features/telegram/__goldens__/` (3 of 8 files) | Regenerate | `interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt` change bytes; regenerate all 8 in-cycle |
| `apps/dashboard/src/infra/api.ts` | Modify | `createPlannedMovement` (POST `/api/expenses`, x-owner-id, `expenseSchema`); `markMovementPaid` (POST `/api/movements/:id/paid`) |
| `apps/dashboard/src/features/movements/useMovementMutations.ts` | Modify | `markPaid` + `createPlanned` mutations (busy/error states extended) |
| `apps/dashboard/src/features/movements/PlannedSection.tsx` + test | Create | "Gastos fijos previstos": next-month label (es-AR `Intl`), total, inline "Agregar previsto" form (amount/note/category via `useCategories`; positive-amount guard, Spanish error, no API call) |
| `apps/dashboard/src/App.tsx` | Modify | render `PlannedSection` after `KpiCards` in the kpis tab |
| `apps/dashboard/src/features/movements/MovementList.tsx` | Modify | "Previsto" badge on PENDING rows; "Marcar pagado" action on own rows (`registrantOf === viewerId`); 409 → Spanish error, row unchanged |
| `apps/dashboard/src/features/movements/MovementFilters.tsx` | None | unchanged — no status filter is the default; pinned by test |

## Interfaces / Contracts

```ts
// packages/contracts — additions
export const movementStatusSchema = z.enum(["PAID", "PENDING"]);
// createMovementSchema: .status optional + refine(status !== "PENDING" || (type ?? "EXPENSE") === "EXPENSE")
// movementSummarySchema: planned: z.object({ month: z.string(), total: z.number() })
```

```ts
// summaryMonths composition (the trap): savings column survives
const conditions = [viewerPredicate, currencyARS, PENDING_EXCLUDED, occurredAtGte];
// SELECT ... SUM(CASE WHEN type='SAVINGS' ...) AS "savings"  — unchanged
```

```sql
-- summaryPlanned: derived month = load month (BA) + 1
SUM("amount") WHERE viewerPredicate AND "currency" = 'ARS'
  AND "type" = 'EXPENSE' AND "status" = 'PENDING'
  AND to_char(date_trunc('month', ("occurredAt" AT TIME ZONE 'UTC'
       AT TIME ZONE ${BA}) + interval '1 month'), 'YYYY-MM') = ${month}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Contracts unit | status enum values; PENDING-only-EXPENSE refine (incl. absent type); `{status}`/`{occurredAt}` rejected as empty patch; `planned` block parses | `packages/contracts/src/index.test.ts` |
| API integration (test DB :5433) | default PAID; per-aggregate exclusion (INCOME 900 + EXPENSE 300 + PENDING 2500 ⇒ income 900/expenses 300/balance 600/count unchanged, no bucket/top row); summaryMonths SAVINGS 100 + PENDING 2500 (savings stays 100, planned 2500); planned = next month, ignores from/to, 0 when none; BA boundary (`2026-08-01T02:59Z` ⇒ derived `2026-08`, excluded from other months); mark-paid: 200 → PAID + occurredAt≈now + enters KPIs, already-PAID → 409 unchanged, INCOME → 409, missing/other-owner → 404, double mark-paid → second 409; list returns PENDING newest-first; PATCH pending amount (2600, stays PENDING) | `movements.route.test.ts`, `movements.service.test.ts` (app.inject + Prisma) |
| Bot unit/integration | `previsto: 2500 alquiler` → PENDING EXPENSE + confirmation (brain and brain-absent); `compartido:`+`previsto:` both orders → SHARED PENDING; savings-keyword note never splits; amount-conflict payload keeps planned; `recent` omits PENDING; `planned` query answers real data (4000 next month) and redirects on failure; corrector window excludes PENDING → no_match | `telegram.service.test.ts`, `telegram.bot.test.ts`, `query-executor.test.ts`, `movement-corrector.test.ts` |
| Brain unit | `query_planned` decodes; `reply()` confirms `planned_month`/`planned_total` facts (spec's hand-made result); 8 goldens byte-match after regeneration | `bot-brain.test.ts` (+ `vitest -u` in-cycle) |
| Dashboard | PlannedSection renders month + es-AR total ($0 case); "Agregar previsto" valid → POST /expenses `type=EXPENSE, status=PENDING`, invalid amount → Spanish error + no call; PENDING row "Previsto" badge + "Marcar pagado" (own rows only); 409 → Spanish error; create/mark-paid bump the refresh token → list + summary re-fetch; no status filter offered | `PlannedSection.test.tsx`, `App.test.tsx`, `MovementList.test.tsx`, `useMovementMutations.test.tsx` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. `POST /movements/:id/paid` is an application-level Fastify endpoint using the existing `x-owner-id` tenant header; no shell or VCS surface is touched.

## Migration / Rollout

One Prisma migration (`20260928100000_movement_status`): `CREATE TYPE` + `ADD COLUMN ... NOT NULL DEFAULT 'PAID'` — atomic backfill, no explicit UPDATE statement. Rollback per proposal: revert + `DROP COLUMN "status"` + `DROP TYPE "MovementStatus"` (default-only backfill; mark-paid rewrote only paid rows). No feature flags. Order: contracts build → migration + `prisma generate` → API → bot/brain + goldens → dashboard.

## Open Questions

- None blocking. Both open design decisions are resolved above: planned section placement (D9: after KPI cards) and `query_planned` as a distinct intent (D6) with the `QUERY_TYPES` convergence.
