# Archive Report — LLM Note Interpreter for Telegram Registration

**Change**: `llm-note-interpreter`
**Archived at**: 2026-09-17
**Artifact store**: hybrid (OpenSpec filesystem + Engram mirror)
**Archived to**: `openspec/changes/archive/2026-09-17-llm-note-interpreter/`
**Archive type**: standard (full cycle completed, verified PASS — no CRITICAL or WARNING findings, no override required)

## Final State (at close)

Reported per the Final-State Authority hierarchy. `verify-report.md` and `apply-progress.md` are intermediate snapshots; final-state facts come from the orchestrator's launch prompt (PR #7 merged, direct merge to dev) corroborated by repository evidence (branch `dev` at `632cf8b`).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Tasks | 12/12 complete, all `[x]` in `tasks.md` (1.1–5.1) |
| Verification verdict | **PASS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:cd57edae4e3d816714b7cd890184ca3dacee0da209397db09fba96bcb56f578a`) |
| Delta requirements | 12/12 (9 note-interpretation + 3 telegram-bot delta) |
| Delta scenarios | 34/34 (15 note-interpretation + 19 telegram-bot delta) |
| CRITICAL findings | 0 |
| WARNING findings | 0 |
| SUGGESTION findings | 4 (non-blocking; see Caveats) |
| API test suite | 317/317 (18 files), exit 0 |
| Typecheck | exit 0 (`pnpm --filter @rita/api typecheck`) |
| Lint | exit 0 (`pnpm --filter @rita/api lint`, 0 problems) |
| Delivery | PR #7 merged to `dev` (`c18ca27f`) + `feat/llm-note-interpreter` merged directly to `dev` WITHOUT a PR (`632cf8b`), per user decision — implementation already on `dev` before archive; archive commit appended on `dev` and pushed |

**Task-count note**: `apply-progress.md` and the Engram tasks mirror say "10 tasks"; the persisted `tasks.md` has 12 checked implementation tasks (1.1–1.2, 2.1–2.2, 3.1–3.4, 4.1–4.3, 5.1). Per the Task Completion Gate, the persisted tasks artifact is the source of truth for completion visibility: **12/12 `[x]`**.

**Stale content NOT carried into canonical specs**: the exploration document (`explore.md`, line 44) claims `apps/api/.env` has the GROQ key concatenated onto the `TELEGRAM_OWNER_CHAT_ID` line. That gotcha is STALE — the key is on its own line now (verified in proposal: "`.env` GROQ key verified — exploration's malformed-line gotcha is stale"; confirmed by launch-prompt final-state facts). The archived `explore.md` retains its historical text unmodified (the archive is an audit trail); no canonical spec carries the gotcha.

## Native Review Receipt Gate

`reviewGate` is structurally ABSENT for this candidate — no review was ever started for this change and no receipt exists to read (`openspec/changes/llm-note-interpreter/reviews/` never existed). Per the sdd-archive skill, archive proceeds under ORDINARY REPOSITORY POLICY. The absence is not a defect and nothing blocks on it.

## Task Completion Gate

The persisted `tasks.md` was inspected BEFORE any spec sync or archive move: all 12 implementation tasks are marked `[x]` (1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1). The `## Review Workload Forecast` section is planning metadata, not implementation tasks. No stale unchecked implementation tasks; no archive-time reconciliation required. Corroborated by Engram obs #364/#365.

## Specs Synced

Delta scope: 12 requirements / 34 scenarios merged into the capability files.

### note-interpretation (NEW domain — full spec)

- Main spec did NOT exist at `openspec/specs/note-interpretation/spec.md`.
- The delta spec IS a full spec (`# Note Interpretation Specification`, `## Purpose`, `## Requirements`), so it was copied mechanically: shell `Copy-Item` → temp → `git diff --no-index` readback (exit 0, empty diff, byte-identical; only benign LF→CRLF warnings) → `Move-Item`.
- **9 requirements / 15 scenarios**: Note Interpreter Port, Degrade-to-Null Contract, Amount Normalization and Validation, Category Suggestion Contract, Deterministic-First Invocation, Amount Precedence and Product Rules, Amount-Conflict Question Lifecycle, Environment Configuration, Timeout/No-Retry/Injectable Fetch.

