# Apply Progress: Conversational Thread — Registration Detail Collection

**Change**: conversational-thread
**Mode**: Strict TDD
**Apply batch**: 1 (full change — no prior apply-progress existed)
**Status**: All 28 tasks complete (Phases 1–5)
**Date**: 2026-09-29

## Workload Decision

- Delivery strategy: `single-pr` with **`size:exception` APPROVED by the maintainer** (estimated 2800–3400 authored lines; final authored ~1847 + test deltas, excluding generated goldens). No chained PRs.

## Commits Created (5 work units, single PR)

| # | Commit | Work unit | Files |
|---|--------|-----------|-------|
| 1 | `0dd64f1` | State constant + payload schema + templates | bot-state.repository.ts, telegram.service.ts (constant/schema/decoder), reply-text.ts + tests, tasks.md |
| 2 | `a8e64b4` | E1/E2 entries + routing + dialog controller | telegram.service.ts (+~1200 incl. tests), bot-brain.ts (types), reply-text.ts |
| 3 | `60cd8c5` | Brain: greeting + asked_registration + teaching | bot-brain.ts + tests, telegram.service.ts (greeting routing), goldens regenerated |
| 4 | `68798a2` | Goldens + integration + full suite | telegram.service.integration.test.ts (+201), telegram.service.ts |
| 5 | `f63f6b5` | Cleanup: tasks.md checkboxes | tasks.md |

## TDD Cycle Evidence (Strict TDD)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | reply-text.test.ts | Unit | ✅ 63/63 | ✅ Written | ✅ Passed | ✅ 8 cases (5 templates, 3 triangulations) | ➖ None needed |
| 1.2 | reply-text.ts (via 1.1) | Unit | ✅ RED above | ✅ 8 failing | ✅ 71/71 | ✅ covered above | ➖ None needed |
| 1.3 | telegram.service.test.ts | Unit | ✅ 211/211 | ✅ Written | ✅ Passed | ✅ 6 cases (full/partial/defaults/invalid) | ➖ None needed |
| 1.4 | telegram.service.ts (via 1.3) | Unit | ✅ RED above | ✅ 7 failing | ✅ 211/211 | ✅ covered above | ➖ None needed |
| 1.5 | bot-state.repository.ts (via 1.3) | Unit | ✅ RED above | ✅ BOT_STATES missing | ✅ 211/211 | ➖ Single (constant list) | ➖ None needed |
| 2.1 | telegram.service.test.ts | Unit | ✅ 211/211 | ✅ Written | ✅ Passed | ✅ 2 cases (plain + planned) | ➖ None needed |
| 2.2 | telegram.service.ts (E1) | Unit | ✅ RED above | ✅ 2 failing | ✅ 142/142 | ✅ covered above | ✅ Extract payload type |
| 2.3 | telegram.service.test.ts | Unit | ✅ 148/148 | ✅ Written | ✅ Passed | ✅ 4 cases (E2 + 2 prefixes + bare noun) | ➖ None needed |
| 2.4 | telegram.service.ts (E2 + D8) | Unit | ✅ RED above | ✅ 3 failing | ✅ 148/148 | ✅ covered above | ✅ "otro" guard in E2 |
| 2.5 | telegram.service.test.ts | Unit | ✅ 148/148 | ✅ Written | ✅ Passed | ✅ 2 cases (route + corrupt) | ➖ None needed |
| 2.6 | telegram.service.ts (routing) | Unit | ✅ RED above | ✅ 2 failing | ✅ 148/148 | ✅ covered above | ✅ shared dispatch tail |
| 2.7 | telegram.service.test.ts | Unit | ✅ 148/148 | ✅ Written | ✅ Passed | ✅ 3 cases (complete/collect/phantom) | ➖ None needed |
| 2.8 | telegram.service.ts (amount path) | Unit | ✅ RED above | ✅ 3 failing | ✅ 151/151 | ✅ covered above | ✅ brain-rescue extraction |
| 2.9 | telegram.service.test.ts | Unit | ✅ 151/151 | ✅ Written | ✅ Passed | ✅ 5 cases (exact/folded/create/reserved/multi) | ➖ None needed |
| 2.10 | telegram.service.ts (cascade) | Unit | ✅ RED above | ✅ 5 failing | ✅ 156/156 | ✅ covered above | ✅ shared category tail |
| 2.11 | telegram.service.test.ts | Unit | ✅ 156/156 | ✅ Written | ✅ Passed | ✅ 8 cases (T6×2, T7×2, T8, T10, T11, intercept) | ➖ None needed |
| 2.12 | telegram.service.ts (abandon/intercept/arm) | Unit | ✅ RED above | ✅ 4 failing | ✅ 164/164 | ✅ covered above | ✅ affirmation intercept split |
| 3.1 | bot-brain.test.ts | Unit | ✅ 173/173 | ✅ Written | ✅ Passed | ✅ 3 cases | ➖ None needed |
| 3.2 | bot-brain.ts (intents/actions) | Unit | ✅ RED above | ✅ 1 failing | ✅ 165/165 | ✅ covered above | ➖ None needed |
| 3.3 | bot-brain.ts (addendum/few-shots/context) | Unit | ✅ typecheck gate | ✅ TS2741 | ✅ 173/173 | ➖ Single per spec | ➖ None needed |
| 3.4 | bot-brain.ts (prompts) | Unit | ✅ 173/173 | ✅ Written | ✅ Passed | ✅ 6 cases | ➖ None needed |
| 3.5 | telegram.service.test.ts | Unit | ✅ 172/172 | ✅ Written | ✅ Passed | ✅ 4 cases (idle×2, fixed, dialog) | ✅ off_topic fixtures reworded |
| 3.6 | telegram.service.ts (greeting case) | Unit | ✅ RED above | ✅ 3 failing | ✅ 172/172 | ✅ covered above | ➖ None needed |
| 4.1 | bot-brain.test.ts (goldens) | Unit | ✅ 173/173 | ✅ 3 mismatch + 2 new | ✅ `-u` → 173/173 | ✅ 5 files | ➖ None needed |
| 4.2 | full suite locked proofs | Integration | ✅ 902 baseline | N/A | ✅ 966/966 | ✅ D6 byte-identical check | ➖ None needed |
| 4.3 | telegram.service.integration.test.ts | Integration | ✅ 38/38 | ✅ 3 failing | ✅ 43/43 | ✅ 5 cases (journey/planned/shared/restart/corrupt) | ✅ test seeds corrected |
| 4.4 | full suite + typecheck + lint | All | ✅ 966/966 | N/A | ✅ all green | N/A | ✅ lint fix (unused param) |
| 5.1 | tasks.md | Doc | N/A | N/A | ✅ 28/28 `[x]` | N/A | ➖ None needed |

