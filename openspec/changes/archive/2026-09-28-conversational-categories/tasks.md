# Tasks: Conversational Categories

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Estimated: ~800 authored (+8 goldens); ask-on-risk; split PR 1→2→3→4→5.

## Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Matcher fold | PR 1 | `pnpm --filter @rita/api test -- matcher.test.ts` | N/A — pure fn | Revert matcher pair |
| 2 | Reserved guards | PR 2 | `pnpm --filter @rita/api test -- categories.service` | Postgres 5433 | Revert guard files; delete untouched |
| 3 | Savings match | PR 3 | `pnpm --filter @rita/api test -- savings` | Postgres 5433 | Revert savings.service.ts |
| 4 | Envelope+goldens | PR 4 | `pnpm --filter @rita/api test -- bot-brain -u` | N/A — unit | Revert bot-brain + goldens |
| 5 | Telegram funnel | PR 5 | `pnpm --filter @rita/api test -- telegram` | Postgres 5433 + bot suite | Revert telegram plumbing |

## Phase 1: Matcher Fold

- [x] 1.1 RED `apps/api/src/features/categories/matcher.test.ts`: meses→mes, cafes→cafe (never caf), luces→luz, jerseis→jersey, pies→pie, cafe2go no-match, gasto fijo↔gastos fijos
- [x] 1.2 RED exclusions: lunes, crisis, frances, entrenuts self-fold
- [x] 1.3 GREEN `apps/api/src/features/categories/matcher.ts`: `foldSpanishPluralToken` (13 rules, len≥4, exclusions), `normalizeForMatchTolerant`; `matchCategory` folds both sides; `normalizeForMatch`/`boundaryRegex` byte-identical

## Phase 2: Reserved Guard

- [x] 2.1 RED `apps/api/src/features/categories/categories.service.integration.test.ts` + `categories.service.savings.integration.test.ts`: reserved create/rename (provisto, otros, compartidos); ahorros→SAVINGS redirect (no upsert/NORMAL); exact ahorro→SAVINGS; variant rejected naming existing; phantoms deletable
- [x] 2.2 GREEN `apps/api/src/features/categories/reserved.ts`: `ReservedConcept`, folded set, alias `provisto→previsto`, `resolveReservedConcept`, `ReservedCategoryError extends ValidationFailedError`
- [x] 2.3 GREEN `apps/api/src/features/categories/categories.service.ts`: exact-ahorro→folded-reserved→folded-availability→create; folded `assertNameAvailable`; reserved error before `ValidationFailedError`; delete untouched

## Phase 3: Savings Tolerant Match

- [x] 3.1 RED `apps/api/src/features/savings/savings.service.test.ts`: sueldos↔sueldo both sides; stored "sueldos" matches both; flip "entrenut" no-match (L141) to match, replace with "entrenutsa" no-match; arithmetic unchanged
- [x] 3.2 GREEN `apps/api/src/features/savings/savings.service.ts`: `matchNote` folds note+keyword; `defineRule`/`computeSplit` untouched
- [x] 3.3 RED `apps/api/src/features/telegram/telegram.service.savings.test.ts`: "cobré sueldos" splits with sueldo rule (money pin)

## Phase 4: Envelope + Prompt + Goldens

- [x] 4.1 RED `apps/api/src/features/telegram/bot-brain.test.ts`: `planned` decodes/defaults false/malformed→null; prompt pins planned teaching
- [x] 4.2 GREEN `apps/api/src/features/telegram/bot-brain.ts`: envelope+schema `planned` (`z.boolean().default(false)`); prompt key list + planned instruction + few-shot; `CategoryCommandErrorCode` `"reserved"`
- [x] 4.3 Regenerate all 8 `apps/api/src/features/telegram/__goldens__/*` via `vitest -u` in-cycle (`interpret-system-prompt.txt` + `interpret-few-shots.json`)

## Phase 5: Telegram Plumbing

- [x] 5.1 RED `apps/api/src/features/telegram/telegram.service.test.ts` + `category-executor.test.ts` + `movement-corrector.test.ts` + `reply-text.test.ts`: redirect per path (registrar cmd, dialog token open, setup entry, then_reassign); folded dialog "cafes"→"Cafe"; planned flag→PENDING; prefix beats flag:false; brain-absent prefix; `resolveSuggestion` exact
- [x] 5.2 GREEN `apps/api/src/features/telegram/telegram.service.ts`: planned merge `prefixPlanned || envelope.planned === true` (`executeRegistration`/`askAmountConfirmation`); folded dialog resolution before auto-create; gated auto-creates + redirect catches (state open, "otro"); setup redirects; registrar/rename catch reserved first
- [x] 5.3 GREEN `apps/api/src/features/telegram/movement-corrector.ts`: `resolveTargetCategory` exact→folded→guarded create; `CorrectionResult {status:"rejected", concept, name}` pre-scoring short-circuit
- [x] 5.4 GREEN `apps/api/src/features/telegram/category-executor.ts` + `reply-text.ts`: catch `ReservedCategoryError`→code `"reserved"`, `reservedCategoryReply(name, concept)`; setup-done-with-redirects; template branches
- [x] 5.5 RED `apps/api/src/features/telegram/telegram.service.integration.test.ts`: planned e2e with brain flag; api+dashboard suites green

## Rollback

No DB migration; revert per-PR; phantoms stay deletable.