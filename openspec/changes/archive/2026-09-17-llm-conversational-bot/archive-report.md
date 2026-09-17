# Archive Report — LLM Conversational Bot

**Change**: `llm-conversational-bot`
**Archived at**: 2026-09-17
**Artifact store**: hybrid (OpenSpec filesystem + Engram mirror)
**Archived to**: `openspec/changes/archive/2026-09-17-llm-conversational-bot/`
**Archive type**: standard (full cycle completed, verified PASS — no CRITICAL or WARNING findings, no override required)

## Final State (at close)

Reported per the Final-State Authority hierarchy. `verify-report.md` and `apply-progress.md` are intermediate snapshots; final-state facts come from the orchestrator's launch prompt (verify PASS, apply commits, env.ts byte-identical) corroborated by repository evidence (branch `feat/llm-conversational-bot` at HEAD `1f004c9`).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Tasks | 18/18 complete, all `[x]` in the persisted `tasks.md` (1.1–6.3) |
| Verification verdict | **PASS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:68b1dd6d2e5088a397065a45e8445b20d94d648d79e1bd8e06abb15fd9a75ebf`) |
| Delta requirements | 14/14 (10 bot-brain + 4 telegram-bot; 8 note-interpretation removed, migration-only) |
| Delta scenarios | 42 actual spec bytes (17 bot-brain + 25 telegram-bot) — **verify-report and launch prompt claim 39/39; see Scenario-Count Contradiction below** |
| CRITICAL findings | 0 |
| WARNING findings | 0 |
| SUGGESTION findings | 4 (non-blocking; see Caveats) |
| API test suite | 383/383 (19 files), exit 0 |
| Typecheck | exit 0 (`pnpm --filter @rita/api typecheck`) |
| Lint | exit 0 (`pnpm --filter @rita/api lint`) |
| Delivery | Branch `feat/llm-conversational-bot` (HEAD `1f004c9`), NOT merged to `dev`; archive commit appended on this branch and pushed — the orchestrator delivers (merges) later |
| Apply commits | `ac9ef8a` (BotBrain port + goldens), `a2b3cf8` (mil-stance), `fc1bfb3` (intent-first orchestration + DI + tests, interpreter files deleted), `1f004c9` (docs/apply-progress) |

**env.ts byte-identical**: no config change in this change (verified by apply-progress and verify-report; the four LLM env vars already matched the spec contract). Prompt goldens under `apps/api/src/features/telegram/__goldens__/` are the repo's first committed snapshots — kept; regenerate ONLY via `vitest run -u` with deliberate review (prompt drift fails CI via `toMatchFileSnapshot`).

**Stale content NOT carried into canonical specs**: the `telegram-bot` delta's `## Pre-Existing Drift (informational)` section is meta-text and was NOT merged into the canonical spec (same precedent as the `2026-09-11-product-features` and `2026-09-17-llm-note-interpreter` archives). The old auto-learning and amount-precedence drift text from the prior interpreter era is not resurrected anywhere: the canonical `note-interpretation` capability file was deleted (see Specs Synced) and the canonical `telegram-bot` requirement text now names the bot brain.

## Scenario-Count Contradiction (recorded, not resolved)