### Test Summary
- **Total tests written**: +66 (8 reply-text, 6 schema, 38 service collection, 4 dialog-controller, 6 greeting, 5 brain, 5 integration e2e)
- **Total tests passing**: 966/966 full suite (37 files)
- **Layers used**: Unit (bot-brain/reply-text/telegram.service), Integration (telegram.service.integration)
- **Approval tests** (refactoring): 2 — the E2 category-unresolved deltas on previously-locked brain-orchestration tests (updated WITH the spec delta, not silently)
- **Pure functions created**: 5 reply templates; decodeCollectPayload decoder; COLLECT_ABANDON_ANSWERS set

## Work Unit Evidence

| Unit | Focused test command + result | Runtime harness + result | Rollback boundary |
|------|------------------------------|--------------------------|-------------------|
| 1 | `pnpm --filter @rita/api exec vitest run reply-text.test.ts telegram.service.test.ts` → 211/211 | N/A — pure schema/template/constant units; no runtime boundary exists | Revert `bot-state.repository.ts`, schema block in `telegram.service.ts`, `reply-text.ts` templates |
| 2 | `pnpm --filter @rita/api exec vitest run telegram.service.test.ts` → 172/172 | N/A — unit-proven dialog routing; integration covered in unit 5 | Revert E1/E2 entries, `handleUpdate` routing, `d6DialogFallback`/`resolveDialog` dispatch, `buildInterpretContext`, resolver stubs |
| 3 | `pnpm --filter @rita/api exec vitest run telegram.service.test.ts` → 172/172 | N/A — unit-proven resolvers | Revert `resolveRegistrationAmount`/`resolveRegistrationCategory`/`awaitingRegistrationAnswer` in `telegram.service.ts` |
| 4 | `pnpm --filter @rita/api exec vitest run bot-brain.test.ts` → 173/173 (goldens `-u` in-cycle) | N/A — unit-proven prompt/envelope contracts | Revert `bot-brain.ts` teaching + greeting/abandon-arm edits + regenerated goldens |
| 5 | `pnpm --filter @rita/api exec vitest run telegram.service.integration.test.ts` → 43/43; full `pnpm --filter @rita/api test` → 966/966 | `docker compose` rita-postgres on localhost:5433 healthy; integration suite ran against `automatizacionrita_test` | Restore goldens + locked-test deltas from git (commits 0dd64f1..f63f6b5) |

## Hard Constraint Verifications