### telegram-bot (existing main spec — 3 MODIFIED + 11 preserved)

- Main spec existed at `openspec/specs/telegram-bot/spec.md` (14 requirements / 44 scenarios before sync).
- **MODIFIED** (replaced per the delta MODIFIED blocks): Movement Parsing, Classification and Categorization; Correction Loop (`awaiting_category`) and Learning; Per-Owner State Machine.
- **Preserved untouched**: Long-Polling Lifecycle, Update Filtering, Owner Filtering, Message Deduplication, Movement Persistence and Error Tolerance, Configuration and Token Secrecy, Reply Channel (Bidirectional), Success and Help Reply Content, Setup Flow (`awaiting_setup`), Bot Commands, Offline Testability (Reply + Middleware).
- Result: **14 requirements / 46 scenarios** (27 preserved + 19 delta).

**Mandated scenario correction (archive-time amendment, verify SUGGESTION 1):**
- The delta's "No amount rescued by the interpreter" scenario used `"gaste como 5 mil pesos"` as the no-deterministic-amount example. That body is WRONG: `parseAmount("gaste como 5 mil pesos")` → **5** (verified against `message.parser.ts`) — it exercises the amount-CONFLICT path (5 vs 5000 → ask), not rescue. The canonical scenario now reads: GIVEN owner text `"compre mercaderia"` (genuinely unparseable — `parseAmount` → null) with no deterministic amount and an interpreter amount of 5000 → THEN a movement registers directly with 5000. Scenario name and count unchanged (no scenario added/removed; 34/34 preserved). Other verified-unparseable rescue inputs documented in design/verify: `"gaste cinco mil pesos"`, `"1234,50 cafe"`, `"$ 1.234,50 supermercado"`, `"1234.5 cafe"`.

**Pre-existing drift corrected in the sync (not merely noted):**
- The canonical "Correction Loop (awaiting_category) and Learning" requirement previously mandated keyword auto-learning ("learn a keyword rule mapping the original note's first significant word to that category"). The current implementation (D6 behavior, verified) does NOT learn — keyword rules are created exclusively via the explicit `asociar palabra` command. The canonical requirement was replaced with the delta's no-learning text: answer reassigns without learning, single-token non-category auto-creates the category only, amount reply = new registration, multi-word non-answer lists categories without closing state. The delta's `## Pre-Existing Drift (not fixed by this change)` section is meta-text and was NOT merged into the canonical spec — the canonical spec now reflects current behavior, which is the point of the sync.
- The delta MODIFIED block for Per-Owner State Machine omits the former "Setup back to idle" scenario; merged per the delta (authoritative, verified 19/19). The setup→idle transition remains covered by the Setup Flow requirement's "Reply creates categories" scenario.

### Merge formatting

Merged content follows the repo's main-spec canonical style: `#### Scenario:` h4 headings with unindented `- GIVEN/WHEN/THEN/AND` bullets, blank lines between scenarios, `(Previously: ...)` notes retained. The delta's `**Feature:**` grouping labels were dropped (same normalization precedent as the `2026-09-11-product-features` archive). Scenario names and Given/When/Then content are identical to the deltas except the one mandated correction above; the 19-scenario delta count is preserved.

### Config / policy

`openspec/config.yaml` `rules.archive` warns before merging destructive deltas — none applied (all merges were ADDED/MODIFIED; no REMOVED requirements in either delta). No `openspec/project.md` exists in this repo.

## Archive Move

The entire change folder was moved with a native shell rename (`Move-Item`, same-volume atomic) to `openspec/changes/archive/2026-09-17-llm-note-interpreter/` — all 8 artifacts (proposal, explore, 2 delta specs, design, tasks, apply-progress, verify-report). The source path was confirmed gone before the readback. The `archive-report.md` is additive and excluded from the comparison (it did not exist in the pre-move snapshot).

