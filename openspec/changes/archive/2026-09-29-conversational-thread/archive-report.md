# Archive Report — Conversational Thread (conversational-thread)

**Change**: `conversational-thread`
**Archived at**: 2026-09-29
**Artifact store**: hybrid (OpenSpec filesystem authoritative + Engram mirror per orchestrator instruction)
**Archived to**: `openspec/changes/archive/2026-09-29-conversational-thread/`
**Archive type**: standard (full cycle completed, verification PASS — 0 CRITICAL, 0 WARNING, 0 blockers; no override requested or needed)

## Final State (at close)

Reported per the Final-State Authority hierarchy. `verify-report.md` and `apply-progress.md` are intermediate snapshots; final-state facts come from the orchestrator's launch prompt (commits, verdict, test counts, hard-constraint confirmations) corroborated by the persisted tasks artifact (28/28 `[x]`), native `gentle-ai sdd-status` (28/28 allComplete, `dependencies.archive: ready`, `nextRecommended: archive`, no blockedReasons), and repository evidence (branch `dev`).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → exploration → specs → design → tasks → apply → verify → archive) |
| Verification verdict | **PASS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:de51276576ba9dca99d29cd4ef04e375e6fb4ab6c2be9cdeda1504f7a9ed15a2`) |
| Requirements | 18/18 compliant (delta scope: 9 registration-collection + 4 telegram-bot + 5 bot-brain) |
| Scenarios | 81/81 compliant (each with a passing covering test at runtime) |
| CRITICAL findings | 0 |
| WARNING findings | 0 |
| SUGGESTION findings | 2 (non-blocking; see Caveats) |
| API test suite | 966/966 passed (37 files), exit 0 — run WITHOUT `-u` (goldens committed, no prompt drift) |
| Contracts build | `pnpm --filter @rita/contracts build` exit 0 |
| Typecheck / Lint | `tsc --noEmit` exit 0, `eslint src` exit 0 |
| Delivery | 5 commits on `dev`: `0dd64f1` (state+schema+templates), `a8e64b4` (entries+resolvers), `60cd8c5` (brain teaching), `68798a2` (integration e2e), `f63f6b5` (tasks marked complete) — **NOT pushed** (local `dev` ahead of `origin/dev`); the orchestrator/user decides delivery separately |
| Hard constraints | `awaiting_category` D6 suite byte-identical (SHA-256 `A62B90FAD25888D34E922D024D9BCA9BD1078CC77848BFD7F0CDE7475113E74D` on both old `cd76387` and HEAD blocks — non-conflation proof); `awaiting_registration` has own resolvers (distinct `d6DialogFallback`/`resolveDialog` branches); greeting reversal spec-signed; goldens regenerated in-cycle (2 new + 3 regenerated); no Prisma migration (`git diff cd76387..HEAD --name-only` has no migration/prisma paths) |

**Completion-state note (no discrepancy)**: all sources agree on 28/28 implementation tasks — the persisted `tasks.md` (28 `[x]` lines across Phases 1–5), `verify-report.md` (28/28), `apply-progress.md` (28 task rows), and native status (`taskProgress.completed: 28`). No count-labeling discrepancy like earlier cycles. The Task Completion Gate passes with no reconciliation.

## Task Completion Gate

The persisted `tasks.md` was inspected BEFORE any spec sync or archive move: all 28 implementation-task lines are `[x]` (1.1–5.1 across Phases 1–5), 0 unchecked (checkbox scan at archive time on the archived copy reconfirmed 28/28 checked, 0 unchecked). No archive-time reconciliation was required. The `## Review Workload Forecast` / `### Suggested Work Units` sections are planning metadata, not implementation tasks.

## Archive Readiness

