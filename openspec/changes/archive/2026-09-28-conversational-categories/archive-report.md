# Archive Report — Conversational Categories (conversational-categories)

**Change**: `conversational-categories`
**Archived at**: 2026-09-28
**Artifact store**: openspec (OpenSpec filesystem; Engram mirror per orchestrator instruction)
**Archived to**: `openspec/changes/archive/2026-09-28-conversational-categories/`
**Archive type**: standard (full cycle completed, verified PASS — 0 CRITICAL, 0 WARNING, 0 blockers)

## Final State (at close)

Reported per the Final-State Authority hierarchy. `verify-report.md` and `apply-progress.md` are intermediate snapshots; final-state facts come from the orchestrator's launch prompt (verdict, test counts, commits, deviation adjudication) corroborated by the persisted tasks artifact and repository evidence (branch `feat/multi-user-phase-2-dashboard`).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Verification verdict | **PASS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:a615ba2076d842e259b298936af488562ea1ce1edb6d5eddaf656f60aac539c8`) |
| Requirements | 15/15 compliant (delta scope: 5 conversational-categories + 3 movement-categories + 1 savings + 2 telegram-bot + 4 bot-brain) |
| Scenarios | 58/58 compliant (delta scope, each with a passing covering test at runtime) |
| CRITICAL findings | 0 |
| WARNING findings | 0 |
| Blockers | 0 |
| SUGGESTION findings | 3 (non-blocking spec polish; see Caveats) |
| API test suite | 886/886 (37 files), exit 0 |
| Dashboard test suite | 161/161 (23 files), exit 0 |
| Typecheck / Lint | api + dashboard all exit 0 (four commands) |
| Delivery | One PR boundary (`size:exception`), 5 work-unit commits on `feat/multi-user-phase-2-dashboard`: `68a085a` (matcher fold), `c5d50b5` (reserved guards), `62ba724` (savings tolerant), `1a78e4c` (envelope+goldens), `4c88c42` (telegram funnel) — **NOT pushed, no PR**; the user decides delivery separately |

## Task Completion Gate

The persisted `tasks.md` was inspected BEFORE any spec sync or archive move: all 17 implementation-task lines are `[x]` (1.1–5.5 across Phases 1–5), 0 unchecked. No archive-time reconciliation was required. The `## Review Workload Forecast` and `## Work Units` sections are planning metadata, not implementation tasks.

## Archive Readiness

Structured status was satisfied at launch: the orchestrator launched archive after verification passed, with the final-state handoff. The Task Completion Gate passed (above). Strict independent verification: `verify-report.md` shows 0 CRITICAL findings, 0 WARNING, 0 blockers, verdict pass — no override was needed or requested. Ordinary repository policy (push/PR) decides delivery; it was not performed.

## Specs Synced

Delta scope: 5 capability files, 15 requirements / 58 scenarios merged into the canonical specs. No REMOVED or RENAMED deltas in this change; all deltas are ADDED or MODIFIED blocks (plus one NEW domain), so no destructive merge warning applied (`openspec/config.yaml` `rules.archive` = "Warn before merging destructive deltas" — no destructive merge occurred).

| Domain | Action | Before → After (req/scn) | Details |
|--------|--------|--------------------------|---------|
| `conversational-categories` | **NEW domain** — full spec mechanically copied (`cp` → `diff` → `mv`, exit 0) | 0/0 → 5/14 | `Reserved Concept Guard`, `Tolerant Plural Matching`, `Duplicate-Variant Rejection`, `Gated Dialog Auto-Create`, `Suggester Ceiling` |
| `movement-categories` | MODIFIED ×2 + ADDED ×1 | 7/18 → 8/25 | `Keyword Learning and Matching` (fold on both sides +2 scn), `Category Type` (`ahorros` folded rejection +1 scn), ADDED `Reserved and Duplicate-Variant Guards` (4 scn) |
| `telegram-bot` | ADDED ×1 + MODIFIED ×1 | 25/90 → 26/96 | ADDED `Guarded Category Creation Funnel` (4 scn), `Planned Expense Registration (previsto: prefix)` (prefix authoritative over flag, +2 scn) |
| `bot-brain` | MODIFIED ×4 | 11/34 → 11/37 | `Bot Brain Port` (+`planned` flag), `Interpret Envelope Contract` (+`planned` schema field +1 scn), `Category Suggestion Contract` (+planned suggestion-only +1 scn), `Prompt Contract` (+planned-flag teaching +1 scn) |
| `savings` | ADDED ×1 | 7/17 → 8/21 | `Tolerant Rule Matching` (`matchNote` folds both sides, 4 scn) |

**Preservation**: every requirement not mentioned in a delta was left byte-untouched (verified by requirement/scenario heading counts before and after). MODIFIED blocks replaced the full matching requirement including its preserved scenarios, per the OpenSpec convention. `(Previously: ...)` notes from the deltas were carried into the canonical specs.

## Archive Move

The entire change folder was moved mechanically with a native shell move. `git mv` was attempted first and failed (exit 128 — the change folder is fully untracked, so git cannot stage a directory move; git reports "source directory is empty"), the source was verified unchanged against the pre-move recursive snapshot (fallback source diff exit 0), then a plain `mv` (`Move-Item`) was used. The source path was confirmed gone before the readback. The `archive-report.md` is additive and excluded from the comparison (it did not exist in the pre-move snapshot).

