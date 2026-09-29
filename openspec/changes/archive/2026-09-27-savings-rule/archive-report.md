# Archive Report — Automatic Savings Split on Income (savings-rule)

**Change**: `savings-rule`
**Archived at**: 2026-09-27
**Artifact store**: hybrid (OpenSpec filesystem + Engram mirror)
**Archived to**: `openspec/changes/archive/2026-09-27-savings-rule/`
**Archive type**: standard (full cycle completed, verified PASS WITH WARNINGS — 0 CRITICAL, 0 blockers; two WARNING-level design-coherence gaps accepted as follow-ups by the orchestrator, no override required)

## Final State (at close)

Reported per the Final-State Authority hierarchy. `verify-report.md` and `apply-progress.md` are intermediate snapshots; final-state facts come from the orchestrator's launch prompt (verdict, test counts, commits, e2e results) corroborated by the persisted tasks artifact and repository evidence (branch `feat/multi-user-phase-2-dashboard` at HEAD `92bea85`).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Verification verdict | **PASS WITH WARNINGS** (`gentle-ai.verify-result/v1`, evidence_revision `sha256:3c2c21e5f92fdcc3efc2587f770be2771d6c462e42094ce8ca97cb721ffdc1ad`) |
| Requirements | 25/25 compliant (delta scope: 7 savings + 5 money-movements + 2 movement-categories + 4 bot-brain + 4 telegram-bot + 3 dashboard-web) |
| Scenarios | 90/90 compliant (delta scope, each with a passing covering test at runtime) |
| CRITICAL findings | 0 |
| Blockers | 0 |
| WARNING findings | 2 (design-coherence only, no spec scenario broken — accepted as follow-ups) |
| SUGGESTION findings | 3 (non-blocking; see Caveats) |
| API test suite | 732/732 (36 files), exit 0 |
| Dashboard test suite | 140/140 (22 files), exit 0 |
| Contracts build | exit 0 |
| Typecheck / Lint | API, dashboard, contracts all exit 0 |
| Real-DB e2e | INCOME 900 + SAVINGS 100 split; savings excluded from KPIs (income 900 / expenses 300 / balance 600); PATCH "ahorro" on EXPENSE/INCOME → 422 |
| Native attempt ledger | apply objective `complete`, verify objective `complete` (settled passed) |
| Delivery | 7 work-unit commits on `feat/multi-user-phase-2-dashboard` (`e4ae56b`, `34b5cd8`, `0fceed8`, `d133014`, `eab18ce`, `7fa01a5`, `92bea85`) — **no push, no PR**; delivery is orchestrated separately |

**Task-count labeling note (recorded, not resolved silently)**: the persisted `tasks.md` artifact carries **23** numbered implementation-task lines, all `[x]`, 0 open (verified by checkbox scan at archive time). The `apply-progress.md`, `verify-report.md`, and the launch prompt summarize the same work as **"20/20 tasks"**. Completion visibility is unanimous — no source shows an unchecked implementation task — so the Task Completion Gate passes; the 20-vs-23 difference is a count-labeling discrepancy, not a completion-state contradiction. The persisted artifact (23/23 checked) is the authoritative completion record.

## Task Completion Gate

