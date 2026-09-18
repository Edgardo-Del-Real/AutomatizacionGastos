# Apply Progress: Bot Conversation Controller

## Status

**Result: success** — all 15 tasks complete (4 phases). Branch `feat/bot-conversation-controller` (from `dev` @ 6143797) pushed. No PR, no merge.

- Mode: **Strict TDD** (config `testing.strict_tdd: true`)
- Workload: single PR (Chained PRs recommended: No; decision needed: No)
- Commits: `e3d8e4f` (Phase 1 brain contract), `680f355` (Phase 2 movement corrector), `bca4be1` (Phase 3 dialog controller + verification)

## Completed Tasks

All tasks in `tasks.md` are marked `[x]` (Phases 1–4, tasks 1.1–4.4). Re-read and confirmed before return.

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `apps/api/src/features/telegram/bot-brain.ts` | Modified | `InterpretContext` union (state + pending + openQuestion); envelope + `dialog_action`/`then_reassign`; `BotAction += asked_movement\|created_reassigned`; `DIALOG_INTERPRET_ADDENDUM` + `DIALOG_FEW_SHOTS` per state; `renderDialogContext`; `interpret(message, context?)`; prompt extensions |
| `apps/api/src/features/telegram/bot-brain.test.ts` | Modified | Schema cases (dialog_action valid/default/invalid, then_reassign, mixed-intent), context rendering, prompt contracts, goldens (regenerated + 5 new dialog fixtures) |
| `apps/api/src/features/telegram/__goldens__/*` | Modified | `interpret-system-prompt.txt`, `reply-system-prompt.txt` regenerated; new `dialog-awaiting-category-addendum.txt`, `dialog-awaiting-amount-confirmation-addendum.txt`, `dialog-awaiting-category-few-shots.json`, `dialog-awaiting-amount-confirmation-few-shots.json`, `dialog-context-rendered.txt` |
| `apps/api/src/features/telegram/movement-corrector.ts` | Created | `MovementCorrector.correct()`: D7 target resolve (exact else auto-create, duplicate race → existing), 10-movement window, weighted scoring (8/4/2/2/1), reassign \| ask(ambiguous/no_reference) \| no_match \| missing; never touches bot state |
| `apps/api/src/features/telegram/movement-corrector.test.ts` | Created | 15 unit tests: unique amount, note exact/partial disambiguation, same-bucket tie asks, recency-bucket tie-break, full tie asks, empty window, no-match, no-reference (whole window), 10-movement window slice, auto-create, duplicate race, NotFoundError → missing |
| `apps/api/src/features/telegram/telegram.service.ts` | Modified | Brain-routed `handleDialogMessage` (D1 fallback `d6AwaitingCategory`/`d6AwaitingAmountConfirmation` verbatim); `resolveDialog` + phantom guard (payload-only, never `envelope.amount`); shared `routeEnvelopeIntent` (pending-safe queries/CRUD, single-interpret register); `then_reassign` chain; `runMovementCorrection`; `handleMovementSelection` (deterministic pick); `movementSelectionPayloadSchema` |
| `apps/api/src/features/telegram/telegram.service.test.ts` | Modified | 26 new tests (dialog routing, phantom cases, selection pick/abandon, then_reassign, correct_category flow); 2 existing dialog tests rewritten for brain-routed behavior |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Modified | 4 new integration loops: register→otro→query→resolve, ambiguous correction→pick + restart survival, then_reassign create+reassign, unique free-form reassign |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modified | `BOT_STATES += "awaiting_movement_selection"` |
| `apps/api/src/features/telegram/reply-text.ts` | Modified | 7 new templates + `movementCandidatesList` helper + `created_reassigned` branch in `categoryCommandReplyTemplate` |
| `apps/api/src/features/telegram/reply-text.test.ts` | Modified | 10 new template tests (table style) |

