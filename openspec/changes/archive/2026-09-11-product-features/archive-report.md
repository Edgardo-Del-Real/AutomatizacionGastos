# Archive Report — Learning categories, bot confirmations, dashboard corrections

**Change**: `2026-09-10-product-features`
**Archived at**: 2026-09-11
**Artifact store**: hybrid (OpenSpec filesystem + Engram mirror)
**Archived to**: `openspec/changes/archive/2026-09-11-product-features/`
**Archive type**: standard (full cycle completed, verified PASS WITH WARNINGS — no implementation defects, no override required)

## Final State (at close)

Reported per the Final-State Authority hierarchy. The `verify-report.md` snapshot and Engram obs #292/#300 are intermediate snapshots; final counts reflect the launch-prompt final-state facts corroborated by repository evidence (higher-ranked sources).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Tasks | 25/25 complete, all `[x]` in `tasks.md` (F0 5, F1 5, F2 7, F3 3, F4 5) |
| Verification verdict | **PASS WITH WARNINGS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:6b7aa449ebc185a52fa5a920ec1d19ba0a5fa57457ed5dd7731767b97013a080`) |
| Delta requirements | 26/26 (12 telegram-bot + 5 money-movements + 5 movement-categories + 4 dashboard-web) |
| Delta scenarios | 81/81 (34 telegram-bot + 22 money-movements + 12 movement-categories + 13 dashboard-web) |
| Validator | `gentle-ai sdd-verify-validate --requirements 26 --scenarios 81` → `valid:true` |
| CRITICAL findings | 0 |
| WARNING findings | 0 affecting implementation (documentation-format gaps only, per verify) |
| SUGGESTION findings | 4 (non-blocking; see Caveats) |
| API test suite | 235/235 (17 files), exit 0 |
| Dashboard test suite | 94/94 (19 files), exit 0 |
| Typecheck | exit 0 both apps (`tsc -p tsconfig.json` API; contracts build + `tsc` dashboard) |
| Runtime smoke (PG 5433) | PASS (PATCH → 200 + DB row updated; DELETE → 204, row gone; GET categories → 200) |
| Delivery | Branch `feat/product-features` (HEAD `6b395d5` at verify; archive commits appended, see below), NOT pushed — orchestrator handles push/PR |

**Post-verify documentation corrections (kept, not reverted):**
1. **Requirement count corrected 24 → 26**: the verify-report summary numbers were wrong (the compliance matrix always listed 26); the file now reads 26/26. Evidence revision unchanged (no test evidence changed). Note: the Engram verify-report mirror (obs #300) still carries the stale `24/24` summary — superseded by the corrected filesystem report; flagged in Engram Mirror below.
2. **Delta scenario syntax canonicalized**: the 3 delta specs (dashboard-web, money-movements, telegram-bot) had `- Scenario:` bullets normalized to canonical `#### Scenario:` h4 headings so the native gate counts all 81 scenarios. Content and scenario names identical — preserved as-is.

**Known caveats carried into this report:**
- `note: ""` → `null` in the edit form (documented contract decision; `updateMovementSchema` requires `min(1)`, so empty note maps to `null` — not a spec violation).
- `apps/dashboard/src/features/movements/DashboardOverview.tsx` was modified to thread `refreshToken` (D11 consequence) though it is omitted from `design.md`'s File Changes table (verify SUGGESTION 1; implementation coherent with D11).
- No coverage tool configured in either vitest suite (informational only, not a failure).
- Additional verify SUGGESTIONs: contracts-pkg test runner absent (pre-existing), legacy-data coverage via migration inspection + indirect evidence, tabulate per-task TDD evidence in future apply-progress.

## Native Review Receipt Gate

`reviewGate` is structurally ABSENT for this candidate — no review was ever started for this change and no receipt exists to read. Per the sdd-archive skill, archive proceeds under ORDINARY REPOSITORY POLICY. The absence is not a defect and nothing blocks on it. No `dependencies.archive` block was present to investigate.

## Task Completion Gate

The persisted `tasks.md` was inspected before any spec sync or archive move: all 25 implementation tasks are marked `[x]` (F0 1.1–1.5, F1 2.1–2.5, F2 3.1–3.7, F3 4.1–4.3, F4 5.1–5.5). The `## Review Workload Forecast` table is planning metadata, not implementation tasks. No stale unchecked implementation tasks; no archive-time reconciliation required. Corroborated by Engram obs #292 (apply-progress, F0–F4 DONE, all suites green).

