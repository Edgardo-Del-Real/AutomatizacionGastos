# Tasks: Bot Hybrid UX v2 — Menu-First Deterministic Capture

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~8,000–10,000 authored (tests ~5,500; prod ~3,600) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Estimate exceeds the 8,000-line session budget → size:exception required before apply. Threat matrix: all N/A.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Pure units: `captureParse`, `legacyPrefixKind`, command trim, `BOT_STATES`, `reply-text` v2 | PR 1 | `pnpm --filter @rita/api test telegram.parser.test.ts telegram.commands.test.ts reply-text.test.ts` | N/A — pure | Revert parser/commands/reply-text |
| 2 | Brain shrink: intents, envelope, prompts, goldens | PR 2 | `pnpm --filter @rita/api test bot-brain.test.ts` | `recordApiCalls` harness | Revert `bot-brain.ts` + goldens |
| 3 | State machine + capture chain | PR 3 | `pnpm --filter @rita/api test telegram.service.test.ts` | `app.inject` + Prisma | Revert `handleUpdate`/preview |
| 4 | Money flows: `registerCapture` + savings split | PR 4 | `pnpm --filter @rita/api test telegram.service.savings.test.ts` | `app.inject` + test DB | Revert `registerCapture` |
| 5 | Idle routing: `routeIdleMessage` | PR 5 | `pnpm --filter @rita/api test telegram.service.test.ts` | `app.inject`, no `GROQ_API_KEY` | Revert `routeIdleMessage` |
| 6 | Sub-menus: `am:*`/`ac:*`/`rep:*` | PR 6 | `pnpm --filter @rita/api test telegram.service.integration.test.ts` | `app.inject` + test DB | Revert sub-menu handlers |
| 7 | Command surface + `ayuda` | PR 7 | `pnpm --filter @rita/api test telegram.commands.test.ts telegram.bot.test.ts` | `app.inject` | Revert `handleCommand` |
| 8 | Regression: suite + tsc + lint + goldens | PR 8 | `pnpm --filter @rita/api test && typecheck && lint` | integration pass | n/a — whole change |

## Phase 1: Pure Units

- [x] 1.1 RED: `captureParse` null/no-category tests (`telegram.parser.test.ts`)
- [x] 1.2 GREEN: `captureParse` + `legacyPrefixKind`; delete prefix parsers (`telegram.parser.ts`)
- [x] 1.3 Command types trim + `parseLegacyCategoryCrud` + tests (`telegram.commands.ts`)
- [x] 1.4 `BOT_STATES` → 8 v2 values (`bot-state.repository.ts`)
- [x] 1.5 v2 `reply-text.ts` templates add/delete + tests

## Phase 2: Brain Shrink

- [x] 2.1 RED: envelope rejects legacy intents/keys (`bot-brain.test.ts`)
- [x] 2.2 Trim `BOT_INTENTS`→8; envelope schema; `z.never()` rejects (`bot-brain.ts`)
- [x] 2.3 Rewrite prompts/few-shots; delete dialog addenda
- [x] 2.4 Regenerate 3 goldens; delete 7 dialog goldens (`__goldens__/`)

## Phase 3: State Machine + Capture Chain

- [x] 3.1 RED: transitions, supersede, recovery tests (`telegram.service.test.ts`)
- [x] 3.2 `handleUpdate` v2; `startCapture` + setup gate
- [x] 3.3 Capture re-prompt; `enterPreview`/`renderPreview` (5 cats + ➕ + `cp:`)
- [x] 3.4 Preview callbacks: gated save, `pv:catnew`, `pv:edit`
- [x] 3.5 `normalizeState` corrupt/removed-state recovery

## Phase 4: Money Flows

- [x] 4.1 RED: type→movement mapping tests
- [x] 4.2 `registerCapture` mapping table
- [x] 4.3 `registerIncomeSplit` INDIVIDUAL + menu; COMPARTIDO never splits
- [x] 4.4 `handleSetupReply` drop `ensureOtro`; `sendMenu` 8 buttons

## Phase 5: Idle Routing

- [x] 5.1 RED: zero-LLM — pre-checks never call `interpret`
- [x] 5.2 `routeIdleMessage` pre-checks: setup gate, prefixes, capture-shaped, CRUD
- [x] 5.3 Brain branch: query/greeting/help/off_topic + menu tail

## Phase 6: Sub-Menus

- [x] 6.1 RED: sub-menu chain tests (`telegram.service.integration.test.ts`)
- [x] 6.2 `am:*` delete reuse; `pendingWindow`; `correctionWindow`
- [x] 6.3 `ac:*` admin chains + stateless confirm
- [x] 6.4 `rep:*` 5 queries; `cp:` pagination

## Phase 7: Command Surface

- [x] 7.1 RED: command trim/supersede/ayuda tests
- [x] 7.2 `handleCommand` trim; menu/start supersede; CRUD cases deleted
- [x] 7.3 `ayudaReply` v2: 8 buttons + examples, offline-safe

## Phase 8: Regression

- [x] 8.1 `pnpm --filter @rita/api test` green
- [x] 8.2 typecheck + lint pass
- [x] 8.3 Goldens byte-match; delete `category-executor.ts`/`mil-stance.ts` + tests

## Task Decisions

- Help reply → static help + menu tail (universal rule, 5.3); exact wording = apply-phase detail.