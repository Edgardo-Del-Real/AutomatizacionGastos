# Archive Report — Planned Fixed Expenses (planned-fixed-expenses)

**Change**: `planned-fixed-expenses`
**Archived at**: 2026-09-28
**Artifact store**: openspec (OpenSpec filesystem; Engram mirror per orchestrator instruction)
**Archived to**: `openspec/changes/archive/2026-09-28-planned-fixed-expenses/`
**Archive type**: standard (full cycle completed, verified PASS WITH WARNINGS — 0 CRITICAL, 0 blockers; the single WARNING is an adjudicated, deliberate follow-up accepted by the orchestrator, no override required)

## Final State (at close)

Reported per the Final-State Authority hierarchy. `verify-report.md` and `apply-progress.md` are intermediate snapshots; final-state facts come from the orchestrator's launch prompt (verdict, test counts, commits, WARNING adjudication) corroborated by the persisted tasks artifact and repository evidence (branch `feat/multi-user-phase-2-dashboard`).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Verification verdict | **PASS WITH WARNINGS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:681e3171f423976cc6b6c6334d633f4c63ff3f42f5a05e15699c49610838078f`) |
| Requirements | 25/25 compliant (delta scope: 7 planned-fixed-expenses + 4 money-movements + 3 telegram-bot + 4 bot-brain + 6 dashboard-web + 1 movement-correction) |
| Scenarios | 100/100 compliant (delta scope, each with a passing covering test at runtime) |
| CRITICAL findings | 0 |
| Blockers | 0 |
| WARNING findings | 1 (adjudicated follow-up — SummarySection empty gate, see Follow-ups) |
| SUGGESTION findings | 3 (non-blocking; see Caveats) |
| API test suite | 814/814 (37 files), exit 0 |
| Dashboard test suite | 161/161 (23 files), exit 0 |
| Contracts build | exit 0 |
| Typecheck / Lint | contracts, api, dashboard all exit 0 |
| Real-DB e2e | planned e2e (`telegram.service.integration.test.ts`): `previsto:` ×3 both orders → 3 PENDING EXPENSE rows, KPIs exclude them, `planned.total` = 5200 answered from real data; mark-paid 200/409/404 transitions through `app.inject` + real Prisma on :5433 |
| Delivery | 4 chained-PR slices, 8 commits on `feat/multi-user-phase-2-dashboard`: `23798db`, `ecbee9f` (PR1 contracts+migration), `00c403e` (PR2 movements core), `f2c8483`, `09a761d` (PR3 telegram+goldens), `b0d5893`, `3d801f4`, `ee8673d` (PR4 dashboard) — **no push, no PR opened**; the user decides delivery separately |

**Task-count labeling note (recorded, not resolved silently)**: the persisted `tasks.md` artifact carries **21** numbered implementation-task lines (Phase 1: 4, Phase 2: 6, Phase 3: 5, Phase 4: 4, Phase 5: 2), all `[x]`, 0 open (verified by checkbox scan at archive time). The launch prompt and `verify-report.md` summarize the same work as **"20/20 tasks"**. Completion visibility is unanimous — no source shows an unchecked implementation task — so the Task Completion Gate passes; the 20-vs-21 difference is a count-labeling discrepancy (the summary counts exclude one of the numbered lines), not a completion-state contradiction. The persisted artifact (21/21 checked) is the authoritative completion record.

## Task Completion Gate

The persisted `tasks.md` was inspected BEFORE any spec sync or archive move: all implementation-task lines are `[x]` (1.1–5.2 across Phases 1–5), 0 unchecked. No archive-time reconciliation was required. The `## Review Workload Forecast` and `### Suggested Work Units` sections are planning metadata, not implementation tasks.

## Archive Readiness

Structured status was satisfied at launch: the orchestrator launched archive after verification passed, with the final-state handoff. The Task Completion Gate passed (above). Strict independent verification: `verify-report.md` shows 0 CRITICAL findings, 0 blockers, verdict pass — no CRITICAL override was needed or requested. The single WARNING is a deliberate follow-up (see Follow-ups), explicitly NOT part of this change. Ordinary repository policy (push/PR) decides delivery; it was not performed.

## Specs Synced

Delta scope: 6 capability files, 25 requirements / 100 scenarios merged into the canonical specs. No REMOVED or RENAMED deltas in this change; all deltas are ADDED or MODIFIED blocks, so no destructive merge warning applied (`openspec/config.yaml` `rules.archive` = "Warn before merging destructive deltas" — no destructive merge occurred).

