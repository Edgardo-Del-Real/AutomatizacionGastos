# Archive Report — manual-savings

**Change**: manual-savings
**Archived**: 2026-10-12
**Branch/HEAD**: `feat/manual-savings-pr3` @ `76b1b78` (stacked `dev`→PR1→PR2→PR3, 11 commits `dev..HEAD`; branches preserved — delivery pending)
**Store**: hybrid — OpenSpec filesystem + Engram topic `sdd/manual-savings/archive-report`
**Status**: success — SDD cycle closed

## Final State (at close)

- Tasks: **30/30 implementation task checkboxes marked `[x]`** in the persisted `tasks.md` (1.1–1.6, 2.1–2.13, 3.1–3.10, 4.1). 0 unchecked. No stale-checkbox reconciliation was needed or performed.
- Verification: **PASS** — `verify-report.md` (schema `gentle-ai.verify-result/v1`), verdict `pass`, blockers 0, `critical_findings` 0, requirements **12/12**, scenarios **74/74** (manual-savings 5/18, savings 1/3, money-movements 3/43, bot-manage-savings 1/3, bot-main-menu 2/7), evidence_revision `sha256:e93c7e1a56bb31f363b9fad3fe3d1ba9413b7d9262afb2c3c3b3826e1fb3e99a`.
- **Correction (post-apply-progress)**: commit `76b1b78` `test(dashboard): add required kpis.manualSavings to summary fixtures` — 10 fixture sites in 6 dashboard test files (lockstep for REQUIRED `kpis.manualSavings`, design decision D4). This resolved the CRITICAL-1 that the earlier FAIL revision of the verify report recorded; the FAIL revision is superseded by the PASS revision. Per the archive policy the archive keeps only the PASS report as the final state, with this short note that CRITICAL-1 was found and fixed.
- Final sweep (root commands): contracts build exit 0; api suite **1045/1046** with the SOLE pre-existing failure `telegram.service.test.ts › selects a category via cat:<id>` (unchanged, verified not caused by this change — out of scope, tracked separately); root `pnpm typecheck` exit 0 (all 3 packages: contracts, api, dashboard); root `pnpm lint` exit 0. Output hashes recorded in `verify-report.md` (test `sha256:5763…2fe5f`, contracts build `sha256:e06b…fd967`, typecheck `sha256:d9fc…a56c0`, lint `sha256:2503…e2284`).
- No drift from the change surface: `savingsOrigin` discriminator (NULL = legacy, inert), MANUAL-only balance deduction, additive contracts, bot entries (`sa:manual` + `registrar ahorro manual:`), dashboard read-only by design.
- No blockers at close, no intentional archive overrides in effect, no destructive (REMOVED) delta merged (config `rules.archive` satisfied — no warning needed).

## Advisories Carried Into the Archive (from verify-report PASS)

- **WARNING-1**: PR3 = 586 changed lines (573 add + 13 del) vs ~255 forecast → exceeds the 400-line review guard → process as `size:exception` at delivery (PR creation).
- **WARNING-2**: slice sweeps ran API-scoped typecheck only; root `pnpm typecheck` should run every slice (this let CRITICAL-1 through two slice gates).
- **SUGGESTION-1**: when a shared contract adds a REQUIRED `kpis` field, update dashboard `MovementSummary`-typed test fixtures in the same work unit (mechanical root `pnpm typecheck` per slice).

## Artifacts Read (traceability)

