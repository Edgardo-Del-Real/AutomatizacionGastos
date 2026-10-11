## Exploration: Automatic Savings Split on Income (savings-rule)

### Current State

The system tracks money movements through a single Prisma model `Expense` (table never renamed) discriminated by a `type` enum (`EXPENSE | INCOME`). Contracts in `packages/contracts/src/index.ts` mirror this: `movementTypeSchema = z.enum(["EXPENSE", "INCOME"])`, `movementSchema = expenseSchema.extend({ type, visibility?, registrantId? })`, `movementFiltersSchema.type` uses the same enum, and `movementSummarySchema` computes `kpis { income, expenses, balance, avgPerMonth, avgPerMovement, maxAmount, count, countThisMonth }` plus `mom`, `daily`, `categories`, `top { expenses, income }`.

All aggregation lives in `apps/api/src/features/movements/movements.repository.ts` as raw SQL (`Prisma.$queryRaw`) with `CASE WHEN "type" = 'INCOME'::"MovementType" THEN ... END` sums in `summaryKpis`, `summaryMonths`, `summaryDaily`, and `summaryCategories`; `topByType` and `listByOwner` filter by type the same way. Every read composes ONE `viewerPredicate` (AD3) — owner + partner SHARED — which is type-agnostic, so a new type flows through visibility for free. `movements.service.ts` derives `balance = income − expenses` (line 63) and category percents from the same sums.

Categories are `Category { id, ownerId, name, createdAt }` + `CategoryKeyword { keyword }` — **no type field**. "otro" is a convention enforced in code: `ensureOtro` upserts it, `deleteCategory` guards it (normalized `"otro"`), setup skips creating it then ensures it. Keyword matching (`matcher.ts`) is diacritic-insensitive, word-boundary based, oldest-rule-wins. Commands (`telegram.commands.ts`) handle `registrar categoria`, `renombrar categoria`, `asociar palabra`, `listar categorias`, `configurar categorias`; the `asociar palabra` pattern is the conversational analog for a savings-rule definition.

Bot registration path: `handleUpdate` → gate/dedup → `parseCommand` → `parseSharedPrefix` (deterministic `compartido:` prefix) → `handleRegistration` → `tryBrainInterpret` → `routeEnvelopeIntent` → `executeRegistration` → `registerWithCategory` / `registerOtroWithCorrection` → `createMovement` → `expenseService.createExpense` with `type: classifyMovementType(body)`. The type is derived deterministically from the body (`message.parser.ts` `INCOME_KEYWORDS`: ingreso|cobro|sueldo|venta|recibí|depósito, or `+`-prefixed amount). The brain (`bot-brain.ts`) is a strict intent envelope (`conversationEnvelopeSchema`) with pinned prompt goldens (8 golden files under `__goldens__/`, asserted in `bot-brain.test.ts` "prompt goldens"). Query execution (`query-executor.ts` + `query.types.ts`) covers `categories | recent | balance | month` with fixed reply templates in `reply-text.ts`.

Dashboard consumes `@rita/contracts` zod schemas over `/api/*`: `KpiCards` renders income/expenses/balance/countThisMonth; `MovementList` has `TYPE_LABELS: Record<MovementType, string>` (INCOME/EXPENSE) with a two-way badge ternary; `MovementFilters` hardcodes the two type options; `calculations.ts` builds the pie from `expenseAmount` per category. Contracts build via `tsc` (`packages/contracts/package.json` `build`), consumed as `workspace:*`; `openspec/config.yaml` apply rule mandates building contracts first.

### Affected Areas

- `packages/contracts/src/index.ts` — `movementTypeSchema` gains `SAVINGS`; `movementSummarySchema` needs savings aggregation (kpis and/or monthly bucket); optional `savingsRuleSchema`; `movementFiltersSchema.type` accepts the new type automatically.
- `apps/api/prisma/schema.prisma` — `enum MovementType` gains `SAVINGS`; `Category` gains a type enum (`NORMAL | SAVINGS`, default NORMAL); new `SavingsRule` model (`ownerId`, `keyword`, `percent`, `createdAt`, unique `[ownerId, keyword]`), mirroring `CategoryKeyword`.
- `apps/api/src/features/movements/movements.repository.ts` — ALL 8 raw queries: SAVINGS must be excluded from income AND expense `CASE WHEN` sums (`summaryKpis` L157-158, `summaryMonths` L192-193, `summaryDaily` L223-224, `summaryCategories` L252-253); new month-scoped savings aggregation for "cuánto ahorré este mes"; `listByOwner` type filter works as-is once the enum grows.
- `apps/api/src/features/movements/movements.service.ts` — balance stays `income − expenses` (savings excluded → available money, matches the product decision); savings summary fields wired through.
- `apps/api/src/features/categories/*` — `categories.types.ts` (CategoryEntity gains type), `categories.service.ts` (create guards for "ahorro" → SAVINGS type; `ensureAhorro` analog of `ensureOtro`; delete/rename guards; `assertOwnerCategory` must reject SAVINGS category for EXPENSE/INCOME movements), `categories.repository.ts` (type column writes; upsert of ahorro), `matcher.ts` untouched but savings rules need a sibling matcher (keyword → percent) or reuse of the normalized boundary approach.
- `apps/api/src/features/telegram/telegram.service.ts` — registration flow: compute split (keyword rule match on the income note), register INCOME with NET amount + create SAVINGS movement in "ahorro"; per-message overrides ("sin ahorro", "con X%"); two-movement atomicity decision; `createMovement` must accept an explicit type instead of always deriving via `classifyMovementType` (L1262).
- `apps/api/src/features/telegram/bot-brain.ts` — new intent (e.g. `create_savings_rule`) and/or envelope field for the override; `INTERPRET_SYSTEM_PROMPT`, `FEW_SHOTS`, `REPLY_SYSTEM_PROMPT` change → golden snapshot regen required.
- `apps/api/src/features/telegram/query.types.ts` + `query-executor.ts` + `reply-text.ts` — new `savings` query type (or savings fields on `month`) for "cuánto ahorré este mes"; template + prompt updates.
- `apps/api/src/features/telegram/telegram.commands.ts` — optional explicit command for savings rules (conversational definition may go through the brain intent instead).
- `apps/api/src/features/messages/message.parser.ts` — unchanged (income detection already covers "cobro sueldo de entrenuts"); split applies only to `INCOME` registrations.
- `apps/api/src/features/expenses/expenses.repository.ts` — `create` writes `type` already; no change needed beyond the new enum value, unless savings creation goes through a dedicated service.
- `apps/dashboard/src/features/movements/` — `MovementList.tsx` `TYPE_LABELS` + badge ternary (SAVINGS row rendering), `MovementFilters.tsx` type options, `KpiCards.tsx` (optional "Ahorro" card), `calculations.ts` (pie already ignores savings if expense sums exclude them), `infra/api.ts` (schema-driven, no change unless new summary fields).
- `openspec/specs/` — new `savings` capability spec + deltas to `money-movements`, `movement-categories`, `bot-brain`, `telegram-bot`, `dashboard-web`.