**Mandatory readback** (recursive pre-move snapshot vs archived tree; GNU `diff -r` is not on this host's PATH — the `diff` command is PowerShell's `Compare-Object` alias — so the repo-precedent `git diff --no-index --no-renames` recursive diff engine was used, the same engine the savings-rule and planned-fixed-expenses archives validated: identical trees exit 0 with an empty diff):

```
---DIFF-R-OUTPUT-BEGIN---
GIT_MV_EXIT=128 (untracked folder — expected)
FALLBACK_SOURCE_DIFF_EXIT=0 (source identical to pre-move snapshot)
PLAIN_MV_USED
SOURCE_GONE=yes
READBACK_DIFF_EXIT=0 (empty diff, byte-identical trees; only benign
 "LF will be replaced by CRLF" warnings on stderr — line-ending
 normalization notices, not content differences)
ARCHIVE_OK byte-identical (empty diff, exit 0)
---DIFF-R-OUTPUT-END---
```

(Empty diff — the only passing evidence. Both the fallback source-readback and the post-move destination readback exited 0 with no difference hunks.)

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `research.md` ✅
- `specs/conversational-categories/spec.md` ✅
- `specs/movement-categories/spec.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `specs/bot-brain/spec.md` ✅
- `specs/savings/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (17/17 implementation-task lines checked, 0 unchecked)
- `apply-progress.md` ✅
- `verify-report.md` ✅ (verdict PASS, evidence_revision `sha256:a615ba2076…`)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` and the unrelated `multi-user-phase-2/` remain).

## Deviations Recorded During Apply (all adjudicated COMPLIANT per verify)

1. **Duplicate-variant "gastos fijos" scenario shadowed by the reserved guard** (COMPLIANT). The spec scenario "Variant create rejected" with `gasto fijo`/`gastos fijos` is unreachable through the duplicate-variant mechanism because the reserved guard rejects `gastos fijos` first (concept `gasto fijo`) — itself spec-mandated. The folded-availability mechanism is pinned with the non-reserved pair `transporte`/`transportes` (create) and `cafe`/`cafes` (rename), all passing. The observable contract (rejected, no category created) holds.
2. **Telegram money-pin uses "cobro sueldos" vs matchNote "cobré sueldos"** (COMPLIANT). The savings spec scenario text `cobré sueldos` is pinned VERBATIM at the `matchNote` level; the telegram-layer pin uses `cobro sueldos 1000` because the arrival parser (untouched by this change) classifies `cobré` as EXPENSE. Split behavior through the real service holds (INCOME 900 / SAVINGS 100 on gross 1000).
3. **`reservedCategoryReply` includes the attempted name in every concept branch** (COMPLIANT). Design's per-concept wording is preserved verbatim inside each branch; the name prefix is an additive clarity choice consistent with the "educational redirect" intent.

Verify confirmed all three adjudicated COMPLIANT against the actual spec scenarios; none breaks a spec.

## Caveats

- **SUGGESTION 1** (spec polish): the "Variant create rejected" scenarios use the reserved pair `gasto fijo`/`gastos fijos`, which the reserved guard shadows by design. A one-line spec note ("reserved-first wins; the duplicate-variant mechanism is pinned with non-reserved pairs") would help future readers.
- **SUGGESTION 2** (spec polish, savings): the telegram-layer money pin text differs from the scenario wording (`cobro` vs `cobré`) because the parser domain is untouched; the `matchNote`-level pin matches the spec verbatim. Consider noting the layer split.
- **SUGGESTION 3** (environment, not a regression): pre-existing Windows flakes (prisma `EPERM` on `generate`, cold migration-pin timeout) were warm-passing in both verify runs; confirmed not introduced by this change.
- **No CRITICAL, no WARNING findings.** No coverage tool configured in the workspace (informational, not a failure).

## Rollback Note

Change is NOT pushed and has no PR: rollback = revert the 5 local work-unit commits (68a085a matcher fold, c5d50b5 reserved guards, 62ba724 savings tolerant, 1a78e4c envelope+goldens, 4c88c42 telegram funnel) or `git reset --hard ee8673d` (the base). No DB migration exists; stored keywords, names, and uniques are unchanged; `deleteCategory` gained no new reserved names, so pre-change phantoms remain deletable. Per-PR revert boundaries are documented in tasks.md and apply-progress Work Unit Evidence.

## Engram Mirror

Mirrored to Engram topic `sdd/conversational-categories/archive-report` (type `architecture`, `capture_prompt: false`, project `user`), per the orchestrator's instruction. The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability)**: none — this cycle ran in OpenSpec mode; all artifacts (proposal, exploration, research, design, tasks, apply-progress, verify-report, 5 delta specs, 5 existing canonical specs, savings-rule + planned-fixed-expenses archive precedents) were read from the filesystem, which is authoritative. No Engram observation IDs apply.

No review artifacts exist for this change; no `reviewGate` receipt blocks archive (ordinary repository policy decides delivery).

## Remaining Manual Steps

None. No CRITICAL or WARNING findings; the 3 SUGGESTIONs are spec-polish and environment notes requiring no action for archive. The change is fully implemented, verified, and archived. Orchestrator next step: the user decides delivery (push + PR for `feat/multi-user-phase-2-dashboard` — the 5 work-unit commits within one `size:exception` PR boundary — or the session's configured delivery path).