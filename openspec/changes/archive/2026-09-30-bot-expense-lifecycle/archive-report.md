# Archive Report — bot-expense-lifecycle

**Archived**: 2026-09-30
**Branch**: feat/bot-expense-lifecycle
**Store**: hybrid (openspec filesystem + Engram)
**Archive path**: `openspec/changes/archive/2026-09-30-bot-expense-lifecycle/`

## Final State (at close)

| Metric | Value |
|--------|-------|
| Requirements | 16/16 (PASS) |
| Scenarios | 95/95 (94 complete, 1 partial — W-1) |
| Tests | 1088/1088 (39 files, exit 0) |
| Build / typecheck / lint | exit 0 / exit 0 / exit 0 |
| Tasks | 23/23 `[x]` in persisted `tasks.md` (Task Completion Gate passed) |
| CRITICAL findings | 0 |
| Verification verdict | PASS (admitted via `gentle-ai sdd-verify-validate`, evidence_revision `sha256:342233be5a6eea2267ee9fedf7d8147be7bc49dfa3d32231916ba3075f9d0f9e`) |
| Blocker state | none (dependencies.archive: ready, nextRecommended: archive) |

## What Was Archived

The change folder moved mechanically (`mv`; `git mv` unavailable for untracked folder, source verified unchanged before fallback) from `openspec/changes/bot-expense-lifecycle/` to `openspec/changes/archive/2026-09-30-bot-expense-lifecycle/`, containing:

- `proposal.md`
- `exploration.md`
- `design.md`
- `tasks.md` (23/23 complete)
- `verify-report.md` (PASS)
- `specs/` — 6 delta specs: `bot-brain`, `bot-expense-lifecycle`, `conversational-categories`, `movement-categories`, `planned-fixed-expenses`, `telegram-bot`

Mandatory readback: recursive `git diff --no-index` of the pre-move snapshot vs. the archived folder returned **empty** (exit 0) — byte-identical, no truncation or alteration. The `archive-report.md` is additive-only and excluded from the comparison.

## Specs Synced (delta → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| `bot-brain` | Updated | 4 MODIFIED: Interpret Envelope Contract (+`mark_paid`/`delete_expense` intents, +Lifecycle intent decodes scenario), Intent Taxonomy (+2 lifecycle scenarios), Category Suggestion Contract (+folded "Otros"→"otro" resolution, +Folded suggestion resolves), Prompt Contract (+category-resolution hint and lifecycle teaching, +pinned scenario). |
| `bot-expense-lifecycle` | **Created** | New capability — full spec mechanically copied (shell `cp` + readback diff empty, hash `sha256:238E122F…` matches archived delta). 3 requirements / 10 scenarios. |
| `conversational-categories` | Updated | 1 ADDED (Punctuation-Stripped Guard Normalization, 2 scenarios), 1 MODIFIED (Gated Dialog Auto-Create: guard-word pre-check + Punctuated guard word rejected scenario). |
| `movement-categories` | Updated | 1 MODIFIED (Reserved and Duplicate-Variant Guards: `provisorio`→`previsto` alias + token-level guard, +Provisorio alias rejected scenario). |
| `planned-fixed-expenses` | Updated | 1 MODIFIED (Mark Paid Transition: bot trigger channel, +Bot triggers transition conversationally scenario). |
| `telegram-bot` | Updated | 5 MODIFIED: Movement Parsing (folded resolution, awaiting_registration on unknown category, +Folded brain suggestion resolves), Setup Flow (dynamic listing + batch commands, +2 scenarios), Correction Loop (+Punctuated guard never auto-creates), Intent-First Message Handling (+Lifecycle intent routes to executor), Dialog Controller (single merged reply on register-during-dialog). |

Merge verification: every delta requirement block (13 total across 5 modified domains) confirmed present **verbatim** in its canonical spec (line-ending normalized comparison). ADDED requirement appended to the canonical Requirements section. No canonical requirement outside the delta was removed or altered.

## Traceability — Observations Read

| Observation | Topic | Role |
|---|---|---|
| Engram #503 | `sdd/bot-expense-lifecycle/apply-progress` | Intermediate apply-progress (batches 2.5–4.3). Superseded by #505. |
| Engram #504 | `sdd/bot-expense-lifecycle/verify-report` | FAILED verify-report revision (evidence_revision `sha256:30239b0d…`). Historical — superseded by the admitted PASS. |
| Engram #505 | `sdd/bot-expense-lifecycle/apply-progress` | Remediated apply-progress: TDD Cycle Evidence (batches 1–2, tasks 1.1–4.3), corrected 23-task count. |
| File | `verify-report.md` (archived) | Admitted PASS (evidence_revision `sha256:342233be…`). |

Per the Final-State Authority, the final verdict, test/build/lint numbers (1088/1088, exit 0) and the 16/16–95/95 counts are carried from the admitted PASS verify-report and the orchestrator's launch facts — not from the intermediate snapshots #503/#504. The earlier FAILED revision in Engram #504 is preserved as history; the PASS that was admitted by the validator is the filesystem `verify-report.md` in this archive.

## Known Non-Blocking Findings (carried from verify-report)

- **W-1** (spec wording): the telegram-bot scenario "Keyword miss with unknown brain category" previously said "registers in otro + correction"; implementation routes a non-resolving brain category to the `awaiting_registration` collect ask. The delta spec synced into canonical **already carries the corrected scenario wording** ("the registration-collection dialog opens asking for the category with the amount persisted"), so the canonical source of truth now matches the implementation. No action required.
- **W-2** (design note): design.md truth-table row "Supercado → null falls back to otro" is imprecise — downstream is the pre-existing E2 collect, documented in apply-progress #505. Non-breaking.
- **W-3** (operational): cleanup runbook `cleanup-phantom-data.ts` cannot complete against the real DB as written — apply-progress #505 confirms the junk expense is absent and the valid PENDING row's note differs from the pre-assert. The script aborts on drift (safe by design); operator must reconcile drift or adjust the pre-assert before running. Open design question: confirmed owner id (now `default` per #505) — still to be double-checked against the real DB at run time.

No CRITICAL findings. Archive proceeded with zero overrides; no stale unchecked tasks; no intentional partial archive.

## SDD Cycle Complete

The change was fully planned, implemented, verified, and archived. Source of truth (`openspec/specs/`) now reflects the archived deltas. The SDD cycle for `bot-expense-lifecycle` is closed.