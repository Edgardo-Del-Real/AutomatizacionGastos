# Archive Report: Dashboard Web (Read-Only Metrics + Expense List)

**Change**: dashboard-web
**Archived**: 2026-08-17
**Archive location**: `openspec/changes/archive/2026-08-17-dashboard-web/`
**Mode**: hybrid (openspec files + Engram reports)
**Status**: COMPLETE — archived with no warnings

## Final State (at close)

The change is FULLY implemented and verified at close:

- All 19 tasks complete (persisted `tasks.md` checked 19/19, 0 unchecked — verified by archive readback).
- Delivered on `dev` in 3 PR slices plus 1 remediation commit:
  - **PR 1 (foundation)**: `2495100`..`e9f0b8d` (incl. `e02f82b`, `2dc0dee`) — contracts schemas, dashboard scaffold, infra client, env
  - **PR 2 (metrics)**: `ad6f7f5` + `d4d1ce3`
  - **PR 3 (expenses + integration)**: `fc96fe5` + `34745ea` + `5bf6a04`
  - **REQ-4 remediation**: `783828a` (`apps/dashboard/src/infra/env.test.ts`)
- Repo convention: `main` = stable, `dev` = integration. dashboard-web is delivered on `dev`, NOT yet merged to `main` (no PR created — `gh` CLI not installed; user creates PRs via web).

## Verification Verdict: PASS

- **Evidence revision**: `sha256:0f7f2f4597a05122be8d3e321dc336028f9f802c4dd3a25e3a4acf77751885f7`
- **Verdict**: pass — 6/6 requirements, 12/12 scenarios. Native validator `gentle-ai sdd-verify-validate --requirements 6 --scenarios 12` admitted the verdict.
- **Full suite**: 47/47 tests green across 11 files (exit 0); `typecheck`, `lint`, `build` all exit 0.
- **Findings**: CRITICAL 0 | WARNING 0 | SUGGESTION 3

### Evidence revision history (final-state authority)

The FIRST verify run FAILED on REQ-4 "Configured owner" (no direct env-read coverage; only propagation tests). Remediation landed AFTER that fail:

- Commit `783828a` (2026-08-17 17:22) added `apps/dashboard/src/infra/env.test.ts` (26 lines, 2 tests: configured `VITE_OWNER_ID` → `"acme"`, unset → `"default"`, via `vi.stubEnv` + `vi.resetModules` + dynamic import).
- REFRESH verification re-ran and PASSED with the evidence revision above; suite went 45 → 47 tests (11 files); the previous PARTIAL became COMPLIANT.

Snapshot attribution (do not read as current state):

- Per `apply-progress` (Engram #130, 2026-08-17 16:45): 45 tests / 10 files at that time — an intermediate snapshot, superseded by the refresh.
- Per `verify-report` (Engram #132, final revision 2026-08-17): 47/47 tests / 11 files, verdict pass — FINAL and authoritative.

## Remaining Findings (SUGGESTION-level only, carried to close)

1. Vite chunk >500 kB (569 kB / 170 gzip; recharts+zod in entry bundle) — acceptable for internal tool; code-splitting is a future option.
2. Live-data dev smoke pending — API was not running during verify; run once with a seeded API to fully close task 4.3's runtime harness.
3. `AsyncState` type-only cross-feature import (metrics → expenses) — a shared `src/infra/asyncState.ts` would be cleaner if a third slice appears.

## Documented Design Deviations (no spec break)

- `filterExpenses.ts` / `filterExpenses.test.ts` renamed from `expenseFilters.ts` — Windows case-collision with `ExpenseFilters.tsx` (Vite extension-loop resolver hit the wrong file, "Element type is invalid"). Real Windows-only footgun: avoid same-basename-different-case files in this repo.
- `ApiError` implemented as a class (`kind`/`status`/`issues`) instead of the design's literal union; tests use `instanceof` + `toMatchObject`.

## Rollback Boundaries (per tasks.md work units)

- **PR 1 (foundation)**: revert `packages/contracts/src/index.ts` (remove `listExpensesSchema` + summary month export), delete `apps/dashboard/`, `pnpm install` prunes lockfile. No `pnpm-workspace.yaml` edit (uses `apps/*` wildcard).
- **PR 2 (metrics)**: delete `src/features/metrics/` only.
- **PR 3 (expenses + integration)**: delete `src/features/expenses/` + `src/App.test.tsx`, revert `src/App.tsx`.
- No `apps/api/**` files touched by this change.

## Spec Sync (Step 2)

- `openspec/specs/` was empty (new project — `openspec/specs/.gitkeep` only). The delta spec IS the full spec for the new `dashboard-web` capability.
- Promoted verbatim via mechanical copy (NOT model Read→Write): `openspec/changes/dashboard-web/specs/dashboard-web/spec.md` → `openspec/specs/dashboard-web/spec.md`.
- Readback: SHA-256 identical (`7F57C2D9736929F7F953B659A8DE368BC5A4770E0A6064BA110FF9427AC0910F`), `git diff --no-index` exit 0.
- Delta content: 6 ADDED requirements (Metrics Overview, Expense List, Client-Side Filters, Fixed Owner, Loading and Error States, Response Validation); 0 MODIFIED / REMOVED / RENAMED.
- `config.yaml` `rules.archive` ("Warn before merging destructive deltas"): N/A — no destructive merge (all ADDED, new project). No warning required.

## Archive Move (Step 3)

- `git mv` (folder was tracked on `dev`): `openspec/changes/dashboard-web` → `openspec/changes/archive/2026-08-17-dashboard-web/`.
- Readback: recursive SHA-256 snapshot (5 files) vs archived tree — 0 missing, 0 extra, byte-identical. `archive-report.md` (this file) is additive and excluded from the readback.

## Gates

- **Task Completion Gate**: PASS — 19/19 tasks checked in the persisted tasks artifact; no archive-time stale-checkbox reconciliation needed.
- **Native Review Receipt Gate**: `reviewGate` structurally absent (no review artifacts exist in Engram or the filesystem; no review ever discovered for this candidate) → archive proceeded under ordinary repository policy. No receipt to validate, nothing declined.
- **CRITICAL gate**: 0 CRITICAL findings in verify-report → no block.
- **Action Context Guard**: `actionContext.mode: repo-local`, `allowedEditRoots: [C:\Users\user\Desktop\AutomatizacionRita]`; all archive operations stayed inside the root; no production code touched (`apps/api`, `packages/contracts`, `apps/dashboard` source untouched by this phase).

## Traceability (observations read)

- Engram **#132** — `sdd/dashboard-web/verify-report` (full content read; final revision, verdict pass)
- Engram **#130** — `sdd/dashboard-web/apply-progress` (full content read; PR 3 final batch)
- Engram — no `sdd/dashboard-web/archive-report` existed before this write (fresh create)
- Filesystem — `openspec/changes/dashboard-web/{proposal.md, design.md, tasks.md, specs/dashboard-web/spec.md, exploration.md}` (read pre-move)
- Native status — `gentle-ai sdd-status dashboard-web --cwd <repo> --json --instructions`: file-tree authoritative (proposal/specs/design/tasks done, 19/19 tasks, no review artifacts); the Engram-housed verify-report is the authoritative verification evidence for this hybrid change.

## Intentional Overrides

None. Archive is complete, not partial; no stale-checkbox reconciliation performed; no destructive delta merge.