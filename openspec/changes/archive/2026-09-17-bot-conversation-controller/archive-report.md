# Archive Report — Bot Conversation Controller

**Change**: `bot-conversation-controller`
**Archived at**: 2026-09-17
**Artifact store**: hybrid (OpenSpec filesystem + Engram mirror)
**Archived to**: `openspec/changes/archive/2026-09-17-bot-conversation-controller/`
**Archive type**: standard (full cycle completed, verified PASS — no CRITICAL or WARNING findings, no override required)

## Final State (at close)

Reported per the Final-State Authority hierarchy. `verify-report.md` and `apply-progress.md` are intermediate snapshots; final-state facts come from the orchestrator's launch prompt (verify PASS, 557/557 tests, no migration, apply divergences acceptable) corroborated by repository evidence (branch `feat/bot-conversation-controller` at HEAD `f7b507f`).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Tasks | 15/15 complete, all `[x]` in the persisted `tasks.md` (1.1–4.4) and in the Engram mirror (obs #389) |
| Verification verdict | **PASS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:be696755255f1f1990dfbe318e8647785b2331a5a94fa01933664cf91f76fc6a`) |
| Delta requirements | 15/15 (4 movement-correction + 5 bot-brain + 6 telegram-bot) |
| Delta scenarios | 56/56 (9 movement-correction + 16 bot-brain + 31 telegram-bot) |
| CRITICAL findings | 0 |
| WARNING findings | 0 |
| SUGGESTION findings | 3 (non-blocking; see Caveats) |
| API test suite | 557/557 (22 files), exit 0 |
| Typecheck | exit 0 (`pnpm --filter @rita/api typecheck`) |
| Lint | exit 0 (`pnpm --filter @rita/api lint`) |
| Migration | None needed — `BotState.state` is a TEXT column; `"awaiting_movement_selection"` is a new value, not a schema change |
| Delivery | Branch `feat/bot-conversation-controller` (HEAD `f7b507f`), NOT merged to `dev`; archive commit appended on this branch and pushed — the orchestrator delivers (merges) later |
| Apply commits | `e3d8e4f` (Phase 1 brain contract), `680f355` (Phase 2 movement corrector), `bca4be1` (Phase 3 dialog controller + verification), `f7b507f` (docs/tasks complete + apply progress) |

**Apply divergences (8, all verified acceptable/spec-faithful per verify-report and the orchestrator)**: recency as tie-breaker only; `CorrectionResult` gains `{status:"missing"}`; injectable `now: Date` clock; null-category resolve → `questionDroppedReply`; corrupt amount-confirmation payload → D6 fallback without brain call; dropped unused `dialog` param; `dialog_action`/`then_reassign` typed optional; empty window + empty reference → `no_match`. No action needed at archive; each is documented in `apply-progress.md` and re-confirmed acceptable by `verify-report.md`.

**Stale content NOT carried into canonical specs**: the `bot-brain` and `telegram-bot` deltas' `## Pre-Existing Drift (informational)` sections are meta-text and were NOT merged into the canonical specs (same precedent as the `2026-09-17-llm-conversational-bot` archive). The drift reconciliations themselves ARE carried: canonical `bot-brain` and `telegram-bot` now pin real query execution and the wider intent taxonomy (`query`, `query_type`, `new_name`, `create_category`, `delete_category`, `rename_category`, `capabilities`), matching the live code contract.

## Native Review Receipt Gate

`reviewGate` is structurally ABSENT for this candidate — no review was ever started for this change, no receipt exists, and no `sdd/bot-conversation-controller/review/*` Engram topics exist. Per the sdd-archive skill, archive proceeds under ORDINARY REPOSITORY POLICY. The absence is not a defect and nothing blocks on it.

## Task Completion Gate