| Domain | Action | Before → After (req/scn) | Details |
|--------|--------|--------------------------|---------|
| `planned-fixed-expenses` | **NEW domain** — full spec mechanically copied | 0/0 → 7/20 | `Movement Status Model`, `Planned Month Derivation`, `Planned Creation Guards`, `KPI Exclusion (PENDING_EXCLUDED)`, `Planned Summary Block`, `Mark Paid Transition`, `Planned Expense Creation Channels` |
| `money-movements` | MODIFIED ×2 + ADDED ×2 | 10/42 → 12/53 | `Movement Contracts` (+status schema/planned block, +3 scenarios), `Movement Summary Endpoint` (+PENDING exclusion, `planned` block + shape line, +4 scenarios), ADDED `Movement List Includes Planned Rows` (2 scn), `Planned Movement Editing` (2 scn) |
| `telegram-bot` | ADDED ×3 | 22/82 → 25/90 | `Planned Expense Registration (previsto: prefix)`, `Recent Movements Exclude Planned`, `Planned Query Routing` |
| `bot-brain` | MODIFIED ×4 | 11/30 → 11/34 | `Interpret Envelope Contract` (+`query_planned` intent, +1 scn), `Reply-After-Action Contract` (+`planned_month`/`planned_total`, +1 scn), `Intent Taxonomy` (+planned executor, +1 scn), `Prompt Contract` (+planned-query phrasings + in-cycle goldens, +1 scn) |
| `dashboard-web` | MODIFIED ×4 + ADDED ×2 | 9/30 → 11/38 | `Metrics Overview` (+planned section, +1 scn), `Movement List` (+PENDING/Previsto badge, +1 scn), `Movement Filters` (+no status filter, +1 scn), `Auto-Refresh After Mutations` (+mark-paid, +1 scn), ADDED `Planned Expense Creation (Agregar previsto)` (2 scn), `Mark Paid Action` (2 scn) |
| `movement-correction` | MODIFIED ×1 | 4/9 → 4/10 | `Movement Reference Matching` (+PENDING exclusion, +1 scn) |

**Preservation**: every requirement not mentioned in a delta was left byte-untouched (verified by requirement/scenario heading counts before and after: 0 net requirement loss, +56 canonical scenarios total — 70 requirements / 245 scenarios across the 6 touched domains). MODIFIED blocks replaced the full matching requirement including its preserved scenarios, per the OpenSpec convention. `(Previously: ...)` notes from the deltas were carried into the canonical specs.

## Archive Move

The entire change folder was moved mechanically with a native shell move. `git mv` was attempted first and failed (exit 128 — the change folder is fully untracked, so git cannot stage a directory move), the source was verified unchanged against the pre-move recursive snapshot, then a plain `mv` (`Move-Item`) was used. The source path was confirmed gone before the readback. The `archive-report.md` is additive and excluded from the comparison (it did not exist in the pre-move snapshot).

**Mandatory readback** (recursive pre-move snapshot vs archived tree; GNU `diff -r` is not on this host's PATH — the `diff` command is PowerShell's `Compare-Object` alias — so the repo-precedent `git diff --no-index --no-renames` recursive diff engine was used, the same engine the savings-rule archive validated: identical trees exit 0 with an empty diff):

```
---DIFF-R-OUTPUT-BEGIN---
snapshot created: %TEMP%\sdd-archive.<rand>\source
git mv exit: 128 (untracked folder — expected)
plain mv fallback used (source verified identical to snapshot)
READBACK diff exit: 0 (empty diff, byte-identical trees; only benign
 "LF will be replaced by CRLF" warnings on stderr — line-ending
 normalization notices, not content differences)
ARCHIVE_OK byte-identical (empty diff, exit 0)
---DIFF-R-OUTPUT-END---
```

(Empty diff — the only passing evidence. Both the fallback source-readback and the post-move destination readback exited 0 with no difference hunks.)

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/planned-fixed-expenses/spec.md` ✅
- `specs/money-movements/spec.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `specs/bot-brain/spec.md` ✅
- `specs/dashboard-web/spec.md` ✅
- `specs/movement-correction/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (21/21 implementation-task lines checked, 0 unchecked)
- `apply-progress.md` ✅
- `verify-report.md` ✅ (verdict PASS WITH WARNINGS, evidence_revision `sha256:681e3171…`)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` and the unrelated `multi-user-phase-2/` remain).

## Deviations Recorded During Apply (all closed/consistent per verify)

