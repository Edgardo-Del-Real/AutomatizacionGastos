# Apply Progress: conversational-categories

- Change: `conversational-categories`
- Mode: **Strict TDD**
- Delivery: single PR with maintainer-approved `size:exception` (~800 authored lines + 8 goldens regenerated, 2 changed bytes)
- Store: openspec (file) + Engram mirror (`sdd/conversational-categories/apply-progress`, project `user`)
- Date: 2026-09-28
- Status: **17/17 tasks complete — Ready for verify**

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/api/src/features/categories/matcher.test.ts` | Unit | ✅ 12/12 | ✅ Written | ✅ 32/32 | ✅ 13 rule cases + exclusions + boundary | ✅ Clean (consts extracted) |
| 1.2 | `apps/api/src/features/categories/matcher.test.ts` | Unit | ✅ 12/12 | ✅ Written | ✅ 32/32 | ✅ 5 excluded words + entrenuts | ➖ Same unit as 1.1 |
| 1.3 | `apps/api/src/features/categories/matcher.ts` | Unit | N/A (additive) | N/A (RED via 1.1/1.2) | ✅ 32/32 | ✅ gasto fijo↔gastos fijos both ways | ✅ `normalizeForMatch`/`boundaryRegex` byte-identical |
| 2.1 | `categories.service.integration.test.ts` + `categories.service.savings.integration.test.ts` | Integration | ✅ 27/27 + 12/12 | ✅ Written (import of nonexistent `./reserved`) | ✅ 45/45 | ✅ 6 reserved members + 4 folded plurals + variant pairs | ✅ Phantoms deletable pinned |
| 2.2 | `apps/api/src/features/categories/reserved.ts` | Unit | N/A (new file) | N/A (RED via 2.1) | ✅ 45/45 | ✅ provisto alias vs general matching | ✅ `ReservedCategoryError` extends `ValidationFailedError` |
| 2.3 | `apps/api/src/features/categories/categories.service.ts` | Integration | ✅ 39/39 | N/A (RED via 2.1) | ✅ 45/45 | ✅ rename reserved + variant rename | ✅ delete untouched; ahorro upsert order preserved |
| 3.1 | `apps/api/src/features/savings/savings.service.test.ts` | Unit | ✅ 23/23 | ✅ Written | ✅ 33/33 | ✅ sueldos↔sueldo both sides + stored plural | ✅ arithmetic tests untouched |
| 3.2 | `apps/api/src/features/savings/savings.service.ts` | Unit | N/A (additive) | N/A (RED via 3.1) | ✅ 33/33 | ✅ entrenut flips, entrenutsa no-match | ✅ `defineRule`/`computeSplit` untouched |
| 3.3 | `apps/api/src/features/telegram/telegram.service.savings.test.ts` | Unit (real service) | ✅ 10/10 | ✅ Written | ✅ 33/33 | ✅ money pin: INCOME 900 / SAVINGS 100 | ✅ real `SavingsRuleService` wired via deps |
| 4.1 | `apps/api/src/features/telegram/bot-brain.test.ts` | Unit | ✅ 153/153 | ✅ Written | ✅ 159/159 | ✅ decode/default/malformed + prompt pins | ➖ Schema mirrors `shared` exactly |
| 4.2 | `apps/api/src/features/telegram/bot-brain.ts` | Unit | N/A (additive) | N/A (RED via 4.1) | ✅ 159/159 | ✅ 7 envelope expectations updated | ✅ goldens regenerated in-cycle |
| 4.3 | `__goldens__/*` (8 files) | Snapshot | ✅ 8/8 | N/A (stale after 4.2) | ✅ 8/8 after `vitest -u` | ✅ only 2 files changed bytes | ✅ 6 goldens byte-identical |
| 5.1 | `telegram.service.test.ts` + `category-executor.test.ts` + `movement-corrector.test.ts` + `reply-text.test.ts` | Unit | ✅ 199/199 | ✅ Written | ✅ 222/222 | ✅ per-path redirects + folded dialog + planned merge | ✅ `resolveSuggestion` exact pinned |
| 5.2 | `apps/api/src/features/telegram/telegram.service.ts` | Unit + Integration | ✅ 199/199 | N/A (RED via 5.1) | ✅ 222/222 | ✅ prefix beats flag:false; brain-absent pin | ✅ dialog state kept open on redirect |
| 5.3 | `apps/api/src/features/telegram/movement-corrector.ts` | Unit | ✅ 17/17 | N/A (RED via 5.1) | ✅ 222/222 | ✅ rejected short-circuit + folded resolve | ✅ duplicate-race resolution preserved |
| 5.4 | `category-executor.ts` + `reply-text.ts` | Unit | ✅ 14/14 + 52/52 | N/A (RED via 5.1) | ✅ 222/222 | ✅ per-concept redirects + template branches | ✅ reserved caught before ValidationFailedError |
| 5.5 | `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Integration | ✅ 36/36 | ✅ Written | ✅ 38/38 | ✅ brain flag e2e + prefix-beats-flag e2e | ✅ api 886/886 + dashboard 161/161 green |

## Work Unit Evidence

| Work unit | Focused test command + exact result | Runtime harness command/scenario + exact result | Rollback boundary |
|-----------|-------------------------------------|--------------------------------------------------|-------------------|
| 1 — Matcher fold (tasks 1.1–1.3) | `pnpm --filter @rita/api exec vitest run src/features/categories/matcher.test.ts` → 32/32 passed | N/A — pure function, no runtime boundary (matcher is a deterministic module) | Revert commit `68a085a` (matcher.ts + matcher.test.ts pair); no other file depends on the new exports |
| 2 — Reserved guards (2.1–2.3) | `pnpm --filter @rita/api exec vitest run src/features/categories/categories.service.integration.test.ts src/features/categories/categories.service.savings.integration.test.ts` → 45/45 passed | Postgres 5433 (`automatizacionrita_test`): reserved create/rename rejects, ahorros redirect, variant rejection, phantom delete — all persisted assertions | Revert commit `c5d50b5` (reserved.ts + categories.service.ts + test files); deleteCategory untouched |
| 3 — Savings tolerant match (3.1–3.3) | `pnpm --filter @rita/api exec vitest run src/features/savings/savings.service.test.ts src/features/telegram/telegram.service.savings.test.ts` → 33/33 passed | Money pin: `cobro sueldos 1000` against stored `sueldo` rule → `createIncomeWithSavings` gross 1000/percent 10, replies 900/100 | Revert commit `62ba724` (savings.service.ts + tests); `defineRule`/`computeSplit` untouched |
| 4 — Envelope + prompt + goldens (4.1–4.3) | `pnpm --filter @rita/api exec vitest run src/features/telegram/bot-brain.test.ts` → 159/159 (after `-u` golden regen) | N/A — unit; goldens pinned by snapshot tests in-cycle | Revert commit `1a78e4c` (bot-brain.ts + test + 2 changed goldens); 6 unchanged goldens unaffected |
| 5 — Telegram funnel (5.1–5.5) | `pnpm --filter @rita/api exec vitest run src/features/telegram/telegram.service.test.ts src/features/telegram/category-executor.test.ts src/features/telegram/movement-corrector.test.ts src/features/telegram/reply-text.test.ts src/features/telegram/telegram.service.integration.test.ts` → 260/260 passed | Postgres 5433 + bot suite: planned e2e (brain flag → PENDING, prefix beats flag:false); full api suite 886/886, dashboard 161/161; `typecheck` + `lint` clean | Revert commit `4c88c42` (telegram plumbing: service, corrector, executor, reply-text + tests); bot-state payloads unchanged |

## Test Summary

- **Total tests written (new)**: 46 (12 matcher fold + 8 reserved/variant + 4 savings + 7 envelope/prompt + 15 funnel)
- **Total tests passing**: api 886/886 (37 files); dashboard 161/161 (23 files)
- **Layers used**: Unit (fold, savings, envelope, funnel), Integration (categories guards, telegram e2e)
- **Approval tests**: 1 (existing `entrenut` no-match fixture flipped to match per design, replaced by `entrenutsa`)
- **Pure functions created**: 2 (`foldSpanishPluralToken`, `normalizeForMatchTolerant`); `resolveReservedConcept` pure

## Deviations from Design

1. **Duplicate-variant scenario fixture**: the design/spec scenario "category 'gasto fijo' exists → create 'gastos fijos' rejected as duplicate" is unreachable in the new system — the reserved guard rejects `gastos fijos` first with the gasto-fijo redirect (spec-conformant: reserved redirect wins). The variant-rejection RED tests use the non-reserved pair `transporte`/`transportes` to pin the folded-availability behavior; the reserved-first order is pinned separately.
2. **Telegram money pin message**: the task text says `"cobré sueldos"`, but the arrival parser classifies `cobré` as EXPENSE (income keywords: cobro/sueldo/... — parser domain untouched by this change). The telegram-layer pin uses `cobro sueldos 1000` (INCOME keyword + plural note); the `matchNote` level pins `cobré sueldos` exactly as the spec scenario states (savings.service.test.ts).
3. **`gastos fijos` reserved-redirect wording**: keeps the attempted name in every branch of `reservedCategoryReply` (design wording preserved per concept, name added for user clarity).

## Issues Found

- None blocking. `seedCategories(["otro"])` in the telegram integration suite had to skip the now-reserved name (ensureOtro is the creation path) — a test-helper fix caused by the intended guard, not a product defect.

## Status

17/17 tasks complete. **Ready for verify.**