## Specs Synced

Delta scope: 26 requirements / 81 scenarios merged into the capability files. Merge counts below are requirement/scenario totals per merged file.

### telegram-bot (existing main spec — 5 MODIFIED + 7 ADDED)

- Main spec existed at `openspec/specs/telegram-bot/spec.md` (7 requirements).
- **MODIFIED** (replaced per delta): Update Filtering, Owner Filtering, Message Deduplication, Movement Parsing and Classification → **Movement Parsing, Classification and Categorization** (heading updated per the delta MODIFIED block), Movement Persistence and Error Tolerance.
- **ADDED** (appended): Reply Channel (Bidirectional), Success and Help Reply Content, Setup Flow (`awaiting_setup`), Correction Loop (`awaiting_category`) and Learning, Per-Owner State Machine, Bot Commands, Offline Testability (Reply + Middleware).
- **Preserved untouched**: Long-Polling Lifecycle, Configuration and Token Secrecy (not in the delta).
- **Purpose normalization** (factual-consistency fix, following the `2026-09-02-migrate-bot-to-telegram` precedent): "Inbound-only (no outbound replies)" → bidirectional wording ("successful registrations, setup, and correction flows reply back to the owner"), matching the delta's declared bidirectional intent. No requirement content invented; requirement text taken verbatim from the delta blocks.
- Result: **14 requirements / 38 scenarios** (34 delta + 4 preserved).

### money-movements (existing main spec — 1 MODIFIED + 4 ADDED)

- Main spec existed at `openspec/specs/money-movements/spec.md` (6 requirements).
- **MODIFIED**: Movement Contracts (now exports `createMovementSchema` + `updateMovementSchema` with optional/null semantics; 6 scenarios replacing the old 2).
- **ADDED**: Movement Update Endpoint, Movement Delete Endpoint, Category Read Endpoint, Legacy Data Preservation.
- **Preserved untouched**: Movement Type Model, Message Income Detection, Movement List Endpoint, Movement Summary Endpoint, Expense Retrocompatibility.
- Result: **10 requirements / 36 scenarios** (22 delta + 14 preserved).

### dashboard-web (existing main spec — 1 MODIFIED + 3 ADDED)

- Main spec existed at `openspec/specs/dashboard-web/spec.md` (6 requirements).
- **MODIFIED**: Movement List (row actions added; "Row actions present" scenario added).
- **ADDED**: Movement Edit Form, Movement Delete with Confirmation, Auto-Refresh After Mutations.
- **Preserved untouched**: Metrics Overview, Movement Filters, Fixed Owner, Loading/Error/Empty States, Response Validation.
- Result: **9 requirements / 26 scenarios** (13 delta + 13 preserved).

### movement-categories (NEW domain — full spec)

- Main spec did NOT exist at `openspec/specs/movement-categories/spec.md`.
- The delta spec (`specs/movement-categories/spec.md`) IS a full spec (`# Movement Categories Specification`, `## Purpose`, `## Requirements`), so it was copied mechanically as the new main spec (shell `Copy-Item` → temp → readback → `Move-Item`). Readback exit 0 — empty diff, byte-identical.
- **5 requirements / 12 scenarios**: Category Entity and Ownership, Automatic "otro" Fallback, Keyword Learning and Matching, Rename Cascade, Category Management Operations.

### Merge formatting

Merged content was normalized to the repo's main-spec canonical style: `#### Scenario:` h4 headings with unindented `- GIVEN/WHEN/THEN/AND` bullets (delta files used indented lowercase `- Given/When/Then` and `**Feature:**` labels). Scenario names and Given/When/Then content are identical to the deltas; the h4 heading count (81) is preserved — no scenario was dropped, added, or renamed in the merge.

### Config / policy

`openspec/config.yaml` `rules.archive` warns before merging destructive deltas — none applied (all merges were ADDED/MODIFIED; no REMOVED requirements). No `openspec/project.md` exists in this repo.

## Archive Move

The entire change folder was moved mechanically with `git mv` to `openspec/changes/archive/2026-09-11-product-features/` (all 9 artifacts git-tracked by then: proposal, exploration, design, tasks, verify-report, 4 delta specs). The source path was confirmed gone after the move.

