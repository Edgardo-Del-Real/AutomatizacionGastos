# Tasks: Learning categories, bot confirmations, dashboard corrections

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

Estimated changed lines: ~3500–4000 (maintainer-accepted exception to the 400-line default guard; user explicitly chose single-pr + 4000 in session preflight)
Suggested split: single PR
Delivery strategy: single-pr

### Suggested Work Units (within the single PR; session-completable slices)

| Unit | Likely PR | Focused test command / runtime harness | Rollback boundary |
|------|-----------|----------------------------------------|-------------------|
| F0 contracts+Prisma | PR 1 | @rita/api test src/contracts (pure zod) | revert schema+migration |
| F1 categories slice | PR 1 | @rita/api test src/features/categories (pure units) | revert features/categories |
| F2 telegram | PR 1 | @rita/api test src/features/telegram (PG 5433 + buildOfflineBot) | revert BotState + telegram |
| F3 movements API | PR 1 | @rita/api test src/features/movements (app.inject + PG 5433) | revert route/service |
| F4 dashboard | PR 1 | @rita/dashboard test (jsdom) | revert dashboard files |

## Phase 1: Contracts & Data Model (F0)

- [x] 1.1 RED: updateMovementSchema tests in apps/api (contracts pkg has no runner) — optional fields, null clears, empty patch rejected, expenseSchema unchanged
- [x] 1.2 RED: category read schemas (ownerCategorySchema, categoryListSchema)
- [x] 1.3 GREEN: add updateMovementSchema + category schemas to packages/contracts/src/index.ts; pnpm --filter @rita/contracts build
- [x] 1.4 Modify schema.prisma: Category, CategoryKeyword, BotState (D5)
- [x] 1.5 Create additive migration <ts>_category_keyword_bot_state (down = drop)

## Phase 2: Categories Slice (F1)

- [x] 2.1 RED: matcher — accent-fold, word boundary ("cafe2go" no match), oldest-learned-wins (D4)
- [x] 2.2 GREEN: features/categories/matcher.ts (normalizeForMatch D3, firstSignificantWord)
- [x] 2.3 RED: repo — create, dup 422, rename tx cascade, idempotent keyword, ensureOtro, cross-owner
- [x] 2.4 GREEN: repository.ts + service.ts (name = canonical identity D1; dup 422 D2; assertOwnerCategory)
- [x] 2.5 GREEN: telegram.commands.ts parseCommand (5 commands, accents/case, null fall-through)

## Phase 3: Telegram (F2)

- [x] 3.1 RED: state machine — idle→awaiting_setup, setup reply creates + "otro" (D7), correction loop, restart survival
- [x] 3.2 RED: ambiguity UNCHANGED — "8000" = registration; category "500" beats amount (D6); multi-word name = ANSWER; "$8000 super" during correction = registration
- [x] 3.3 RED (D9 BUNDLE): offline middleware records {method,payload} instead of throwing — same cycle as reply tests
- [x] 3.4 GREEN: reply-text.ts + es-AR ARS formatter; notes truncated ~500 chars
- [x] 3.5 GREEN: telegram.service.ts state machine + reply port + commands + category on create, AND app.ts manual-DI rewiring (5 collaborators) in same task
- [x] 3.6 GREEN (D9 BUNDLE): telegram.bot.ts reply → ctx.reply; buildOfflineBot throw→record
- [x] 3.7 Integration (PG 5433 + offline bot): setup, correction (answer/auto-create/amount-is-registration), learned auto-match, reply failure logged

## Phase 4: Movements API (F3)

- [x] 4.1 RED: routes — PATCH null clears/absent unchanged/422 invalid category/404s; DELETE both types/404; GET categories; DELETE /expenses/:id untouched
- [x] 4.2 GREEN: repo updateById/deleteById (no type filter); service updateMovement (category vs owner set D12)/deleteMovement
- [x] 4.3 GREEN: route PATCH/DELETE /movements/:id (x-owner-id) + GET /movements/categories; wire categoryService

## Phase 5: Dashboard (F4)

- [x] 5.1 RED: api client — request(method,body,headers), 204 short-circuit, 3 fns
- [x] 5.2 RED: edit form (dropdown, diff-only patch, clear→null, invalid blocked), ConfirmDialog, refreshKey refetch
- [x] 5.3 GREEN: infra/api.ts, useMovementMutations.ts, useCategories.ts
- [x] 5.4 GREEN: MovementEditForm, ConfirmDialog, MovementList row actions, App refreshKey (D11), refreshToken deps
- [x] 5.5 Full suite green: pnpm --filter @rita/api test && pnpm --filter @rita/dashboard test