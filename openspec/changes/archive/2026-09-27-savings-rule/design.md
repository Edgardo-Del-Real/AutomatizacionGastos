# Design: Automatic Savings Split on Income (savings-rule)

## Technical Approach

Additive vertical slice (proposal Approach 1): `SAVINGS` joins `MovementType`; `Category` gains `CategoryType` (`NORMAL|SAVINGS`); new `SavingsRule` model + `features/savings` slice; Telegram registration tails split matching INCOME into net-INCOME + SAVINGS-in-"ahorro" (one transaction); aggregates exclude SAVINGS via one SQL fragment.

## Architecture Decisions

| # | Decision | Alternatives | Rationale |
|---|----------|--------------|-----------|
| D1 | Fragment `"type" <> 'SAVINGS'::"MovementType"` in `summaryKpis`/`summaryDaily`/`summaryCategories` WHERE | Patch each CASE | CASE sums exclude SAVINGS implicitly; `COUNT`, `MAX`, `monthsWithData`, categories GROUP BY would leak |
| D2 | `summaryMonths` keeps SAVINGS, adds third CASE sum → `mom.months[].savings` | Exclusion there | Per-month savings need rows; savings-only months still bucket |
| D3 | New `summarySavings(scope, period)` → `kpis.savings` (current BA month, ARS, viewerPredicate) | Derive from mom | `summaryKpis` excludes SAVINGS; month-scoped sum needs its own query |
| D4 | New slice: `SavingsRuleService` (defineRule upsert+validation; `matchNote`→percent via `normalizeForMatch` + exported `boundaryRegex`, oldest-wins) + `PrismaSavingsRuleRepository` | Fold into categories | Vertical-slice convention; rules carry a percent |
| D5 | Split in the two registration tails: `classifyMovementType(body)` once; INCOME → `resolveSplit(ownerId, note ?? body, override)`; write = `ensureAhorro` + `createIncomeWithSavings`; `createMovement` gains explicit `type` param | Split in brain/createMovement | Tails funnel all registration paths; brain stays out |
| D6 | Overrides parsed once at arrival after `parseSharedPrefix`, stripped before parser/brain; persisted in the amount-confirmation payload | Brain flag, late re-parse | `compartido:` precedent; stripping stops "con 5%" trapping `parseAmount`; invalid X → rejected |
| D7 | `createIncomeWithSavings` → repository `$transaction`. Edges: savings 0 → whole; net 0 (pct 100) → only SAVINGS movement | Two calls; zero-amount rows | Atomicity scenario; positive-amount schemas forbid zero amounts |
| D8 | `con X%` only replaces a matching rule's percent; no rule → whole | Rule-free split | Spec: "replace the rule percent" |
| D9 | Guards in `CategoryService`: create "ahorro" → `ensureAhorro` upsert (SAVINGS); rename/delete reject SAVINGS-typed targets (and renaming to "ahorro"); `assertOwnerCategory(ownerId, name, movementType?)` rejects SAVINGS category on EXPENSE/INCOME | Route-only, DB triggers | One guard owner covers PATCH, correction dialogs, category CRUD |
| D10 | `create_savings_rule` intent → redirect only; definition via command `registrar ahorro: <palabra> al <X>%` (0<p≤100, else rejected, nothing stored) | Conversational execution | Settled decision; `associate_keyword` precedent |
| D11 | One hand-written migration: `ALTER TYPE "MovementType" ADD VALUE 'SAVINGS'` (PG forbids using a new enum value in-migration — this one never does); `CREATE TYPE "CategoryType"`; `Category.type` DEFAULT 'NORMAL' + UPDATE converting `lower(name)='ahorro'`; `CREATE TABLE "SavingsRule"` (percent `DECIMAL(12,2)`, unique `[ownerId, keyword]`) | Split migrations | Hand-written precedent, pinning tests; no DROP VALUE → rollback keeps the value |
| D12 | `savings` query type reads `getSummary().kpis.savings` + `mom.months.at(-1).month` | New repo call | Same path as `month`/`balance` executors |

## Data Flow