The persisted `tasks.md` was inspected BEFORE any spec sync or archive move: all 15 implementation tasks are marked `[x]` (1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4). The `## Review Workload Forecast` section is planning metadata, not implementation tasks. No stale unchecked implementation tasks; no archive-time reconciliation required. The Engram `tasks` mirror (obs #389) ALSO shows all `[x]` — it is current (unlike the stale pre-apply mirror in the llm-conversational-bot archive), so both the filesystem and Engram agree on 15/15.

## Specs Synced

Delta scope: 15 requirements / 56 scenarios merged into the capability files. All counts verified by heading scan of the merged canonical files at archive time.

### movement-correction (NEW domain — full spec)

- Main spec did NOT exist at `openspec/specs/movement-correction/spec.md`.
- The delta spec IS a full spec (`# Movement Correction Specification`, `## Purpose`, `## Requirements`), so it was copied mechanically: shell `Copy-Item` → temp → `git diff --no-index` readback (exit 0, empty diff, byte-identical; only benign LF→CRLF warnings) → `Move-Item`.
- **4 requirements / 9 scenarios**: Movement Correction Executor, Movement Reference Matching, Ambiguity Resolution, Correction Safety (Phantom Guard).

### bot-brain (existing main spec — 1 ADDED + 4 MODIFIED)

- Main spec existed at `openspec/specs/bot-brain/spec.md` (10 requirements / 17 scenarios before sync).
- **MODIFIED** (whole block replaced per the delta MODIFIED blocks, never appended): Bot Brain Port (2 → 3 scenarios; `interpret(message, context?)`, `InterpretContext`, envelope + `dialog_action`/`then_reassign`); Interpret Envelope Contract (2 → 3; schema + `dialog_action`/`then_reassign` fields, wider intent taxonomy); Intent Taxonomy (2 → 4; real query execution, `correct_category` drives the correction flow); Prompt Contract (category-blind, Fase-2-ready → dialog-aware; 1 → 2 scenarios).
- **ADDED** (appended at end of Requirements, prior-archive precedent): Dialog Action Contract (4 scenarios).
- **Preserved untouched**: Reply-After-Action Contract, Degrade-to-Null Contract, Amount Normalization and Validation, Category Suggestion Contract, Environment Configuration, Timeout/No-Retry/Injectable Fetch.
- Result: **11 requirements / 26 scenarios** (17 − 7 replaced + 16 delta = 26; verified by heading count).

### telegram-bot (existing main spec — 2 ADDED + 4 MODIFIED)

- Main spec existed at `openspec/specs/telegram-bot/spec.md` (16 requirements / 61 scenarios before sync).
- **MODIFIED** (whole block replaced per the delta MODIFIED blocks, never appended): Intent-First Message Handling (7 scenarios; queries execute real data, dialog states route through the brain); Success and Help Reply Content (4 scenarios; executed-query answers replace honest redirects); Correction Loop (`awaiting_category`) and Learning (5 scenarios; brain-first with D6 fallback, two `(Previously: ...)` notes retained); Per-Owner State Machine (6 scenarios; phantom guard + payload-only resolve).
- **ADDED** (appended at end of Requirements, prior-archive precedent): Dialog Controller (Brain-Routed Dialogs) (7 scenarios); Mixed-Intent Create + Reassign (`then_reassign`) (2 scenarios).
- **Preserved untouched**: Long-Polling Lifecycle, Update Filtering, Owner Filtering, Message Deduplication, Movement Parsing/Classification/Categorization, Movement Persistence and Error Tolerance, Configuration and Token Secrecy, Reply Channel (Bidirectional), Setup Flow (`awaiting_setup`), Bot Commands, Offline Testability, LLM Branch Replies with Fixed Fallback.
- Result: **18 requirements / 70 scenarios** (61 − 22 replaced + 31 delta = 70; verified by heading count).

### Merge formatting

Merged content follows the repo's main-spec canonical style: `#### Scenario:` h4 headings with unindented `- GIVEN/WHEN/THEN/AND` bullets, blank lines between scenarios, `(Previously: ...)` notes retained (the delta files already used canonical formatting — no normalization was needed). Scenario names and Given/When/Then content are identical to the deltas; the delta scenario count is preserved. The drift reconciliations in the deltas were kept verbatim (queries execute for real; intent taxonomy includes `query`/`create_category`/`capabilities`).

### Config / policy

`openspec/config.yaml` `rules.archive` warns before merging destructive deltas — no REMOVED or RENAMED sections exist in any of the three deltas, so no destructive merge was applied and no confirmation was required. No `openspec/project.md` exists in this repo.

## Archive Move

The entire change folder was moved with a native shell rename (`Move-Item`, same-volume atomic) to `openspec/changes/archive/2026-09-17-bot-conversation-controller/` — all 8 artifacts (proposal, design, 3 delta specs, tasks, apply-progress, verify-report). `verify-report.md` was untracked at move time, so `git mv` on the directory would have failed; native `Move-Item` was used (same precedent as the llm-conversational-bot archive). The source path was confirmed gone before the readback (`SOURCE_GONE=yes`). The `archive-report.md` is additive and excluded from the comparison (it did not exist in the pre-move snapshot).

**Mandatory readback** (recursive pre-move snapshot vs archived tree; GNU `diff -r` is not on this host's PATH, so the repo-precedent `git diff --no-index` recursive diff engine was used — same mechanism as the `2026-09-11-product-features`, `2026-09-17-llm-note-interpreter`, and `2026-09-17-llm-conversational-bot` archives):

```
---DIFF-R-OUTPUT-BEGIN---
diff_exit=0 (0 = identical trees; empty diff above is the only passing evidence)
---DIFF-R-OUTPUT-END---
```

(Empty diff — the only passing evidence. Only benign LF→CRLF normalization warnings were emitted, no difference hunks, across all 8 artifacts: apply-progress.md, design.md, proposal.md, specs/bot-brain/spec.md, specs/movement-correction/spec.md, specs/telegram-bot/spec.md, tasks.md, verify-report.md.)

## Archive Contents

- `proposal.md` ✅
- `specs/movement-correction/spec.md` ✅ (NEW full spec — also canonical now)
- `specs/bot-brain/spec.md` ✅ (delta — 1 ADDED + 4 MODIFIED)
- `specs/telegram-bot/spec.md` ✅ (delta — 2 ADDED + 4 MODIFIED)
- `design.md` ✅
- `tasks.md` ✅ (15/15 tasks complete, no unchecked implementation tasks)
- `apply-progress.md` ✅
- `verify-report.md` ✅ (verdict PASS, evidence_revision `sha256:be696755…fc6a`)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` remains).

## Delivery Status

The implementation lives on branch `feat/bot-conversation-controller` (HEAD `f7b507f`) and is NOT merged to `dev`. The archive work is a single docs commit on this branch — canonical spec sync + archive move + this report — pushed to `origin/feat/bot-conversation-controller`. No PR, no merge: the orchestrator delivers later.

## Caveats

- verify SUGGESTION 1 (pre-existing, not introduced here): `expenses.route.test.ts` `beforeAll` migrate-deploy 10s timeout in one baseline run; passes in isolation (17/17) and in the final full run (557/557). Not addressed in this docs-only archive.
- verify SUGGESTION 2: recency bucket constants (48h/7d) and weights are tunable, not regression-pinned; selection pick accepts number + note + unique amount (no ordinal words), as designed.
- verify SUGGESTION 3: brain-absent wiring (`app.ts` conditional `GroqBotBrain`) has no direct construction test for the absent-key path; covered by env tests + null-brain service behavior.
- Archive-time note: stale `awaiting_movement_selection` rows from a rollback degrade via the corrupt/non-answer path (clear + dropped reply); no migration needed since `BotState.state` is TEXT.

## Engram Mirror

Mirrored to Engram topic `sdd/bot-conversation-controller/archive-report` (type `architecture`, `capture_prompt: false`, project `automatizaciongastos`). The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability):**
- **obs #386** — `sdd/bot-conversation-controller/proposal` mirror. Matches proposal.md (LLM as controller in ALL states; 4 user-verified dialog failures).
- **obs #387** — `sdd/bot-conversation-controller/spec` mirror. Matches the three delta specs verbatim; source of the 15-req/56-scen count used for the consistency check.
- **obs #388** — `sdd/bot-conversation-controller/design` mirror. Matches design.md (D1–D8, phantom guard, matcher scoring table).
- **obs #389** — `sdd/bot-conversation-controller/tasks` mirror. CURRENT: all 15 tasks `[x]` (revised post-apply); agrees with the persisted filesystem `tasks.md`.
- **obs #390** — `sdd/bot-conversation-controller/apply-progress` mirror. Corroborates the Task Completion Gate, the 8 divergences, and the 557-test evidence.
- **obs #392** — `sdd/bot-conversation-controller/verify-report` mirror. Verdict PASS, 15/15 / 56/56, 557 tests; matches the filesystem report exactly.

No count contradictions: the delta spec bytes (4/9 + 5/16 + 6/31 = 15/56) match the verify-report coverage table and the orchestrator's final-state facts. No review artifacts exist (see Native Review Receipt Gate); all source artifacts were retrieved from the filesystem per the OpenSpec convention, with Engram mirrors read for traceability.

## Remaining Manual Steps

None. No CRITICAL or implementation WARNING findings; the change is fully implemented, verified, and archived. Orchestrator next step: deliver (merge `feat/bot-conversation-controller` to `dev`).