Structured status was satisfied at launch: native `gentle-ai sdd-status conversational-thread --json --instructions` reported `dependencies.archive: ready`, `nextRecommended: archive`, `taskProgress.allComplete: true` (28/28), `applyState: all_done`, `remediationState.required: false`, no `blockedReasons`, and `actionContext.mode: repo-local` with `allowedEditRoots` covering the workspace — all archive operations stayed inside `C:\Users\user\Desktop\AutomatizacionRita`. No `reviewOffer` was present and none governs archive. Strict independent verification: `verify-report.md` shows 0 CRITICAL, 0 WARNING, verdict PASS — no CRITICAL override needed or requested. Ordinary repository policy (push/PR) decides delivery; it was not performed (per orchestrator instruction, git is left as-is, no commit made).

## Specs Synced

Delta scope: 3 capability files, 18 requirements / 81 scenarios merged into the canonical specs. No REMOVED or RENAMED deltas in this change; all deltas are MODIFIED blocks (telegram-bot, bot-brain) or a full new spec (registration-collection), so no destructive merge warning applied (`openspec/config.yaml` `rules.archive` = "Warn before merging destructive deltas" — no destructive merge occurred).

| Domain | Action | Details |
|--------|--------|---------|
| `registration-collection` | **NEW domain** — full spec mechanically copied | 0/0 → 9/18 | `Collect Dialog State and Payload`, `Deterministic Entry and Persistence`, `Amount-Answer Resolution`, `Category-Answer Cascade`, `Abandon Handling`, `Non-Consuming Intents`, `Restart and Corrupt-Payload Recovery`, `Deterministic-Only Mode`, `asked_registration Reply Action` |
| `telegram-bot` | MODIFIED ×4 | 26 req → 26 req (+7 scenarios) | `Success and Help Reply Content` (+asked_registration/greeting reply surfaces, +2 scn), `Per-Owner State Machine` (+`awaiting_registration`, +2 scn), `Intent-First Message Handling` (+greeting, null-amount collection, +1 scn), `Dialog Controller (Brain-Routed Dialogs)` (+collection resolve/abandon, +2 scn) |
| `bot-brain` | MODIFIED ×5 | 11 req → 11 req (+7 scenarios) | `Interpret Envelope Contract` (+`greeting` intent, null-amount validity, +2 scn), `Reply-After-Action Contract` (+`asked_registration` action, +1 scn), `Intent Taxonomy` (+greeting, collection entry, +1 scn), `Prompt Contract` (+greeting/collection teaching, +1 scn), `Dialog Action Contract` (+collection resolve classification, +2 scn) |

**Preservation**: every requirement not mentioned in a delta was left byte-untouched (verified by whole-file `diff --strip-trailing-cr` before/after for both merged canonicals — output showed ONLY the replaced MODIFIED blocks, nothing else changed). MODIFIED blocks replaced the full matching requirement including its preserved scenarios, per the OpenSpec convention. `(Previously: ...)` notes from the deltas were carried into the canonical specs.

**Merge mechanics and byte-identity evidence**: the delta files are LF and the canonical specs are CRLF; each MODIFIED block was spliced mechanically (no model re-generation of content) and normalized to the canonical CRLF convention so the merged files stay uniform. Per-block verification: `diff --strip-trailing-cr` between the delta block and the inserted block (EOL-insensitive) — **all 9 blocks exit 0** (telegram-bot 4/4, bot-brain 5/5). The full new `registration-collection` spec was copied with GNU `cp` → `diff -r` → `mv` (temp-diff exit 0, final-diff exit 0). `openspec/config.yaml` `rules.archive` was consulted ("Warn before merging destructive deltas") — no destructive delta existed.

## Archive Move

The entire change folder was moved mechanically with a native shell move. A recursive pre-move snapshot was taken first (`cp -R`). `git mv` succeeded on the first attempt (exit 0) — the folder contained the tracked `tasks.md` (committed in `f63f6b5`) plus untracked artifacts; git staged the `tasks.md` rename (`R100` in `git diff --cached`) and moved the untracked files physically. No plain-`mv` fallback was needed. The source path was confirmed gone before the readback. The `archive-report.md` is additive and excluded from the comparison (it did not exist in the pre-move snapshot).

**Mandatory readback** (recursive pre-move snapshot vs archived tree; GNU `diff -r` from Git's `usr/bin`, not PowerShell's `Compare-Object` alias):

