# Proposal: Automatic Savings Split on Income (savings-rule)

## Intent

Owners need to save a percentage of specific incomes automatically; today income lands whole into KPIs and saved money is silently spent. Keyword→percent savings rules make a matching income register NET (gross − savings) plus a SAVINGS movement in a special "ahorro" category; savings never count as income/expense in KPIs.

## Scope

### In Scope
- `SavingsRule` model (ownerId, keyword, percent; unique [ownerId, keyword]); conversational + explicit-command definition.
- Income split: INCOME NET + SAVINGS in "ahorro"; SHARED income → SHARED savings.
- Deterministic overrides: "sin ahorro", "con X%" (`compartido:` precedent).
- Category type NORMAL|SAVINGS; "ahorro" receives only SAVINGS movements.
- SAVINGS excluded from all income/expense sums; balance = net income − expenses.
- "cuánto ahorré este mes" query; dashboard "Ahorro" badge, filter option, "Ahorrado" KPI card.

### Out of Scope
- Savings goals, interest, withdrawals, multi-currency savings; rule deletion beyond re-definition upsert.

## Capabilities

### New Capabilities
- `savings`: SavingsRule entity/matching, income split + rounding, ahorro semantics, overrides, savings query, KPI-exclusion invariants.

### Modified Capabilities
- `money-movements`: type enum and contracts gain SAVINGS (list filter follows); summary excludes SAVINGS from sums and adds month savings; PATCH rejects "ahorro" on EXPENSE/INCOME.
- `movement-categories`: Category gains type NORMAL|SAVINGS (default NORMAL); "crear categoría ahorro" creates SAVINGS-typed; delete/rename guards.
- `bot-brain`: `create_savings_rule` intent; reply result gains savings facts; prompts change → goldens regenerate.
- `telegram-bot`: registration split, overrides, savings query, explicit rule command.
- `dashboard-web`: SAVINGS badge/filter; "Ahorrado" KPI card.

## Approach

Approach 1 (additive vertical slices). Settled decisions:
- Rounding: savings = round2(gross × pct/100); net = gross − savings → net + savings === gross exactly.
- Migration: pre-existing "ahorro" categories auto-convert to SAVINGS type; their movements stay untouched legacy data; guards apply to new writes only.
- Definition: brain intent `create_savings_rule` redirects to explicit command `registrar ahorro: <palabra> al <X>%` (`associate_keyword` precedent).
- Percent: 0 < pct ≤ 100, Decimal(12,2).

## Affected Areas

| Area | Impact |
|------|--------|
| `packages/contracts/src/index.ts` | Modified: SAVINGS type, savings fields, savingsRuleSchema |
| `apps/api/prisma/schema.prisma` + migrations | Modified: MovementType/CategoryType, SavingsRule, ahorro conversion |
| `apps/api/src/features/{movements,categories,telegram}/` | Modified: query exclusion, guards, split, prompts + goldens |
| `apps/dashboard/src/features/movements/` | Modified: badge, filter, KPI card |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 8 pinned prompt goldens break | High | Regenerate in-cycle with prompts |
| Missed CASE WHEN leaks savings into KPIs | Medium | Centralized exclusion; integration test per query |
| Two-movement atomicity | Medium | Single transaction for both creates |
| Legacy "ahorro" conversion surprises | Low | Migration-only conversion; new-write guards |

## Rollback Plan

Revert commits; down-migration drops `SavingsRule` and `Category.type` and deletes SAVINGS movements (data loss acknowledged); the unused enum value stays (PostgreSQL lacks DROP VALUE). Net-income history is not recomputed.

## Dependencies

- PostgreSQL 16 on localhost:5433 (existing); contracts build first.

## Success Criteria

- [ ] Rule 10% + "cobro sueldo de entrenuts 1000" → INCOME 900 + SAVINGS 100 (SHARED if "compartido:")
- [ ] "sin ahorro" / "con 5%" overrides work brain-absent
- [ ] Summary endpoints exclude SAVINGS from income/expense/balance
- [ ] "cuánto ahorré este mes" answers from real data
- [ ] "crear categoría ahorro" never creates a normal category
- [ ] Dashboard badge/filter/KPI card render; API + dashboard tests green
