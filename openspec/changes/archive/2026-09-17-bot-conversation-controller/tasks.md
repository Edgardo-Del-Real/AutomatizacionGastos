# Tasks: Bot Conversation Controller

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,400 authored (goldens excluded) |
| 5000-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
5000-line budget risk: Low

## Phase 1: Brain Contract & Prompts

- [x] 1.1 `bot-brain.ts` — add `InterpretContext` union, `dialog_action`/`then_reassign` to `conversationEnvelopeSchema`, `BotAction += asked_movement|created_reassigned`, `interpret(message, context?)` with `renderDialogContext`
- [x] 1.2 `bot-brain.ts` — extend `INTERPRET_SYSTEM_PROMPT` (dialog_action semantics, `correct_category` reference extraction, then_reassign) + `REPLY_SYSTEM_PROMPT`; add per-state `DIALOG_INTERPRET_ADDENDUM` + `DIALOG_FEW_SHOTS`
- [x] 1.3 `bot-brain.test.ts` (RED→GREEN) — schema cases (dialog_action valid/default/invalid→null, then_reassign, mixed-intent), context rendering, bare-affirmation never resolve; regenerate `__goldens__/*` + new dialog addendum/few-shots/context fixtures

## Phase 2: Movement Corrector

- [x] 2.1 Create `movement-corrector.ts` — `MovementCorrector.correct()`: D7 target resolve (exact else auto-createCategory), 10-movement window, weighted scoring (8/4/2/2/1), reassign | ask(no_reference/ambiguous) | no_match; never touches bot state
- [x] 2.2 Create `movement-corrector.test.ts` (RED→GREEN) — unique amount, note disambiguation, same-bucket tie asks, recency tie-break, empty window, no reference, auto-create, `updateMovement` NotFoundError path

## Phase 3: Dialog Controller (telegram.service.ts)

- [x] 3.1 Extract D6 fallback — `d6AwaitingCategory`/`d6AwaitingAmountConfirmation` from today's handlers, bodies verbatim (D1)
- [x] 3.2 `handleDialogMessage` — interpret with `buildInterpretContext(state)`; route: null/absent/abandon → D6; resolve → `resolveDialog` (phantom guard: payload-only, never `envelope.amount`); null → `routeEnvelopeIntent(dialog)`
- [x] 3.3 `bot-state.repository.ts` — `BOT_STATES += "awaiting_movement_selection"`
- [x] 3.4 `handleMovementSelection` — decode `movementSelectionPayloadSchema` from `pendingNote`; pick by number 1..N / note / unique amount; corrupt or non-answer → clear + dropped/abandoned reply + `handleRegistration`
- [x] 3.5 `routeEnvelopeIntent` — pending-safe queries/CRUD (no consumption); `correct_category` → `runMovementCorrection`; dialog `register_expense` → abandon reply + `executeRegistration` reusing envelope (single interpret)
- [x] 3.6 `then_reassign` — `create_category && ok && flag && dialog?.pendingMovementId` → `updateMovement` + one `categoryCreatedReassignedReply` (failure → `categoryCreatedReply` + `movementMissingReply`); no pending → ignored
- [x] 3.7 `reply-text.ts` — `movementAmbiguousReply`, `movementNoReferenceReply`, `movementNoMatchReply`, `movementSelectionAbandonedReply`, `questionDroppedReply`, `movementCorrectionDoneReply`, `categoryCreatedReassignedReply` + `created_reassigned` branch

## Phase 4: Verification

- [x] 4.1 `reply-text.test.ts` — template table tests (RED→GREEN)
- [x] 4.2 `telegram.service.test.ts` — dialog routing per action; queries/CRUD pending-intact; mixed create+reassign; register-during-dialog single interpret (mock called once); phantom (bare "si", missing pending, corrupt payload); selection pick/abandon; D6 fallback verbatim
- [x] 4.3 `telegram.service.integration.test.ts` — register→otro→query→resolve; ambiguous correction→pick; selection payload restart survival (app.inject, test DB)
- [x] 4.4 Full suite — `pnpm --filter @rita/api test` green; `pnpm --filter @rita/api typecheck` + lint clean