The persisted `tasks.md` was inspected BEFORE any spec sync or archive move: all implementation-task lines are `[x]` (1.1–7.1 across Phases 1–7), 0 unchecked. The Engram `tasks` mirror (obs #440, revision 4) also shows all `[x]` — the mirror was updated post-apply, so no stale pre-apply snapshot exists this cycle. No archive-time reconciliation was required. The `## Review Workload Forecast` and `### Work Units` sections are planning metadata, not implementation tasks.

## Specs Synced

Delta scope: 6 capability files, 25 requirements / 90 scenarios merged into the canonical specs. No REMOVED or RENAMED deltas in this change; all deltas are ADDED or MODIFIED blocks, so no destructive merge warning applied (`openspec/config.yaml` `rules.archive` = "Warn before merging destructive deltas" — no destructive merge occurred).

| Domain | Action | Before → After (req/scn) | Details |
|--------|--------|--------------------------|---------|
| `savings` | **NEW domain** — full spec mechanically copied | 0/0 → 7/17 | `SavingsRule Model`, `SavingsRule Definition Channel`, `Income Split and Rounding`, `SHARED Inheritance`, `Deterministic Overrides`, `KPI-Exclusion Invariants`, `Month Savings Query` |
| `money-movements` | MODIFIED ×5 | 10/36 → 10/42 | `Movement Type Model` (+SAVINGS type stored), `Movement Contracts` (+SAVINGS list-filter scenario, `kpis.savings`/`mom[].savings`), `Movement List Endpoint` (+SAVINGS filter), `Movement Summary Endpoint` (+excluded-from-sums, +month-scoped savings), `Movement Update Endpoint` (+SAVINGS-category 422 guard) |
| `movement-categories` | ADDED ×2 | 5/12 → 7/18 | `Category Type` (ahorro always SAVINGS, legacy conversion, delete/rename guards), `SAVINGS Category Assignment Guard` |
| `bot-brain` | MODIFIED ×4 | 11/26 → 11/30 | `Interpret Envelope Contract` (+`create_savings_rule` intent), `Reply-After-Action Contract` (+gross/net/savings facts), `Intent Taxonomy` (+savings-rule redirect), `Prompt Contract` (+savings instruction + in-cycle goldens) |
| `telegram-bot` | ADDED ×4 | 18/70 → 22/82 | `Savings Rule Command`, `Savings Split on Income Registration`, `Registration Overrides`, `Savings Query Routing` |
| `dashboard-web` | MODIFIED ×3 | 9/26 → 9/30 | `Metrics Overview` (+Ahorrado card ×2), `Movement List` (+SAVINGS badge), `Movement Filters` (+Ahorro option) |

**Preservation**: every requirement not mentioned in a delta was left byte-untouched (verified by requirement/scenario heading counts before and after: 0 net requirement loss, +36 canonical scenarios total). MODIFIED blocks replaced the full matching requirement including its preserved scenarios, per the OpenSpec convention. `(Previously: ...)` notes from the deltas were carried into the canonical specs.

## Archive Move

The entire change folder was moved mechanically with a native shell move. `git mv` was attempted first and failed (exit 128, "source directory is empty" — the change folder is fully untracked, so git cannot stage a directory move), the source was verified unchanged against the pre-move snapshot, then a plain `mv` (`Move-Item`) was used. The source path was confirmed gone before the readback. The `archive-report.md` is additive and excluded from the comparison (it did not exist in the pre-move snapshot).

**Mandatory readback** (recursive pre-move snapshot vs archived tree; GNU `diff -r` is not on this host's PATH, so the repo-precedent `git diff --no-index --no-renames` recursive diff engine was used — the `--no-renames` flag is required because plain `git diff --no-index` between directories performs rename detection and exits 1 on 100%-similarity renames even for byte-identical trees; verified in isolation that identical trees exit 0 with an empty diff):

```
---DIFF-R-OUTPUT-BEGIN---
(no diff hunks — only benign "LF will be replaced by CRLF" warnings, which are
 line-ending normalization notices, not content differences)
READBACK_OK diff_exit=0 (empty diff, byte-identical trees)
---DIFF-R-OUTPUT-END---
```

(Empty diff — the only passing evidence. Both the fallback source-readback and the post-move destination readback exited 0 with no difference hunks.)

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/savings/spec.md` ✅
- `specs/money-movements/spec.md` ✅
- `specs/movement-categories/spec.md` ✅
- `specs/bot-brain/spec.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `specs/dashboard-web/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (23/23 implementation-task lines checked, 0 unchecked)
- `apply-progress.md` ✅
- `verify-report.md` ✅ (verdict PASS WITH WARNINGS, evidence_revision `sha256:3c2c21e5…`)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` and the unrelated `multi-user-phase-2/` remain).

## Delivery Status

The implementation lives on branch `feat/multi-user-phase-2-dashboard` (HEAD `92bea85`, 7 work-unit commits: `e4ae56b` contracts+migration, `34b5cd8` savings slice+guards, `0fceed8` D1–D3 exclusion, `d133014` PATCH guard+atomic split, `eab18ce` telegram flow+goldens, `7fa01a5` dashboard surface, `92bea85` split e2e). **No push, no PR** — delivery is orchestrated separately per session instructions. The archive work (canonical spec sync + archive move + this report) is uncommitted local state on the same branch.

## Caveats

- **WARNING 1 (accepted follow-up)**: design D8 not honored — `SavingsRuleService.resolveSplit` applies a "con X%" override even with NO matching rule (rule-free split). Spec-compatible (no spec scenario covers "con X%" without a rule) but deviates from the settled design decision. The orchestrator accepted it as a follow-up; it is not a blocker.
- **WARNING 2 (accepted follow-up)**: frozen `POST /expenses` can still write "ahorro" on EXPENSE/INCOME rows — the guard covers PATCH and bot registration paths only; `createMovementSchema` admits `type:"SAVINGS"` and the route never calls `assertOwnerCategory`. Accepted and documented in apply-progress.
- **SUGGESTION 1**: KpiCards renders 5 cards while the dashboard-web spec enumerates 8 — pre-existing divergence (baseline rendered 4 of the enumerated 7 before this change); the Ahorrado delta itself is implemented and tested.
- **SUGGESTION 2**: pre-existing concurrency flake in `telegram.service.integration.test.ts` (10s `beforeAll` hookTimeout under parallel `prisma migrate deploy` contention) — reproduced at baseline, not caused by this change.
- **SUGGESTION 3**: `resolveSplit` return shape differs from the design interface sketch (documented in apply-progress; behaviorally equivalent).
- **Task-count labeling**: 23 persisted task lines vs "20/20" in summaries — see Final State note.

## Engram Mirror

Mirrored to Engram topic `sdd/savings-rule/archive-report` (type `architecture`, `capture_prompt: false`, project `automatizaciongastos`). The OpenSpec `archive-report.md` file is authoritative.

**Engram observations read for this archive (traceability):**
- **obs #437** — `sdd/savings-rule/proposal` mirror. Matches the filesystem proposal.md.
- **obs #438** — `savings-rule spec phase: domain division and kpis.savings semantics` (decision-type observation; the spec phase persisted a decision note rather than a `sdd/savings-rule/spec` mirror — no spec mirror topic exists. The 6 delta spec files were read from the filesystem, which is authoritative.)
- **obs #439** — `sdd/savings-rule/design` mirror. Matches the filesystem design.md (D1–D12).
- **obs #440** — `sdd/savings-rule/tasks` mirror (revision 4, post-apply). All `[x]`; matches the filesystem tasks.md.
- **obs #442** — `sdd/savings-rule/apply-progress` mirror. Corroborates the Task Completion Gate and the 732/140 test evidence.
- **obs #445** — `sdd/savings-rule/verify-report` mirror. Verdict PASS WITH WARNINGS, 25/25 / 90/90 / 20/20 claims, 872/872 tests; matches the filesystem report.
- **obs #441, #446** — intermediate phase discoveries surfaced by search (tasks-scope verification; verify-phase D8 deviation discovery); previews only, not used as source material.

No review artifacts exist for this change; no `reviewGate` receipt blocks archive (ordinary repository policy decides delivery).

## Remaining Manual Steps

None. No CRITICAL findings; both WARNING-level design-coherence gaps are accepted follow-ups. The change is fully implemented, verified, and archived. Orchestrator next step: deliver (push + PR for `feat/multi-user-phase-2-dashboard`, or the session's configured delivery path).