```
update → gate/dedup → parseCommand
  → parseSharedPrefix → parseSavingsOverride   (strip "sin ahorro"/"con X%"; invalid % → error reply, stop)
  → handleRegistration → brain envelope | deterministic → category resolution
  → tail: type = classifyMovementType(body)
       INCOME + rule match → resolveSplit → ensureAhorro → createIncomeWithSavings
            └ $transaction: Expense(INCOME net) + Expense(SAVINGS "ahorro", same note/visibility)
            → reply facts gross/net/savings
       else → createMovement(type) → today's reply
  reads: SAVINGS excluded (D1–D3)
```

## File Changes

| File | Action | Change |
|------|--------|--------|
| `packages/contracts/src/index.ts` | Modify | `movementTypeSchema` + SAVINGS; summary `kpis.savings`, `months[].savings`; `savingsRuleSchema` (0<pct≤100) |
| `apps/api/prisma/schema.prisma` + new migration | Modify/Create | D11 |
| `apps/api/src/features/savings/` (types, repository, service + tests) | Create | D4 slice |
| `apps/api/src/features/categories/` (types, service, repository, matcher, executor + tests) | Modify | `CategoryEntity.type`; guards D9; `ensureAhorro`; export `boundaryRegex`; `savings_forbidden` error code |
| `apps/api/src/features/expenses/` (service, repository + tests) | Modify | `createIncomeWithSavings` + `$transaction` |
| `apps/api/src/features/movements/` (repository, types, service + tests) | Modify | D1–D3; `MonthBucket.savings`; `findById`; PATCH guard; summary wiring |
| `apps/api/src/features/telegram/` (parser, commands, service, bot-brain, query, reply-text + tests, `__goldens__/`) | Modify | D5–D7, D10, D12; `ExecutionResult` split facts; `RecentMovementResult` SAVINGS ("ahorro" label); prompts + goldens |
| `apps/api/src/app.ts` | Modify | wire `savingsService` |
| `apps/dashboard/src/features/movements/` (KpiCards, MovementList, MovementFilters + tests), `infra/api.ts` | Modify | Ahorrado card; Ahorro badge/label; filter option; local filters type + SAVINGS |

## Interfaces / Contracts

```ts
type SavingsOverride = { kind: "none" } | { kind: "disabled" } | { kind: "percent"; percent: number };
// savings.service.ts
defineRule(ownerId, keyword, percent): Promise<SavingsRuleEntity>  // upsert on [ownerId, keyword]
matchNote(ownerId, note): Promise<number | null>
computeSplit(gross, percent): { net; savings }
// Prisma.Decimal: savings = (gross×pct/100).toDecimalPlaces(2); net = gross − savings → net+savings === gross exactly
resolveSplit(ownerId, note, override): Promise<{ kind: "whole" } | { kind: "split"; percent; net; savings }>
```

## Testing Strategy (strict TDD: RED per scenario → GREEN)

| Layer | What | How |
|-------|------|-----|
| Unit | computeSplit (10@33% → 3.30/6.70; Decimal invariant), defineRule validation (0/101/−1 rejected; upsert), matcher, `parseSavingsOverride` (150% invalid), command parse, envelope `create_savings_rule`, reply templates, tails (split facts, SHARED inheritance, brain-absent, no-rule whole, one-call atomicity), PATCH + category guards | vitest fakes |
| Integration | per-query exclusion (kpis, months, daily, categories, top), `kpis.savings` month-scoped, `months[].savings`, SavingsRule upsert, migration pins, full split e2e, `$transaction` rollback, PATCH "ahorro" → 422, list `type=SAVINGS` | test-DB pattern |
| Dashboard | Ahorrado $150/$0, Ahorro badge row, Ahorro filter option | vitest + Testing Library |
| Goldens | 8 bot-brain snapshots regenerated in-cycle | `vitest run -u` (contracts built first) |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Single migration (D11); movements untouched; legacy "ahorro" converts; guards on new writes only. Rollback: revert commits, manual SQL (drop `SavingsRule`, `Category.type`, delete SAVINGS movements — acknowledged loss); enum value remains (no DROP VALUE).

## Open Questions

- [ ] net 0 edge (pct=100): only the SAVINGS movement is created — confirm.
- [ ] Frozen `POST /expenses` can still write "ahorro" on EXPENSE rows — accept or guard?
- [ ] `KpiCards` renders 4 cards; baseline spec enumerates 7 — only "Ahorrado" added here.
