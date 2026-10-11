# Proposal: Planned Fixed Expenses

## Intent

Register next month's fixed expenses without polluting KPIs: an EXPENSE stored PENDING — invisible to aggregates — until "pagado" flips it to PAID with the real payment date.

## Scope

### In Scope

- `MovementStatus` enum (`PENDING|PAID`, default `PAID`); migration mirrors `20260921130000_movement_visibility`.
- `PENDING_EXCLUDED` fragment on the 5 KPI aggregates (`summaryMonths` keeps SAVINGS); never `listByOwner`/`summarySavings`.
- Derived target month: `occurredAt` (load date) + 1 month (BA); summary `planned { month, total }` fixed to next month, ignores `from`/`to`.
- `POST /movements/:id/paid`: EXPENSE + PENDING guards, 409 on already-PAID, sets `status=PAID` + `occurredAt=now` in one write.
- PATCH stays `amount|note|category` (editable while PENDING); PENDING only for EXPENSE; no savings split.
- Channels: bot `previsto:` prefix (`compartido:` compatible) + dashboard "Agregar previsto".
- Bot: recent + corrector exclude PENDING; `planned` query; 8 goldens regenerate in-cycle.
- Dashboard: planned section, PENDING badge, "Marcar pagado"; no status filter.

### Out of Scope

- Status filters; stored month column; `occurredAt` editing; recurring plans.

## Capabilities

### New Capabilities

- `planned-fixed-expenses`: status lifecycle, derived month, KPI exclusion, mark-paid, channels, guards.

### Modified Capabilities

- `money-movements`: contracts + summary: status schemas, PENDING exclusion, `planned` block.
- `telegram-bot`: `previsto:` registration; recent + corrector exclude PENDING; `planned` query.
- `bot-brain`: `planned` query type; goldens regenerate.
- `dashboard-web`: planned section, badge, mark-paid, "Agregar previsto".
- `movement-correction`: window searches non-PENDING only.

## Approach

Approach 1 (exploration): enum + dedicated transition on the savings precedent; `PENDING_EXCLUDED` mirrors `SAVINGS_EXCLUDED`; `plannedForMonth` derives month from `occurredAt + 1` (BA); contracts rebuild first.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modified | status schema; `planned`; EXPENSE-only refine |
| `apps/api/prisma/` + migration | Modified | `MovementStatus`; default `PAID` |
| `apps/api/src/features/` (movements, expenses) | Modified | fragment; `plannedForMonth`; `markPaid`; route; pass-through |
| `apps/api/src/features/telegram/` + `__goldens__/` | Modified | `previsto:`; `planned`; exclusions; goldens |
| `apps/dashboard/src/` | Modified | section; badge; mark-paid; creation |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Missed fragment composition leaks PENDING into KPIs | Med | Central fragment; per-aggregate tests |
| `summaryMonths` drops SAVINGS column | Med | SAVINGS + PENDING test |
| 8 prompt goldens break | High | Regenerate in-cycle |
| `occurredAt` rewrite changes planned month | Low | PATCH excludes `occurredAt`; mark-paid owns rewrite |
| Exceeds 400-line review budget | Med | `auto-chain`; chained PRs forecast |

## Rollback Plan

Revert merged PRs; DB: `DROP COLUMN "status"` + `DROP TYPE "MovementStatus"` — default-only backfill; mark-paid rewrote only paid rows.

## Dependencies

- `pnpm --filter @rita/contracts build` first; PostgreSQL test DB on localhost:5433; Groq key optional.

## Success Criteria

- [ ] PENDING create leaves all KPIs unchanged; `planned` reports next month.
- [ ] Mark-paid → PAID + today, row counts; already-PAID → 409; INCOME PENDING rejected.
- [ ] `previsto: 2500 alquiler` → PENDING EXPENSE, absent from recent/corrector; `planned` query answers real data.
- [ ] Goldens regenerated; suites green; savings, SHARED, category and PATCH guards intact.
