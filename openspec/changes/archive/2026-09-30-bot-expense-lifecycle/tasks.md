# Tasks: Bot Expense Lifecycle

## Review Workload Forecast

Estimated changed lines: 1200–1800 · 400-line budget risk: High · Chained PRs recommended: Yes

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Focused test prefix: `pnpm --filter @rita/api exec vitest run`

### Suggested Work Units

| Unit | Goal | PR | Focused test (args after prefix) | Runtime harness | Rollback |
|------|------|----|----------------------------------|-----------------|----------|
| 1 | Guards+provisorio+parser+templates | PR 1 | `matcher telegram.commands reply-text` | N/A — pure units | Revert 4 foundation files |
| 2 | Intents+executor+CR-5+goldens | PR 2 | `movement-lifecycle-executor bot-brain telegram.service.test` | N/A — fakes | Revert 3 core files + 7 goldens |
| 3 | Integration+cleanup script | PR 3 | `telegram.service.integration` | Fastify inject + test DB :5433 | Revert tests + script + 2 config lines |

## Phase 1: Foundation (guards, alias, parser, templates)

- [x] 1.1 RED `src/features/categories/matcher.test.ts`: `normalizeForMatchGuard` strips punctuation, collapses whitespace; `normalizeForMatch` byte-identical
- [x] 1.2 GREEN `src/features/categories/matcher.ts`: export `normalizeForMatchGuard`
- [x] 1.3 RED `src/features/telegram/telegram.service.test.ts`: "no."/"si."/"no," never auto-create (7 guard sites, 3 single-token rejects)
- [x] 1.4 GREEN `src/features/telegram/telegram.service.ts`: guard-normalize 3 guard sets + reject single-token guard words before `createCategory`
- [x] 1.5 RED reserved cases: "provisorio(s)", "gasto provisorio", "gastos provisorios" rejected; "un otro gasto" creatable
- [x] 1.6 GREEN `src/features/categories/reserved.ts`: `RESERVED_ALIASES` += `provisorio: "previsto"`; token-level alias check (guard-only aliases)
- [x] 1.7 RED `src/features/telegram/telegram.commands.test.ts`: `parseSetupBatchCommand` classifies delete/rename/registrar vs plain names
- [x] 1.8 GREEN `src/features/telegram/telegram.commands.ts`: export `DELETE_CATEGORY_RE` + `parseSetupBatchCommand`
- [x] 1.9 RED `src/features/telegram/reply-text.test.ts`: 9 templates (`markPaidReply`, `markPaidAlreadyReply`, `nothingPendingReply`, `nothingToDeleteReply`, `deletedMovementReply`, `markPaidAskReply`, `deleteAskReply`, `setupQuestionReply(existing)`, `setupBatchDoneReply`) + capabilities
- [x] 1.10 GREEN `src/features/telegram/reply-text.ts`: implement templates; `setupQuestionReply(existing)` lists categories
- [x] 1.11 GREEN `src/features/telegram/telegram.service.ts` setup: dynamic question, `handleSetupReply` batch via CategoryService, `setupBatchDoneReply`

## Phase 2: Core (intents, executor, routing, CR-5)

- [x] 2.1 RED `src/features/telegram/bot-brain.test.ts`: lifecycle envelopes decode; ~40 prompt `toContain` extensions
- [x] 2.2 GREEN `src/features/telegram/bot-brain.ts`: `BOT_INTENTS` += 2; `BotAction` += `marked_paid`/`deleted_movement`; `ExecutionResult` += `abandoned_dialog?`; prompts + 6 few-shots + addenda
- [x] 2.3 RED `src/features/telegram/movement-lifecycle-executor.test.ts`: windows (PENDING/all slice 10), cues, recency, tie→ask, 409, 404
- [x] 2.4 GREEN `src/features/telegram/movement-lifecycle-executor.ts`: `MovementLifecycleExecutor` (`markPaid`, `delete`, `markPaidById`, `deleteById`) + types
- [x] 2.5 RED `src/features/telegram/telegram.service.test.ts`: lifecycle routing; selection payload decode/dispatch; folded `resolveSuggestion` truth table; CR-5 single reply
- [x] 2.6 GREEN `src/features/telegram/telegram.service.ts`: `runMovementLifecycle`, selection pick, folded `resolveSuggestion`, CR-5 merged `Sender`

## Phase 3: Integration + Goldens

- [x] 3.1 RED `src/features/telegram/telegram.service.integration.test.ts`: "ya lo pagué" PENDING→PAID; "borralo" row gone; already-paid 409; ambiguity ask→"2"→paid; setup batch
- [x] 3.2 Run suite RED, then `vitest run -u`; regenerate `__goldens__` (7 change; 3 byte-identical: `dialog-awaiting-amount-confirmation-*`, `dialog-context-rendered.txt`)
- [x] 3.3 Review `git diff __goldens__`; accept only intended changes; investigate drift in unchanged files

## Phase 4: Data Cleanup + Docs

- [x] 4.1 Create `src/scripts/cleanup-phantom-data.ts`: pre/post-assert phantoms+junk+valid PENDING; timestamped backup; delete via services; exit 0 if clean
- [x] 4.2 Modify `apps/api/tsconfig.build.json` exclude += `src/scripts`; `.gitignore` += `apps/api/.cleanup-backups/`
- [x] 4.3 Precondition (not apply-blocking): confirm owner id; run against real DB `automatizacionrita`, not `_test`