**Mandatory readback** (recursive snapshot vs archived tree; GNU `diff -r` is not on this host's PATH, so the repo-precedent `git diff --no-index` recursive diff engine was used — same mechanism as the `2026-09-11-product-features` archive):

```
---DIFF-R-OUTPUT-BEGIN---
diff_exit=0 (0 = identical trees; empty diff above is the only passing evidence)
---DIFF-R-OUTPUT-END---
```

(Empty diff — the only passing evidence. Only benign LF→CRLF normalization warnings were emitted, no difference hunks.)

## Archive Contents

- `proposal.md` ✅
- `explore.md` ✅ (historical text retained, incl. the stale `.env` gotcha — flagged above, not current)
- `specs/note-interpretation/spec.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (12/12 tasks complete, no unchecked implementation tasks)
- `apply-progress.md` ✅
- `verify-report.md` ✅ (verdict PASS, evidence_revision `sha256:cd57edae…578a`, 12/12 requirements, 34/34 scenarios)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` remains).

## Delivery Status

The implementation was already delivered to `dev` before archive: PR #7 merged (`c18ca27f`, correction-loop no-learning slice) + `feat/llm-note-interpreter` merged directly to `dev` without a PR (`632cf8b`), per user decision. The archive work is a single docs commit on `dev` (canonical spec sync + archive move + this report), pushed to `origin/dev`.

## Caveats

- verify SUGGESTION 2: design open question 2 (third-amount reply `"6000"` abandons + reprocesses as a new registration) — implemented per the design default, covered by unit + integration tests. Closed.
- verify SUGGESTION 3: design open question 3 (category renamed between ask and answer keeps the stored name) — implemented per the design default (`Expense.category` has no FK; accepted edge). Closed.
- verify SUGGESTION 4: `product` is validated but unused by the bot in this slice — dashboard surfacing is a documented follow-up (non-goal), no action.
- Task-count wording ("10 tasks") in apply-progress/Engram tasks mirror vs 12 checkboxes in the persisted tasks.md — the persisted artifact is authoritative (12/12).

## Engram Mirror

Mirrored to Engram topic `sdd/llm-note-interpreter/archive-report` (type `architecture`, `capture_prompt: false`, project `automatizaciongastos`). The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability):**
- **obs #360** — `sdd/llm-note-interpreter/explore` mirror (stale `.env` gotcha source; flagged above).
- **obs #361** — `sdd/llm-note-interpreter/proposal` mirror. Confirms the `.env` gotcha is stale ("exploration's malformed-line gotcha is stale").
- **obs #362** — `sdd/llm-note-interpreter/spec` mirror. Matches the delta specs; notes the pre-existing drift (no-learning behavior) that this sync corrected.
- **obs #363** — `sdd/llm-note-interpreter/design` mirror. Confirms the parser-verified rescue-input set and the "5 mil" conflict-path finding driving the scenario amendment.
- **obs #364** — `sdd/llm-note-interpreter/tasks` mirror (says 10 tasks; persisted tasks.md has 12 `[x]` — see Caveats).
- **obs #365** — `sdd/llm-note-interpreter/apply-progress` mirror. Corroborates the Task Completion Gate and the archive-phase scenario amendment mandate.
- **obs #366** — `sdd/llm-note-interpreter/verify-report` mirror. Verdict PASS, 12/12 / 34/34, 317 tests; matches the filesystem report exactly (no stale-count correction needed, unlike the product-features change).
- **obs #367** — delivery record: PR #7 + direct merge, `dev` @ `632cf8b`.

No review artifacts exist (see Native Review Receipt Gate); all source artifacts were retrieved from the filesystem per the OpenSpec convention, with Engram mirrors read for traceability.

## Remaining Manual Steps

None. No CRITICAL or implementation WARNING findings; the change is fully delivered, verified, and archived.