```
---DIFF-R-OUTPUT-BEGIN---
snapshot created: %TEMP%\sdd-archive.<rand>\source
git mv exit: 0
READBACK diff exit: 0
ARCHIVE_MOVE_OK
---DIFF-R-OUTPUT-END---
```

(Empty diff — the only passing evidence. Exit 0, no difference hunks: byte-identical trees.)

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `specs/registration-collection/spec.md` ✅
- `specs/bot-brain/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (28/28 implementation-task lines checked, 0 unchecked)
- `apply-progress.md` ✅
- `verify-report.md` ✅ (verdict PASS, evidence_revision `sha256:de512765…`)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` and the unrelated `multi-user-phase-2/` remain).

## Deviations Recorded During Apply (all closed/consistent per verify)

1. **Locked-test deltas (spec-signed, deliberate)**: two previously-locked brain-orchestration tests (E2 category-unresolved) were updated WITH the spec delta to assert the collect entry instead of the otro fallback — allowed by design ("deliberate deltas only for locked suites"); the `awaiting_category` D6 suite is byte-untouched (the non-conflation proof). Documented in apply-progress; verify confirms.
2. **Off-topic fixtures reworded**: `:1675/1693` fixtures moved off "hola" (now greeting-classified) to genuinely off-topic text; the `off_topic` never-chats contract stays green plus new sibling pins proving `greeting` is a separate intent. Documented in apply-progress; verify confirms.
3. **Lint fix during 4.4**: one unused `reply` param in `resolveRegistrationAmount` removed (apply-progress issue 2). Closed.

Verify confirmed all deviations closed and consistent with design decisions D1–D8 (coherence table: all "Yes").

## Caveats

- **SUGGESTION 1** (verify-report): apply-progress "Total tests written: +66" does not sum from its own breakdown (8+6+38+4+6+5+5 = 72); arithmetic-only, no impact on evidence or verdict.
- **SUGGESTION 2** (verify-report): two baseline integration files (`movements.status.integration.test.ts`, `savings.migration.integration.test.ts`) timed out at 5000ms in an early baseline run but passed in the final full run — environmental timing, not code; consistent with the final 966/966 run.
- **No coverage tooling**: coverage analysis skipped per the verify contract (no coverage provider installed) — informational, not blocking.
- **EOL note**: canonical specs are CRLF, delta specs are LF; merged canonicals keep the canonical CRLF convention (git autocrlf normalizes at commit time). Block content is byte-identical modulo that EOL normalization.
- **Git state at close**: no commit was made (orchestrator handles commits/push). The mandated `git mv` staged the `tasks.md` rename (`R100`); the spec merges appear as unstaged modifications; the archive folder and new `registration-collection` canonical are untracked. Everything will be committed together by the orchestrator.

## Rollback Note

Additive change (per proposal rollback plan): remove the `awaiting_registration` state/schema/resolvers/teaching and restore goldens + locked-test deltas from git (`0dd64f1..f63f6b5`). No Prisma migration; stale collect rows degrade via corrupt-payload recovery (T10). Canonical spec sync is reversible by reverting the merged MODIFIED blocks in `openspec/specs/` (git-tracked files).

## Engram Mirror

Mirrored to Engram topic `sdd/conversational-thread/archive-report` (type `architecture`, `capture_prompt: false`), per the orchestrator's instruction. The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability)**: none — this cycle's artifacts (proposal, exploration, design, tasks, apply-progress, verify-report, 3 delta specs, 2 existing canonical specs) were all read from the filesystem, which is authoritative; native `gentle-ai sdd-status` corroborated readiness. No Engram observation IDs apply.

No review artifacts exist for this change; no `reviewGate` receipt blocks archive (ordinary repository policy decides delivery).

## Remaining Manual Steps

None. No CRITICAL findings, no WARNING findings. The change is fully implemented, verified, and archived. Orchestrator next step: the user decides delivery (push `dev` ahead of `origin/dev` — 5 commits `0dd64f1..f63f6b5` — plus the spec-merge and archive changes, committed together per the orchestrator's plan).