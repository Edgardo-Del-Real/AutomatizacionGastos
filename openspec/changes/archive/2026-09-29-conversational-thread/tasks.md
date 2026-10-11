# Tasks: Conversational Thread — Registration Detail Collection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2800–3400 authored (excl. goldens) |
| 400-line budget risk | High |
| Chained PRs recommended | No (single-pr selected) |
| Suggested split | Single PR via `size:exception` |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (commits inside the single PR)

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | State constant + payload schema + templates | PR 1 (c1) | `pnpm --filter @rita/api test -- reply-text.test.ts` | N/A — pure schema/template units | Revert `bot-state.repository.ts`, schema block, `reply-text.ts` |
| 2 | E1/E2 entries + routing + dialog controller | PR 1 (c2) | `pnpm --filter @rita/api test -- telegram.service.test.ts` | N/A — unit-proven, no runtime boundary | Revert entries + `handleUpdate`/fallback/resolve edits |
| 3 | Resolvers + cascade + abandon/non-consuming | PR 1 (c3) | `pnpm --filter @rita/api test -- telegram.service.test.ts` | N/A — unit-proven | Revert resolver functions in `telegram.service.ts` |
| 4 | Brain: greeting + asked_registration + teaching | PR 1 (c4) | `pnpm --filter @rita/api test -- bot-brain.test.ts` | N/A — unit-proven | Revert `bot-brain.ts` + greeting/abandon-arm edits |
| 5 | Goldens + integration + full suite | PR 1 (c5) | `pnpm --filter @rita/api test -- -u`, then full `pnpm --filter @rita/api test` | `docker compose up -d --wait` + `createdb automatizacionrita_test`; run integration suite | Restore goldens + locked-test deltas from git |

## Phase 1: Foundation

- [x] 1.1 RED `reply-text.test.ts`: assert 5 templates — `askAmountReply(note)`, `askCategoryReply(note)`, `keptCollectingReply(field)`, `collectAbandonedReply()`, `greetingReply()` (voseo text)
- [x] 1.2 GREEN `reply-text.ts`: add the 5 templates
- [x] 1.3 RED `telegram.service.test.ts`: `AWAITING_REGISTRATION` constant; `registrationCollectPayloadSchema` (nullable amount/category, defaults shared/planned/override, positive amount)
- [x] 1.4 GREEN `telegram.service.ts`: constant (:106-110) + `registrationCollectPayloadSchema` next to :125-135 + `decodeCollectPayload` decoder
- [x] 1.5 GREEN `bot-state.repository.ts`: add `awaiting_registration` to `BOT_STATES`/`BotStateName` (:3-11)

## Phase 2: Entries + Dialog Controller

- [x] 2.1 RED T1: amount-null entry persists payload + `asked_registration(asked_field:"amount")`; no movement, no free-text question
- [x] 2.2 GREEN `executeRegistration` E1 (:444-450): persist + `asked_registration`; no-signal otro branch (:474-480) untouched
- [x] 2.3 RED T2: category-signal-unresolved persists (amount set, category null) + asks category; no-brain prefix entry (`previsto:`/`compartido:` without amount, :404-407)
- [x] 2.4 GREEN `executeRegistration` E2 + `deterministicRegistration` prefix entry; no-brain bare noun keeps `helpReply`
- [x] 2.5 RED `handleUpdate` (:254-257): dialog branch gains `AWAITING_REGISTRATION`; `buildInterpretContext` (:911-928) decodes payload, corrupt → null → D6 fallback
- [x] 2.6 GREEN routing: `handleUpdate` + `d6DialogFallback`/`resolveDialog` dispatch (:890-904, :931-943); openQuestion from derived field
- [x] 2.7 RED T4: amount resolver — completes (category set → idle, register from stored context), keeps collecting (persist + ask category), phantom guard (wrong-field/empty → T9 re-ask)
- [x] 2.8 GREEN `resolveAwaitingRegistration` amount path: `normalizeAmountString(body) ?? parseAmount(body)`, `envelope.amount` positive-only rescue
- [x] 2.9 RED T5 cascade: exact → folded plural → single-token guarded `createCategory` (reserved → stay open) → multi-word list + stay open; abandon words; D6 rule 2 (`parseAmountAndNote` → reprocess)
- [x] 2.10 GREEN `d6AwaitingRegistration` cascade (:707-798 mirror)
- [x] 2.11 RED T6/T7/T8/T10/T11 + intercept: abandon clears; query/CRUD/greeting keep pending; new register_expense abandons + registers; corrupt → idle + `questionDroppedReply`; restart survival; bare "dale" → kept-collecting re-ask (:855-861)
- [x] 2.12 GREEN abandon/non-consuming/corrupt handlers + affirmation intercept; extend :2023-2455 dialog controller with `seedAwaitingRegistration` cases (resolve/abandon/phantom guard/non-consuming/single interpret call)

## Phase 3: Brain Integration

- [x] 3.1 RED `bot-brain.test.ts`: greeting decodes; null-amount register_expense valid; `asked_registration` action + `asked_field`; awaiting_registration context assembly (extend :859-932)
- [x] 3.2 GREEN `bot-brain.ts`: `BOT_INTENTS` + greeting (:4-21), `conversationEnvelopeSchema`, `BotAction` + asked_registration, `ExecutionResult` + `asked_field`, `InterpretContext` union
- [x] 3.3 GREEN `DIALOG_INTERPRET_ADDENDUM`/`DIALOG_FEW_SHOTS`.awaiting_registration (:352-417) + `renderDialogContext` case (:420-427)
- [x] 3.4 GREEN `INTERPRET_SYSTEM_PROMPT` (:213-236): greeting + null-amount teaching; `FEW_SHOTS` (:304-305) "hola" → greeting flip; `REPLY_SYSTEM_PROMPT` (:336-346): asked_registration asks only `asked_field`; greeting warm one-liner
- [x] 3.5 RED greeting routing: :1675/1693 fixtures move off "hola"; new greeting tests (idle + during open dialog, pending untouched)
- [x] 3.6 GREEN `routeEnvelopeIntent` (:1089-1153): `case "greeting"` + `greetingReply()` fallback; abandon arm gains `AWAITING_REGISTRATION` → `collectAbandonedReply()` third case

## Phase 4: Goldens + Integration

- [x] 4.1 Regenerate: `pnpm --filter @rita/api test -- -u` → `__goldens__/interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt`; create `dialog-awaiting-registration-addendum.txt` + `dialog-awaiting-registration-few-shots.json`; re-pin :1065-1110
- [x] 4.2 Locked proofs: full `pnpm --filter @rita/api test` — :584-783 awaiting_category D6 stays green unchanged (non-conflation); :1126 off_topic never chats
- [x] 4.3 RED+integration `telegram.service.integration.test.ts`: entry→amount→category→registered honoring planned/shared/override; restart survival mid-dialog; corrupt-payload recovery (mirror :543-635)
- [x] 4.4 Final: `pnpm --filter @rita/api test` + `typecheck` + `lint` all green

## Phase 5: Cleanup

- [x] 5.1 Mark task checkboxes in `openspec/changes/conversational-thread/tasks.md`; remove temporary fixtures