1. **Non-conflation**: The locked `awaiting_category` D6 suite (telegram.service.test.ts "TelegramService ambiguity rules (awaiting_category, D6)") is **byte-identical** to the pre-change version (verified via git hash comparison) and passes unchanged in the full suite. `awaiting_registration` has its own constant, payload schema, resolvers, and brain context — no reuse of `pendingMovementId` semantics.
2. **State machine is the transition authority**: entry/persist/consume/resolve are deterministic; the LLM only classifies (`dialog_action`/intent). The resolvers act ONLY on the persisted payload (phantom guard: message-derived value, `envelope.amount` positive-only rescue; wrong-field/empty → T9 re-ask, never fabricate, never reprocess).
3. **Greeting reversal is deliberate**: the locked "never general chat" tests at :1675/1693 were updated WITH the spec delta (fixtures moved to genuinely off-topic text) and new greeting-routing tests added; the `off_topic` redirect-only contract (bot-brain.test.ts :1126) stays green plus a sibling pin proving greeting is a separate intent.
4. **No Prisma migration**: `pendingNote` JSON + zod (`registrationCollectPayloadSchema`) is the version contract; corrupt payloads recover via T10.
5. **Deterministic-only mode**: collection fires only on brain envelopes or deterministic `previsto:`/`compartido:` prefixes without amount; a no-brain bare noun keeps `helpReply` unchanged.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/api/src/features/telegram/telegram.service.ts` | Modified | `AWAITING_REGISTRATION` constant; `registrationCollectPayloadSchema` + `decodeCollectPayload`; E1/E2 entries in `executeRegistration`; deterministic prefix entry; `handleUpdate` routing; `buildInterpretContext` case; `d6DialogFallback`/`resolveDialog` dispatch; `d6AwaitingRegistration`/`resolveAwaitingRegistration` + shared amount/category resolvers; affirmation intercept; `routeEnvelopeIntent` greeting case + collect abandon arm |
| `apps/api/src/features/telegram/bot-brain.ts` | Modified | `"greeting"` intent; `"asked_registration"` action; `asked_field` on `ExecutionResult`; `InterpretContext` union member; `DIALOG_INTERPRET_ADDENDUM`/`DIALOG_FEW_SHOTS`.awaiting_registration; `renderDialogContext` case; `INTERPRET_SYSTEM_PROMPT` greeting + null-amount teaching; `FEW_SHOTS` "hola" flip; `REPLY_SYSTEM_PROMPT` asked_registration + greeting |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modified | `"awaiting_registration"` added to `BOT_STATES`/`BotStateName` |
| `apps/api/src/features/telegram/reply-text.ts` | Modified | 5 templates: `askAmountReply`, `askCategoryReply`, `keptCollectingReply`, `collectAbandonedReply`, `greetingReply` |
| `apps/api/src/features/telegram/telegram.service.test.ts` | Modified | +~986: schema/constant tests; "registration collection" describe (T1–T11, intercept); dialog-controller `seedAwaitingRegistration` cases; greeting routing tests; E2 spec-delta updates; off_topic fixtures reworded |
| `apps/api/src/features/telegram/bot-brain.test.ts` | Modified | +90: greeting decode, null-amount validity, context assembly, prompt-contract pins, 2 new golden pins |
| `apps/api/src/features/telegram/reply-text.test.ts` | Modified | +58: 5-template tests |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Modified | +201: 5 collect e2e tests (journey, planned, shared, restart, corrupt) |
| `apps/api/src/features/telegram/__goldens__/interpret-system-prompt.txt` | Regenerated | greeting intent + null-amount teaching |
| `apps/api/src/features/telegram/__goldens__/interpret-few-shots.json` | Regenerated | "hola" → greeting flip |
| `apps/api/src/features/telegram/__goldens__/reply-system-prompt.txt` | Regenerated | asked_registration + greeting guidance |
| `apps/api/src/features/telegram/__goldens__/dialog-awaiting-registration-addendum.txt` | Created | new pinned golden |
| `apps/api/src/features/telegram/__goldens__/dialog-awaiting-registration-few-shots.json` | Created | new pinned golden |
| `openspec/changes/conversational-thread/tasks.md` | Modified | all 28 tasks marked `[x]` |

## Deviations from Design

None — implementation matches design. Two previously-locked tests were updated **with the spec delta** (documented above): the E2 category-unresolved brain-orchestration tests now assert the collect entry instead of the otro fallback, matching design decision E2 and the "Category-unresolved entry" spec scenario. The design explicitly allows "deliberate deltas only" for locked suites; the D6 awaiting_category suite is byte-untouched.

## Issues Found

1. Pre-existing (baseline, outside this change's scope): `movements.status.integration.test.ts` and `savings.migration.integration.test.ts` timed out at 5000ms during the initial baseline run (DB-pin inserts). Both passed in the final full run — environmental timing, not code. Reported for the record; not fixed here.
2. Lint surfaced one unused `reply` param in `resolveRegistrationAmount` — removed during 4.4.

## Remaining Tasks

None — all 28 tasks complete. Next phase: `sdd-verify`.