- `openspec/changes/manual-savings/proposal.md`
- `openspec/changes/manual-savings/exploration.md`
- `openspec/changes/manual-savings/specs/` — all 5 delta/full specs (`manual-savings` NEW full spec, `money-movements`, `savings`, `bot-manage-savings`, `bot-main-menu`)
- `openspec/changes/manual-savings/design.md` (decisions D1–D10)
- `openspec/changes/manual-savings/tasks.md` (30/30 checked)
- `openspec/changes/manual-savings/verify-report.md` (PASS revision)
- Engram topics referenced via orchestrator final-state facts and search metadata (previews only, not full reads — the launch prompt carried the authoritative final state): `sdd/manual-savings/apply-progress` obs **#631** (sync `obs-40bfd4baf265bb31`, PR1→PR2→PR3→correction) and `sdd/manual-savings/verify-report` obs **#635** (sync `obs-da84aa0192ae544f`, PASS after correction `76b1b78`).
- Canonical specs synced: `openspec/specs/{savings,money-movements,bot-manage-savings,bot-main-menu}/spec.md` (pre-merge bytes preserved in the archive working snapshot; no uncommitted canonical changes existed before this archive's merge — confirmed via the snapshot taken at splice start).
- Config: `openspec/config.yaml` (`rules.archive`: warn before merging destructive deltas — no REMOVED blocks exist in this change, so no destructive merge occurred).

## Spec Sync (delta → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| manual-savings | **Created (new capability)** | Full spec copied byte-identically via shell `cp` + `git diff --no-index` readback (exit 0, empty diff) into `openspec/specs/manual-savings/spec.md` — repo pattern confirmed from `shared-expense-split` / `bot-manage-savings` archives |
| money-movements | Updated | 3 MODIFIED blocks replaced wholesale (Movement Contracts + savingsOrigin contract, Movement Summary Endpoint + balance formula/kpis.manualSavings, Movement Update Endpoint + MANUAL category pin); 15 untouched blocks preserved |
| savings | Updated | 1 MODIFIED block replaced (KPI-Exclusion Invariants — MANUAL-only deduction, no double-count) |
| bot-manage-savings | Updated | 1 MODIFIED block replaced (Sub-Menu Entry — three → four actions) |
| bot-main-menu | Updated | 2 MODIFIED blocks replaced (setMyCommands Registration + `registrar_ahorro_manual`, Static Help + manual-savings command mention) |

Merge method: mechanical, byte-exact Python block splicing (never routed through model Read/Write for content). Each MODIFIED delta block replaced the matching canonical requirement block wholesale — heading, body, `(Previously: …)` note, and scenarios — per the OpenSpec convention. Line endings: canonical specs are CRLF (git autocrlf=true); deltas are LF; spliced content was converted to the canonical's CRLF and verified: **no mixed-EOL drift** (pre and post each have 0 lone-LF lines), **untouched blocks byte-identical**, and the merged file matched an independently derived expectation (raw byte-slice replacement algorithm) **byte for byte**. All 7 spliced headings present exactly once; single blank-line separator preserved before each following heading. Requirements not mentioned in the deltas were preserved verbatim (e.g. money-movements Movement Type Model, Message Income Detection, Viewer-Scoped Read Predicate, Visibility Filter Parameter, Shared Total Movement Field; savings SavingsRule Model, Income Split and Rounding, SHARED Inheritance, Tolerant Rule Matching, Month Savings Query; bot-manage-savings Create/List/Delete Rule; bot-main-menu Main Menu Actions, Post-Action Menu Return).

New capability (`manual-savings`): 5 requirements / 18 scenarios — Savings Origin Model, Manual Savings Creation, Balance Deduction Invariant, Bot Sub-Menu Action, Bot Text Command.

## Archive

- Moved `openspec/changes/manual-savings/` → `openspec/changes/archive/2026-10-12-manual-savings/`. The change folder is entirely **untracked** (`??` in `git status`), so `git mv` failed with status 128 (expected — source is not under version control); the skill's verified fallback ran instead: source confirmed byte-identical to the pre-move snapshot, destination collision checked, then plain `mv` — exit 0. Archive artifacts will ride delivery.
- Mandatory readback: pre-move recursive snapshot taken first; readback of snapshot vs archived destination — **EMPTY diff, byte-identical** (`git diff --no-index` exit 0; independent byte-tree comparison: 10/10 files identical, empty diff). Active `openspec/changes/` no longer contains the change (only `archive/` remains).
- Archive contents: `proposal.md`, `exploration.md`, `specs/` (5 domains), `design.md`, `tasks.md` (30/30 complete), `verify-report.md` (PASS). This `archive-report.md` is additive and was written after the move (excluded from the source/destination comparison by design).
- EOL note: the archived delta files are LF in the working tree (untracked); git's autocrlf will normalize them to CRLF at commit time — same situation as prior cycles' archived deltas.
- No commit created. Delivery gate is orchestrator-owned (no commit/push/PR from this phase).

## Delivery Notes (pending — not performed by archive)

- 3 stacked branches exist and MUST NOT be deleted: `feat/manual-savings-pr1` → `feat/manual-savings-pr2` → `feat/manual-savings-pr3` (trunk `dev`), 11 commits, HEAD `76b1b78`.
- Chained PRs pending creation (chain strategy stacked-to-main); **WARNING-1** `size:exception` for PR3 (586 lines > 400 guard) must be processed at PR creation.
- Pre-existing failure tracked out-of-scope: `telegram.service.test.ts › selects a category via cat:<id>` (1/1046) — identical on pristine PR2 code; not caused by this change.

## Risks

- **WARNING-1/WARNING-2/SUGGESTION-1** carried as advisories above (process size:exception at delivery; run root typecheck per slice; keep dashboard fixtures in the same work unit as REQUIRED contract fields).
- **INFO**: the archived change folder and the new `openspec/specs/manual-savings/` are untracked until the next commit; the 4 merged canonical specs show as modified and 1 as untracked. Working tree otherwise retains the delivered state.
- **INFO**: canonical specs in this repo are CRLF with `core.autocrlf=true`; future archive splices must convert delta block content to CRLF (mixed-EOL drift is a silent corruption class — verified absent here).

## Summary

`manual-savings` closed the SDD cycle: planned, implemented (all 30 tasks complete across 3 stacked slices), verified (PASS, 12/12 requirements, 74/74 scenarios, 1045/1046 tests with the sole pre-existing `cat:<id>` failure out of scope, contracts build + root typecheck + lint all exit 0), and archived. Canonical specs now reflect the manual-savings surface: 1 new capability (`manual-savings`), 4 updated capabilities (money-movements, savings, bot-manage-savings, bot-main-menu). Delivery remains pending on the stacked chain with a `size:exception` note for PR3.