1. **`movementSummarySchema.planned` optional in PR1 → required in PR2** (closed). PR1 shipped it optional for chained-PR tree independence (dashboard runtime `safeParse` + typed `getSummary`); PR2 flipped it to REQUIRED alongside the `summaryPlanned` producer. The dashboard and telegram fixtures gained the additive `planned` field as a mechanical contract ripple. Verify confirms the required contract end-to-end (contracts test updated to assert rejection without `planned`).
2. **Telegram "otro" tail composes planned reply + category offer** (closed). `registerOtroWithCorrection` replies with `plannedReply(...) + " ¿Querés asignarle otra categoría?..."` rather than a bare `plannedReply` — preserving the correction-dialog offer while keeping the D11 honesty fact. The fixed-template fallback for the planned query is `plannedQueryReply` via the existing `queryReplyTemplate` switch (savings precedent).

Verify confirmed all deviations closed and consistent with the design decisions (D1–D11 coherence table: all "Yes").

## Follow-ups (tracked after archive)

**FOLLOW-UP 1 (WARNING, adjudicated — deliberate, NOT part of this change)**: the dashboard `SummarySection` empty gate (`mom.months.length === 0 && daily.length === 0`) renders "No hay movimientos aún." instead of children, so an owner whose ONLY movements are PENDING (all planned, nothing paid yet) never sees `summary.planned` (total > 0) or the "Agregar previsto" form — the feature's first-day usage path. `SummarySection.tsx` was deliberately excluded from the design file-change table to avoid scope creep; apply left it untouched. Verify adjudicated it as WARNING (no scenario test fails; gap is a gate-composition edge path) with an exact fix:

- **Option A (minimal)**: `const isEmpty = mom.months.length === 0 && daily.length === 0 && data.planned.total === 0;`
- **Option B (targeted, recommended)**: in `App.tsx`'s kpis tab, render `PlannedSection` from `summaryState` independently of the `SummarySection` empty gate, so the planned total + form always render on success while the empty state replaces only the KPI/chart sections.

This is a deliberate follow-up apply work-unit, tracked here so it survives archive. Not a blocker; the Metrics Overview MUST is scenario-level green with the data in hand.

## Caveats

- **WARNING 1 (follow-up, above)**: SummarySection empty gate can hide the planned section on the PENDING-only path — accepted as a deliberate follow-up, exact fix recorded.
- **SUGGESTION 1**: `PlannedSection.tsx` `monthLabel` fallbacks (`year ?? 1970`, `monthIndex ?? 1`) are unreachable for valid "YYYY-MM" keys (API contract pins the shape) — already documented in apply; no action needed.
- **SUGGESTION 2**: three `toBeDefined()` existence assertions in `bot-brain.test.ts` could add value assertions, though the semantic `find` predicates already make them meaningful.
- **SUGGESTION 3**: no coverage tooling configured in the workspace (`@vitest/coverage-v8` would enable changed-file coverage in future verifies) — informational.
- **Known Windows flakes (not regressions)**: prisma `EPERM` on `prisma generate` (query-engine DLL locked by a dev server) and cold-start migration-pin hook timeouts (`movements.status.integration.test.ts`, `savings.migration.integration.test.ts`) — both pass warm; pre-existing, documented in apply-progress PR 1/PR 3, not caused by this change.
- **Task-count labeling**: 21 persisted task lines vs "20/20" in summaries — see Final State note.

## Rollback Note (task 5.2)

Rollback of the 4 chained PRs (revert commits `23798db`→`ee8673d` in reverse order; PRs merge to main in order). Database rollback: `ALTER TABLE "Expense" DROP COLUMN "status"; DROP TYPE "MovementStatus";` — the migration backfilled existing rows as `PAID` via `NOT NULL DEFAULT` (default-only backfill, no explicit UPDATE), and the mark-paid transition rewrote only rows explicitly paid, so dropping the column loses no PAID-state information beyond the transient PENDING window. No feature flags; revert PR 1 (contracts + migration) first, then PR 2 (movements core), PR 3 (telegram), PR 4 (dashboard).

## Engram Mirror

Mirrored to Engram topic `sdd/planned-fixed-expenses/archive-report` (type `architecture`, `capture_prompt: false`, project `user`), per the orchestrator's instruction. The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability)**: none — this cycle ran in OpenSpec mode; all artifacts (proposal, design, tasks, apply-progress, verify-report, 6 delta specs, 5 existing canonical specs, savings-rule archive precedent) were read from the filesystem, which is authoritative. No Engram observation IDs apply.

No review artifacts exist for this change; no `reviewGate` receipt blocks archive (ordinary repository policy decides delivery).

## Remaining Manual Steps

None. No CRITICAL findings; the single WARNING is an adjudicated deliberate follow-up with an exact fix, tracked above. The change is fully implemented, verified, and archived. Orchestrator next step: the user decides delivery (push + PR for `feat/multi-user-phase-2-dashboard` — 4 chained PRs — or the session's configured delivery path) and may schedule FOLLOW-UP 1 as a new apply work-unit.