**Readback note**: the initial `diff -r` invocation was executed by PowerShell's built-in `diff` alias (`Compare-Object`), which compared the two path strings rather than tree contents — detected and discarded as invalid evidence. The mandatory byte-identity readback was then performed with three independent mechanisms (all passing):

1. **git rename similarity** — `git diff --cached -M --summary` reports `rename ... (100%)` for all 9 files (git's own content-identity evidence for the move):
```
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/design.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/exploration.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/proposal.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/specs/dashboard-web/spec.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/specs/money-movements/spec.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/specs/movement-categories/spec.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/specs/telegram-bot/spec.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/tasks.md (100%)
rename openspec/changes/{2026-09-10-product-features => archive/2026-09-11-product-features}/verify-report.md (100%)
```

2. **Per-file byte identity vs pre-move committed blobs** — the working tree was clean immediately before the move (all artifacts committed in archive commit A), so HEAD blobs at the old paths are the exact pre-move bytes. `git hash-object` (archived file) vs `git rev-parse HEAD:<old-path>`:
```
IDENTICAL  .../archive/2026-09-11-product-features/proposal.md
IDENTICAL  .../archive/2026-09-11-product-features/exploration.md
IDENTICAL  .../archive/2026-09-11-product-features/design.md
IDENTICAL  .../archive/2026-09-11-product-features/tasks.md
IDENTICAL  .../archive/2026-09-11-product-features/verify-report.md
IDENTICAL  .../archive/2026-09-11-product-features/specs/telegram-bot/spec.md
IDENTICAL  .../archive/2026-09-11-product-features/specs/money-movements/spec.md
IDENTICAL  .../archive/2026-09-11-product-features/specs/movement-categories/spec.md
IDENTICAL  .../archive/2026-09-11-product-features/specs/dashboard-web/spec.md
all_files_byte_identical=True
```

3. **Recursive tree readback** — fresh recursive snapshot vs archived tree via `git diff --no-index` (real recursive diff engine; GNU `diff -r` is not on this host's PATH):
```
---DIFF-R-OUTPUT-BEGIN---
diff_exit=0 (0 = identical trees)
---DIFF-R-OUTPUT-END---
```
(Empty diff — the only passing evidence. Only benign CRLF normalization warnings were emitted, no difference hunks.)

The `archive-report.md` is additive and excluded from the comparisons (it did not exist in the pre-move snapshot).

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `specs/money-movements/spec.md` ✅
- `specs/movement-categories/spec.md` ✅
- `specs/dashboard-web/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (25/25 tasks complete, no unchecked implementation tasks)
- `verify-report.md` ✅ (verdict PASS WITH WARNINGS, evidence_revision `sha256:6b7aa449…a080`, corrected 26/26)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` remains).

## Delivery Status

The whole change lives on branch `feat/product-features` and is NOT pushed — the orchestrator handles push/PR decisions. Delivery forecast from `tasks.md`: single PR (maintainer-accepted size exception ~3500–4000 lines, `single-pr` strategy). Archive commits added on this branch:

- `da0d0fb` `docs(openspec): record product-features verify report and canonicalize delta scenarios`
- `7d846dc` `docs(openspec): sync product-features deltas into capability specs`
- (this archive commit) `docs(openspec): archive product-features change`

## Engram Mirror

Mirrored to Engram topic `sdd/2026-09-10-product-features/archive-report` (type `architecture`, `capture_prompt: false`, project `automatizaciongastos`). The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability):**
- **obs #292** — `sdd/2026-09-10-product-features/apply-progress` (topic), apply-progress F0–F4 DONE, 235/235 + 94/94 evidence, strict-TDD RED/GREEN narrative. Used to corroborate the Task Completion Gate. Updated at close to note the change is archived.
- **obs #300** — `sdd/2026-09-10-product-features/verify-report` mirror. **Carries the stale pre-correction summary `requirements: 24/24`**; the filesystem `verify-report.md` (corrected to 26/26, same evidence_revision) and the launch-prompt final-state facts supersede it. Flagged for the orchestrator; left unmodified as the filesystem report is authoritative in this repo.

No other Engram observations were read; all source artifacts were retrieved from the filesystem per the OpenSpec convention.

## Remaining Manual Steps

None. No CRITICAL or implementation WARNING findings; no post-delivery user-run steps remain (unlike the 2026-09-02 change, no real BotFather token smoke is outstanding — the offline-bot harness covers reply behavior).