`app.ts` unchanged. `env.ts` unchanged. No new dependencies. Real Groq endpoint never hit (fake `fetchImpl` / stubbed brain everywhere).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `bot-brain.test.ts` | Unit | ✅ 110/110 | ✅ Written | ✅ Passed | ✅ 7 cases | ✅ Clean |
| 1.2 | `bot-brain.test.ts` | Unit | ✅ 110/110 | ✅ Written | ✅ Passed | ✅ 4 cases | ✅ Clean |
| 1.3 | `bot-brain.test.ts` | Unit | ✅ 110/110 | ✅ Written (24 fail) | ✅ 134/134 | ✅ schema+context+goldens | ✅ Clean |
| 2.1 | `movement-corrector.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed (after scoring fix) | ✅ 15 cases | ✅ Clean |
| 2.2 | `movement-corrector.test.ts` | Unit | N/A (new) | ✅ Written | ✅ 15/15 | ✅ 15 cases | ✅ Clean |
| 3.1 | `telegram.service.test.ts` | Unit | ✅ 81/81 | ✅ (existing D6 tests as approval) | ✅ Passed | ✅ D6 fallback verbatim | ✅ Clean |
| 3.2 | `telegram.service.test.ts` | Unit | ✅ 81/81 | ✅ Written | ✅ 107/107 | ✅ 6 routing cases | ✅ Clean |
| 3.3 | `bot-state.repository.ts` | Unit | ✅ 81/81 | ✅ (state value via service tests) | ✅ Passed | ➖ Single value | ➖ None needed |
| 3.4 | `telegram.service.test.ts` | Unit | ✅ 81/81 | ✅ Written | ✅ 107/107 | ✅ 6 selection cases | ✅ Clean |
| 3.5 | `telegram.service.test.ts` | Unit | ✅ 81/81 | ✅ Written | ✅ 107/107 | ✅ 5 pending-safe cases | ✅ Clean |
| 3.6 | `telegram.service.test.ts` | Unit | ✅ 81/81 | ✅ Written | ✅ 107/107 | ✅ 3 cases | ✅ Clean |
| 3.7 | `reply-text.test.ts` | Unit | ✅ 39/39 | ✅ Written | ✅ 48/48 | ✅ 10 cases | ✅ Clean |
| 4.1 | `reply-text.test.ts` | Unit | ✅ 39/39 | ✅ Written | ✅ 48/48 | ✅ 10 cases | ✅ Clean |
| 4.2 | `telegram.service.test.ts` | Unit | ✅ 81/81 | ✅ Written | ✅ 107/107 | ✅ 26 cases | ✅ Clean |
| 4.3 | `telegram.service.integration.test.ts` | Integration | ✅ 30/30 | ✅ Written | ✅ 34/34 | ✅ 4 loops | ✅ Clean |
| 4.4 | full suite | All | — | — | ✅ 557/557 | — | ✅ typecheck+lint |

### Test Summary

- **Total tests written (net new)**: 26 service + 15 corrector + 10 reply-text + 24 bot-brain schema/context/golden + 4 integration + 2 rewritten ≈ 81
- **Total suite**: 557 passed / 0 failed (22 files)
- **Layers used**: Unit (523), Integration (34)
- **Approval tests** (refactoring): 2 (D6 dialog tests rewritten for brain-routed behavior — old assertions captured the pre-change behavior, updated to the new spec-pinned contract)
- **Pure functions created**: `score` (exported), `movementCandidatesList`, `pickMovementSelection`, `renderDialogContext`

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm vitest run src/features/telegram` → 401 passed (11 files); full `pnpm --filter @rita/api test` → 557 passed, 0 failed |
| Runtime harness command/scenario and exact result | `pnpm vitest run src/features/telegram/telegram.service.integration.test.ts` → 34 passed against Postgres :5433 / `automatizacionrita_test` (real Prisma, stubbed brain); covers register→otro→query→resolve, ambiguous→pick+restart, then_reassign, unique reassign |
| Rollback boundary | Revert branch to `dev` (6143797): all dialog behavior returns to today's D6 rules; unset `GROQ_API_KEY` → dialogs fall back to D6 verbatim; stale `awaiting_movement_selection` rows degrade via corrupt/non-answer path |

## Deviations from Design

1. **Recency is a tie-breaker, not a standalone matcher** — the design's scoring table lists recency (2/1) as always-scored; the spec ("most recent wins ties") plus the pinned "reference matches nothing → no_match" scenario require recency points to apply ONLY when the candidate already has evidence (amount/note match). Otherwise a reference matching nothing would reassign the most recent movement via recency alone. Implemented as: `score = evidence + (evidence > 0 ? recency : 0)`.
2. **`CorrectionResult` gained `{ status: "missing" }`** — the design's union (reassigned/ask/no_match) cannot surface the pinned "Missing movement degrades" scenario (clear "movement no longer exists" reply, nothing created). `NotFoundError`/`ValidationFailedError` from `updateMovement` map to `missing` → `movementMissingReply()`.
3. **`correct()` takes an optional `now: Date` (default `new Date()`)** — injectable clock so recency buckets are deterministic in tests. Additive; no behavior change.
4. **Resolve with `category: null` in `awaiting_category` → `questionDroppedReply()`** — design's resolveDialog one-liner said "null/multi-word non-match → categoryNotFoundReply"; phantom guard rule 3 (bare "si" resolve → dropped reply, NOT reprocessed) and the Dialog Action Contract ("resolve must not invent categories") win for the null case. Multi-word non-match still lists categories + stays open (D6 verbatim).
5. **Corrupt amount-confirmation payload → D6 abandon path, no brain call** — `buildInterpretContext` returns null on a non-decodable payload, so the message never reaches the brain and today's abandon-and-reprocess rules own it (no context can be built; calling the brain with garbage is worse).
6. **`runMovementCorrection` dropped the unused `dialog` param** — the ask path supersedes any open dialog by overwriting bot state; the param was never read (lint).
7. **`ConversationEnvelope.dialog_action`/`then_reassign` typed optional** — the zod schema always defaults them (parsed envelopes carry both); optional typing avoids ~45 mock churn in tests while treating `undefined` as null/false everywhere (D1/D6 permissive semantics).
8. **Empty window + empty reference → `no_match`** — the design's outcome table orders empty-reference → ask first, but an ask with zero candidates would persist a schema-invalid payload; the spec's "Empty window" scenario requires the no-match reply.

## Issues Found

- **Pre-existing infra flake (not introduced by this change)**: in one baseline full-suite run, `expenses.route.test.ts` failed a `beforeAll` 10s hook timeout on `prisma migrate deploy` (runs the same migrate as the telegram integration suite in one sequential worker). It passes in isolation (17/17) and passed in the final full run (557/557). Not touched by this change.
- The two "interpret never called for dialog answers" legacy tests were rewritten — they asserted the OLD (pre-change) contract; the spec pins dialog answers routing through the brain.

## Remaining Tasks

None — all 15 tasks complete.

## Workload / PR Boundary

- Mode: single PR (`feat/bot-conversation-controller`), pushed, no PR/merge per instructions
- Estimated review budget impact: ~2,300 changed lines (authored + goldens)

**Ready for verify.**