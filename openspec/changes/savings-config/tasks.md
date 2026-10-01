# Tasks: Savings Configuration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,300–1,800 |
| 400-line budget risk | High (default guard) |
| Session budget 8000 | Under — no exception |
| Chained PRs recommended | No |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: High

### Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|------|------|----------------------|-----------------|-------------------|
| 1 | Parser/service/replies: types, percent input, 11 replies, rule fns | `pnpm --filter @rita/api test commands reply-text savings.service` | N/A unit layer | Revert commit; unused later |
| 2 | Repo `delete` P2025→null; split call-shape (net/savings categories) | `pnpm --filter @rita/api test savings.repository.integration expenses.split.integration` | N/A DB tests | Revert repo/signature |
| 3 | Optional `savings` payload; legacy decodes; default `{kind:"none"}` | `pnpm --filter @rita/api test telegram.service.test` | N/A schema units | Revert schema; previews decode |
| 4 | `sv:*` callbacks, confirmation, manual-wins | `pnpm --filter @rita/api test telegram.service.savings` | N/A unit flows | Revert `sv:*`/keyboard |
| 5 | `sa:*` sub-menu, `svdel` gate, state-aware close, 3 states | `pnpm --filter @rita/api test telegram.service.test` | N/A unit flows | Revert `sa:*`/states |
| 6 | BOT_COMMANDS +3, ayuda text + 💰 Ahorro | `pnpm --filter @rita/api test telegram.bot` | N/A startup unit | Revert bot.ts/help |
| 7 | e2e chains + blast radius | `pnpm --filter @rita/api test telegram.service.integration telegram.service.household.integration` | Integration (test DB) | Whole-change revert |

## Phase 1: Parser + Service

- [x] 1.1 RED `telegram.commands.test.ts`: `listar ahorros`/`borrar ahorro:`/percent input
- [x] 1.2 GREEN `telegram.commands.ts`: types/regexes/parser
- [x] 1.3 RED `savings.service.test.ts`: `listRules`/`deleteRule`
- [x] 1.4 GREEN `savings.service.ts`: both fns
- [x] 1.5 RED `reply-text.test.ts`: 11 replies, split reply(+netCategory)
- [x] 1.6 GREEN `reply-text.ts`: `SavingsChoice` + replies

## Phase 2: Repository + Split Categories

- [x] 2.1 RED `savings.repository.integration.test.ts`: delete scoped/P2025
- [x] 2.2 GREEN `savings.repository.ts`: `delete` P2025→null
- [x] 2.3 RED `expenses.split.integration.test.ts`: categories + atomicity
- [x] 2.4 GREEN `expenses.repository.ts`/`expenses.service.ts`: call-shape

## Phase 3: Payload Schema

- [x] 3.1 RED `telegram.service.test.ts`: legacy decodes + `savePreview` default `{kind:"none"}`
- [x] 3.2 GREEN `telegram.service.ts`: `savings` union + wiring

## Phase 4: Manual Choice `sv:*`

- [x] 4.1 RED `telegram.service.savings.test.ts`: `sv:*` gates, INGRESO-only, manual-wins
- [x] 4.2 GREEN `telegram.service.ts`: `sv` handlers, confirmation render
- [x] 4.3 Update `:177/:198`/`:179-187` asserts (default stays)

## Phase 5: Savings Admin `sa:*` + States

- [ ] 5.1 RED `telegram.service.test.ts`: `sa:*`/`svdel:*`, stale pick, close
- [ ] 5.2 GREEN `telegram.service.ts`+`bot-state.repository.ts`: handlers + 3 states

## Phase 6: Commands + Help

- [ ] 6.1 RED `telegram.bot.test.ts:428`: four→seven; ayuda 💰 Ahorro
- [ ] 6.2 GREEN `telegram.bot.ts` +3; ayuda + `[💰 Ahorro]`→`sa:menu`

## Phase 7: Integration + Blast Radius

- [ ] 7.1 RED `telegram.service.integration.test.ts`: row, Otro→150/850, No apartar, net category, corrupt recovery
- [ ] 7.2 RED household `pv:save` `:148/:210/:244`: legacy + SHARED
- [ ] 7.3 GREEN full suite; `:809` unchanged; parse sites updated
- [ ] 7.4 Verify test + typecheck + lint