### Approaches

1. **Full additive: SAVINGS type + SavingsRule entity + Category type field** — Prisma enum grows, `Category.type` discriminates ahorro, `SavingsRule` stores keyword→percent; bot splits income into net-INCOME + SAVINGS-in-ahorro; new `savings` query type; dashboard renders the new type.
   - Pros: matches the confirmed product decision exactly; clean separation (savings never pollutes income/expense sums); ahorro category is structurally protected; rules are queryable/editable like keywords.
   - Cons: touches every layer (contracts, schema + migration, 8 raw queries, bot flow, prompts + goldens, dashboard); larger review surface.
   - Effort: High

2. **Compute-only savings (no SAVINGS type)** — derive savings at query time from income × rules; no new movement type, no ahorro category.
   - Pros: no schema/query changes to movements.
   - Cons: contradicts the confirmed design (SAVINGS movement in ahorro category, "SAVINGS is a new movement type"); historical accuracy lost (rules changed → past savings recomputed); no per-movement audit trail.
   - Effort: Medium — rejected (violates the product decision).

3. **Overload CategoryKeyword with a percent column** — reuse the existing keyword table for savings rules on the ahorro category.
   - Pros: no new table; reuses matcher.
   - Cons: conflates expense-category matching with savings semantics (ahorro keywords would match expenses too); no category type concept (violates the "special category type" decision); override/multi-rule semantics get murky.
   - Effort: Medium — rejected as worse than 1.

### Recommendation

Approach 1, scoped as a multi-layer additive change following the vertical-slice pattern. Concretely: SAVINGS enum value + migration; `CategoryType` enum with default `NORMAL` (ahorro ensured like otro, create/delete/rename guards, category-type validation in `assertOwnerCategory`); new `SavingsRule` model + service + a keyword→percent matcher reusing `normalizeForMatch`/boundary semantics; bot-side split in the registration flow with deterministic per-message overrides parsed at arrival (the `compartido:` prefix pattern is the precedent) and a brain intent for conversational rule definition; `savings` query type fed by a month-scoped repository aggregation; contracts rebuilt first; dashboard gains the SAVINGS label/filter (KPI card optional, scope decision). Define the rounding rule so `net + savings === gross` exactly (e.g. compute savings first, round to 2 decimals, net = gross − savings).

### Risks

- **CRITICAL — Prompt goldens**: any brain prompt/few-shot change breaks 8 pinned golden snapshots (`bot-brain.test.ts`). Goldens must be regenerated in-cycle with the prompt changes.
- **CRITICAL — Raw SQL surface**: a missed `CASE WHEN` in `summaryKpis`/`summaryMonths`/`summaryDaily`/`summaryCategories` leaks savings into income/expenses/balance KPIs. Centralize the type-exclusion and cover with integration tests.
- **Two-movement atomicity**: INCOME (net) + SAVINGS are two creates; decide same-transaction vs best-effort, and what the confirmation reply reports (gross, net, savings amount).
- **Existing "ahorro" collision**: an owner may already have a normal category named "ahorro" (no reservation today); migration/conversion policy needed (convert to SAVINGS type vs conflict).
- **Override parsing**: "sin ahorro" / "con X%" must be deterministic (brain-absent path still works); the `compartido:` prefix precedent applies; interplay with the shared flag needs ordering.
- **Percent validation & rounding**: bounds (0 < pct ≤ 100), Decimal(12,2) storage, and a single rounding rule so net+savings == gross.
- **Savings movement visibility**: does a SHARED income produce a SHARED savings movement? Scope decision.
- **Dashboard scope**: list rendering (badge/labels) is mandatory once SAVINGS rows exist; "Ahorro" KPI card and filter option are scope decisions — flag for the proposal.
- **`PATCH` enforcement**: `assertOwnerCategory` currently accepts any owner category; assigning the SAVINGS category to an EXPENSE/INCOME movement must be rejected.

### Ready for Proposal

Yes — the product decision is confirmed and the exploration evidence is complete. The orchestrator should tell the user the open scope decisions to settle in proposal/spec: dashboard scope (KPI card + filter), savings-movement visibility inheritance, the rounding rule, migration policy for pre-existing "ahorro" categories, and whether the savings-rule definition is brain-intent only or also an explicit command.