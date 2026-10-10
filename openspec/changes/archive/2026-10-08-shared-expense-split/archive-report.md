# Archive Report: shared-expense-split

**Archived**: 2026-10-08
**Artifact store**: openspec
**Archive path**: `openspec/changes/archive/2026-10-08-shared-expense-split/`
**Status**: archived (SDD cycle complete)

## Final State (at close)

This report reflects the state of the change AT CLOSE, not intermediate snapshots.

| Fact | Value |
|------|-------|
| Tasks | 25/25 complete (`tasks.md`, all `- [x]`) |
| Requirements | 17/17 covered |
| Scenarios | 64/64 covered |
| Verification verdict | `pass` (0 CRITICAL, 0 WARNING, 0 blockers) |
| Typecheck | green (`pnpm typecheck`) |
| Lint | green (`pnpm lint`) |
| Build | green (`pnpm --filter @rita/api build`) |
| Migration | `20261008120000_shared_expense_split` DEPLOYED to the main database; nullable `sharedTotal` column is live |
| Backfill | none — additive nullable column, no data destruction, no backfill |
| Post-verify changes | none — no fixes, commits, or PRs after `verify-report` was persisted |

Nothing in the change was modified after `verify-report.md` was written. The orchestrator's final-state handoff is the most recent authoritative account and is corroborated by the persisted `tasks.md` (25/25 `[x]`) and the `verify-report` verdict (`pass`, 0 CRITICAL).

## Specs Synced (delta merge)

All deltas were additive or non-destructive. **No destructive delta was merged** — the single schema change is a nullable additive column with no backfill (per `openspec/config.yaml` `rules.archive` "Warn before merging destructive deltas"; nothing required that warning).

| Capability | Action | Details |
|------------|--------|---------|
| `shared-expense-split` | **Created** | New capability; full spec copied byte-identically into `openspec/specs/shared-expense-split/spec.md` (8 requirements, 23 scenarios) |
| `quick-capture` | **Updated** | 2 MODIFIED requirements replaced by name (`Capture Preview with Save/Correct`, `Type Selection by Menu`); +1 scenario ("Compartido Guardar is also gated on the percent"), +1 scenario ("Compartido without a partner stays single") |
| `telegram-bot` | **Updated** | 1 MODIFIED requirement replaced by name (`Per-Owner State Machine`: new `awaiting_shared_percent` state, `sharedPercent?` payload field, COMPARTIDO `[Otro]` transition, new "(Previously:)" note), +1 scenario ("Shared Otro percent input returns to the confirmation"); ADDED requirement `Shared Split Confirmation Annotation` appended |
| `bot-inline-interactions` | **Updated** | 1 MODIFIED requirement replaced by name (`Callback Query Routing`: `sp:*` family added), +1 scenario ("Shared row callback routes"); ADDED requirement `Shared Confirmation Keyboard Budgets` appended |
| `money-movements` | **Updated** | ADDED requirement `Shared Total Movement Field` appended (3 scenarios) |
| `savings` | **Updated** | 1 MODIFIED requirement replaced by name (`SHARED Inheritance`), scenario "Compartido captures never split" → "Compartido creates no SAVINGS movement" |
| `dashboard-web` | **Updated** | ADDED requirement `Shared Split Amount Annotation` appended (3 scenarios) |

Every requirement heading, scenario heading, and "(Previously:)" note from each delta is present in its main spec (verified programmatically). All unrelated pre-existing requirements were preserved.

## Mechanical Copy Evidence

Archival used shell operations only (no model Read→Write of artifact bytes). Readback comparison: pre-move recursive snapshot vs. archived destination.

```
new capability spec (openspec/specs/shared-expense-split/spec.md):
  DIFF_EXIT=0   (git diff --no-index; no content differences)
  -> NEW_SPEC_HASH_MATCH=True (SHA256 source == destination)

archive move (openspec/changes/shared-expense-split -> archive/2026-10-08-shared-expense-split):
  GIT_MV_EXIT=128  "fatal: source directory is empty" (source is untracked; git treats it as empty)
  FALLBACK_MV_USED=true  (source verified unchanged vs snapshot, then plain mv)
  ARCHIVE_DIFF_EXIT=0
  ARCHIVE_DIFF_OUTPUT_START
  ARCHIVE_DIFF_OUTPUT_END   (empty — byte-identical)
```

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (7: shared-expense-split + 6 deltas)
- `design.md` ✅
- `tasks.md` ✅ (25/25 tasks complete)
- `apply-progress.md` ✅
- `verify-report.md` ✅
- `exploration.md` ✅

## Accepted Consequences (documented, not defects)

- Two SHARED rows replace one `total` row: under `visibility=mine` a viewer's KPIs show only that viewer's share, while `all`/`shared` still sum to the total (asserted per-viewer in `movements.route.test.ts`).
- Each split half is an independent movement with no linking column (`sharedGroupId` out of scope): editing/deleting one half orphans the other and the annotation no longer reconciles. Documented follow-up.

## Follow-ups (out of change scope)

Two PRE-EXISTING baseline test failures, proven at HEAD and untouched by this diff; neither is caused by this change. They are recorded as follow-ups, NOT as part of this archive:

1. `apps/api/src/features/telegram/telegram.service.test.ts:724` — stale `kb[0][0] === "Cafe"` assertion from the two-step-confirmation refactor.
2. `apps/dashboard/src/features/movements/SummarySection.test.tsx:122` — stale `$ 3.000,00` currency fixture.

## Delivery

Not delivered by this phase. No commits and no PRs were created; delivery is intentionally left to the user under ordinary repository policy.

## Notes on Snapshot Attribution

Per the Final-State Authority hierarchy, `apply-progress.md` and `verify-report.md` are intermediate snapshots. Their "done" claims remain valid. Their test counts and the two baseline findings above were re-stated from the orchestrator's final-state handoff, which is the most recent account and outranks the snapshots; no post-verify work changed them. No unrankable contradiction was found between sources.