The launch prompt and `verify-report.md` (written 2026-09-17 17:22, obs #378) state **39/39** delta scenarios (14 bot-brain + 25 telegram-bot). The actual delta spec bytes — verified byte-identical to HEAD at archive time — contain **42** `#### Scenario:` headings (17 bot-brain + 25 telegram-bot). The requirement count (14/14) is consistent between both sources.

Per the Final-State Authority rules, a contradiction between the launch prompt and repository evidence that cannot be ranked is recorded explicitly rather than resolved silently:

- **Claim (39/39)**: `verify-report.md` Coverage Counts table, written at verification time (2026-09-17 17:22), and the orchestrator's launch prompt final-state facts, both quoting it.
- **Repository evidence (42)**: `openspec/changes/llm-conversational-bot/specs/bot-brain/spec.md` at HEAD `1f004c9` contains 17 scenario headings; `specs/telegram-bot/spec.md` contains 25. The canonical `bot-brain/spec.md` created by this archive is byte-identical to that delta (readback DIFF_EXIT=0), so the canonical store now reflects 42 delta scenarios.
- **Effect on archive**: none on the sync (specs copied verbatim) nor on the task gate (18/18). The verify report's per-requirement prose coverage maps each scenario to tests; the count table appears to have undercounted bot-brain scenarios by 3. A future verify re-run against the canonical specs will count 17 bot-brain scenarios. This report does NOT restate "39/39" as a current fact without the caveat.

## Native Review Receipt Gate

`reviewGate` is structurally ABSENT for this candidate — no review was ever started for this change, no receipt exists, and `openspec/changes/llm-conversational-bot/reviews/` never existed. Per the sdd-archive skill, archive proceeds under ORDINARY REPOSITORY POLICY. The absence is not a defect and nothing blocks on it.

## Task Completion Gate

The persisted `tasks.md` was inspected BEFORE any spec sync or archive move: all 18 implementation tasks are marked `[x]` (1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3). The `## Review Workload Forecast` section is planning metadata, not implementation tasks. No stale unchecked implementation tasks; no archive-time reconciliation required. The Engram `tasks` mirror (obs #375) still shows unchecked `[ ]` boxes — it is a stale pre-apply snapshot; the persisted filesystem `tasks.md` is authoritative (18/18 `[x]`), consistent with the llm-note-interpreter archive precedent.

## Specs Synced

Delta scope: 14 requirements / 42 scenarios merged into the capability files.

### bot-brain (NEW domain — full spec)

- Main spec did NOT exist at `openspec/specs/bot-brain/spec.md`.
- The delta spec IS a full spec (`# Bot Brain Specification`, `## Purpose`, `## Requirements`), so it was copied mechanically: shell `Copy-Item` → temp → `git diff --no-index` readback (exit 0, empty diff, byte-identical; only benign LF→CRLF warnings) → `Move-Item`.
- **10 requirements / 17 scenarios**: Bot Brain Port, Interpret Envelope Contract, Reply-After-Action Contract, Intent Taxonomy, Degrade-to-Null Contract, Amount Normalization and Validation, Category Suggestion Contract, Prompt Contract (category-blind, Fase-2-ready), Environment Configuration, Timeout/No-Retry/Injectable Fetch.

### telegram-bot (existing main spec — 2 ADDED + 2 MODIFIED)

- Main spec existed at `openspec/specs/telegram-bot/spec.md` (14 requirements / 46 scenarios before sync).
- **MODIFIED** (replaced per the delta MODIFIED blocks): Movement Parsing, Classification and Categorization (8 → 11 scenarios; interpreter surface migrated to the bot brain, mil-stance + note-precedence added); Success and Help Reply Content (2 → 4 scenarios; brain-written with fixed fallback + redirect replies).
- **ADDED** (appended, prior-archive precedent): Intent-First Message Handling (7 scenarios); LLM Branch Replies with Fixed Fallback (3 scenarios).
- **Preserved untouched**: Long-Polling Lifecycle, Update Filtering, Owner Filtering, Message Deduplication, Movement Persistence and Error Tolerance, Configuration and Token Secrecy, Reply Channel (Bidirectional), Setup Flow (`awaiting_setup`), Correction Loop (`awaiting_category`) and Learning, Per-Owner State Machine, Bot Commands, Offline Testability (Reply + Middleware).
- Result: **16 requirements / 61 scenarios** (46 − 10 replaced + 25 delta = 61; verified by heading count).

### note-interpretation (REMOVED capability — file deleted)

- All 8 canonical requirements were REMOVED by the delta, each with `(Reason: ...)` and `(Migration: ...)` notes mapping to `bot-brain` (Degrade-to-Null, Amount Normalization, Category Suggestion, Environment, Timeout/No-Retry/Fetch) and `telegram-bot` (Deterministic-First → Intent-First, Amount Precedence, Amount-Conflict lifecycle, Port swap).
- **Repo convention check**: no tombstone/superseded marker pattern exists anywhere in this repo (`git log --diff-filter=D` on `openspec/specs/*` shows no prior capability deletion; grep for `superseded|absorbed|tombstone|REMOVED` in `openspec/specs/` finds nothing). With no tombstone convention, the OpenSpec standard applies: the canonical file was deleted (`git rm openspec/specs/note-interpretation/spec.md`) since the capability is fully absorbed into `bot-brain` and no requirement survives. The archived REMOVED delta in this change folder retains the full migration audit trail. This is the repo's first REMOVED-capability archive; the deletion is intentional and recorded here.

### Merge formatting

Merged content follows the repo's main-spec canonical style: `#### Scenario:` h4 headings with unindented `- GIVEN/WHEN/THEN/AND` bullets, blank lines between scenarios, `(Previously: ...)` notes retained (the delta files already used canonical formatting — no normalization was needed, unlike the product-features archive). Scenario names and Given/When/Then content are identical to the deltas; the delta scenario count is preserved.

### Config / policy

`openspec/config.yaml` `rules.archive` warns before merging destructive deltas — the note-interpretation REMOVED delta (8 requirements, whole capability) qualifies as destructive; it was applied as the intentional absorption of the capability into `bot-brain` per the orchestrator's explicit instruction ("the canonical note-interpretation spec is superseded by bot-brain"), and the deletion is recorded in this report. No other destructive merges applied. No `openspec/project.md` exists in this repo.

## Archive Move

The entire change folder was moved with a native shell rename (`Move-Item`, same-volume atomic) to `openspec/changes/archive/2026-09-17-llm-conversational-bot/` — all 9 artifacts (proposal, explore, 3 delta specs, design, tasks, apply-progress, verify-report). `verify-report.md` was untracked at move time, so `git mv` on the directory would have failed; native `Move-Item` was used (same precedent as the llm-note-interpreter archive). The source path was confirmed gone before the readback. The `archive-report.md` is additive and excluded from the comparison (it did not exist in the pre-move snapshot).

**Mandatory readback** (recursive pre-move snapshot vs archived tree; GNU `diff -r` is not on this host's PATH, so the repo-precedent `git diff --no-index` recursive diff engine was used — same mechanism as the `2026-09-11-product-features` and `2026-09-17-llm-note-interpreter` archives):

```
---DIFF-R-OUTPUT-BEGIN---
diff_exit=0 (0 = identical trees; empty diff above is the only passing evidence)
---DIFF-R-OUTPUT-END---
```

(Empty diff — the only passing evidence. Only benign LF→CRLF normalization warnings were emitted, no difference hunks.)

## Archive Contents

- `proposal.md` ✅
- `explore.md` ✅
- `specs/bot-brain/spec.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `specs/note-interpretation/spec.md` ✅ (REMOVED delta — migration audit trail)
- `design.md` ✅
- `tasks.md` ✅ (18/18 tasks complete, no unchecked implementation tasks)
- `apply-progress.md` ✅
- `verify-report.md` ✅ (verdict PASS, evidence_revision `sha256:68b1dd6d…5ebf`)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` remains).

## Delivery Status

The implementation lives on branch `feat/llm-conversational-bot` (HEAD `1f004c9`) and is NOT merged to `dev`. The archive work is a single docs commit on this branch — canonical spec sync + archive move + this report — pushed to `origin/feat/llm-conversational-bot`. No PR, no merge: the orchestrator delivers later.

## Caveats

- verify SUGGESTION 1: `app.ts` DI conditional (brain only when `GROQ_API_KEY` set) has no app-level test; covered by inspection + service/integration no-brain defaults. Not addressed in this docs-only archive.
- verify SUGGESTION 2: no explicit test for keyword-match + genuinely conflicting amounts; uniform amount precedence (D4) is structurally guaranteed but not regression-pinned.
- verify SUGGESTION 3: `query_recent`/`correct_category` in idle share switch branches with tested intents but lack their own explicit tests.
- verify SUGGESTION 4: `AbortSignal.timeout` elapse not timer-tested (simulated via immediate AbortError).
- Scenario-count contradiction (39 claimed vs 42 actual) — see the dedicated section above. No spec bytes were altered to force a count; the sync is verbatim.

## Engram Mirror

Mirrored to Engram topic `sdd/llm-conversational-bot/archive-report` (type `architecture`, `capture_prompt: false`, project `automatizaciongastos`). The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability):**
- **obs #371** — `sdd/llm-conversational-bot/explore` mirror. Matches the filesystem explore.md (interpret-every-message + reply-after-action rationale).
- **obs #372** — `sdd/llm-conversational-bot/proposal` mirror. Matches proposal.md (two-call loop, intent taxonomy, "5 mil" stance).
- **obs #373** — `sdd/llm-conversational-bot/spec` mirror. Matches the three delta specs; source of the scenario count used for the contradiction check.
- **obs #374** — `sdd/llm-conversational-bot/design` mirror. Matches design.md (D1–D7, branch wiring table, mil-stance module).
- **obs #375** — `sdd/llm-conversational-bot/tasks` mirror. **Stale pre-apply snapshot** (unchecked `[ ]` boxes); the persisted filesystem `tasks.md` is authoritative (18/18 `[x]`).
- **obs #376** — `sdd/llm-conversational-bot/apply-progress` mirror. Corroborates the Task Completion Gate and the 383-test evidence.
- **obs #378** — `sdd/llm-conversational-bot/verify-report` mirror. Verdict PASS, 14/14 / 39/39 claims, 383 tests; matches the filesystem report (both carry the 39-scenario claim contradicted by spec bytes — see above).

No review artifacts exist (see Native Review Receipt Gate); all source artifacts were retrieved from the filesystem per the OpenSpec convention, with Engram mirrors read for traceability.

## Remaining Manual Steps

None. No CRITICAL or implementation WARNING findings; the change is fully implemented, verified, and archived. Orchestrator next step: deliver (merge `feat/llm-conversational-bot` to `dev`).