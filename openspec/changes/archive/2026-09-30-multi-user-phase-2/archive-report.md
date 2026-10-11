# Archive Report — multi-user-phase-2

**Archived**: 2026-09-30
**Branch**: feat/multi-user-phase-2 (merged to dev at 5a8f718)
**Store**: hybrid (openspec filesystem + Engram)
**Archive path**: `openspec/changes/archive/2026-09-30-multi-user-phase-2/`

## Final State (at close)

| Metric | Value |
|--------|-------|
| Requirements | 21/21 (PASS) |
| Scenarios | 81/81 (PASS) |
| Tests | API 627/627 (27 files), dashboard 136/136 (22 files), exit 0 |
| Build / typecheck / lint | exit 0 / exit 0 / exit 0 |
| Tasks | 23/23 `[x]` in persisted `tasks.md` (Task Completion Gate passed) |
| CRITICAL findings | 0 |
| Verification verdict | PASS — evidence_revision `sha256:5250bd250cef50d757e3250bb630721028dddf12a3b92a7a4b82ea1aa008a983` |
| Blocker state | none (dependencies.archive: ready, nextRecommended: archive) |

Per the Final-State Authority, the verdict, counts, and test/build numbers above are carried from the admitted PASS `verify-report.md` (verdict pass, 0 critical, 0 blockers) and the orchestrator's launch facts — not from intermediate snapshots. No intermediate `apply-progress` exists for this change beyond the final tasks state; no contradiction between sources required ranking.

## What Was Archived

The change folder moved mechanically via `git mv` (folder tracked since b58eda6) from `openspec/changes/multi-user-phase-2/` to `openspec/changes/archive/2026-09-30-multi-user-phase-2/`, containing:

- `proposal.md`
- `design.md`
- `tasks.md` (23/23 complete)
- `verify-report.md` (PASS)
- `specs/` — 4 delta specs: `bot-brain`, `dashboard-web`, `money-movements`, `telegram-bot`

Mandatory readback (Mechanical Copy Contract): the pre-move recursive snapshot vs. the archived folder returned **empty** (`diff -r`, exit 0). An independent readback of the archived tree against the exact tracked bytes at b58eda6 (`git archive b58eda6` → `diff -r`) also returned **empty** — byte-identical, no truncation or alteration. This `archive-report.md` is additive-only and excluded from both comparisons (it did not exist in the source change folder).

## Specs Synced (delta → canonical)

**Prior-state finding**: commit `b58eda6` ("sync canonical specs and archive SDD changes") committed the multi-user-phase-2 change folder to git and synced the OTHER three changes (savings-rule, planned-fixed-expenses, conversational-categories), but did **NOT** apply multi-user-phase-2's deltas to the canonical specs — verified by real diff: `money-movements` canonical had zero `visibility|registrant|SHARED` content, `dashboard-web` still carried the pre-delta "Fixed Owner" requirement ("MUST NOT provide an owner selector"), and `bot-brain` lacked the Shared Flag Contract and the `shared` schema field. All 4 deltas therefore required a full sync, now completed.

| Domain | Action | Details |
|--------|--------|---------|
| `bot-brain` | Updated | 1 ADDED (Shared Flag Contract, 3 scenarios). 1 MODIFIED merged incrementally (Interpret Envelope Contract: `shared` added to the envelope schema + "Shared flag decodes with register_expense" scenario). |
| `dashboard-web` | Updated | 2 ADDED (Viewer Visibility Filter, SHARED Badge — 5 scenarios). 1 RENAME handled via MODIFIED block (Fixed Owner → Viewer Selector, 4 scenarios). 2 MODIFIED merged incrementally (Movement List: selected viewer, registrant-only actions, partner rows read-only, visibility filter; Movement Filters: visibility combined filter). |
| `money-movements` | Updated | 4 ADDED (Movement Visibility Model, Viewer-Scoped Read Predicate, Visibility Filter Parameter, Legacy Expense Endpoints Frozen — 13 scenarios). 5 MODIFIED merged incrementally (Movement Contracts: `movementSchema` + visibility/registrantId; Movement List Endpoint: viewer predicate + visibility filter; Movement Summary Endpoint: viewer predicate + visibility filter; Movement Update/Delete Endpoints: registrant-only mutation rule). |
| `telegram-bot` | Updated | 1 ADDED (Shared Registration via Prefix, 4 scenarios). 4 MODIFIED replaced wholesale (Owner Filtering: household registry + degraded mode; Message Deduplication: recording after the chat gate, unknown chats never recorded; Movement Persistence and Error Tolerance: resolved owner + visibility; Configuration and Token Secrecy: household chatId validation + secrecy) — these canonical blocks were the pre-delta single-owner versions with no later-synced content, so clean replacement was lossless. |

**Reconciliation (recorded explicitly)**: 8 MODIFIED blocks (bot-brain 1, dashboard-web 2, money-movements 5) were merged **incrementally onto the evolved canonical requirement** rather than as wholesale block replacement, because those canonical requirements had already advanced past the delta's snapshot via changes synced after multi-user-phase-2 was authored (planned-fixed-expenses, savings-rule, conversational-thread, bot-expense-lifecycle). A blind replacement would have regressed content those later changes contributed (e.g. `planned` flag, SAVINGS/PENDING badges, status/planned contracts, mark-paid action). The delta's semantic changes (visibility, registrantId, viewer predicate, shared flag, read-only partner rows) are all present; every pre-existing requirement and scenario outside the delta was preserved. Post-merge verification: the 21 delta requirement blocks / 81 scenarios are all present in their canonical specs (line-ending-normalized), and requirement lists show no loss (bot-brain 12, dashboard-web 13, money-movements 16, telegram-bot 27).

## Known Non-Blocking Findings (carried from verify-report)

- **W1** (info): spec counts 21/81 vs. a session-summary expectation of 25/90 — reporting discrepancy only; the 4 delta spec files are authoritative and are what the canonical sync applied.
- **W2** (info): `movementSchema` `visibility`/`registrantId` are optional in the contract (additive AD5); the API always emits both, so every response validates and carries them.
- **W3** (info): 21 commits cover 23 tasks; tasks 4.3+4.4 share commit f33c456; task 5.1 goldens were regenerated in-cycle during slice 2.
- No CRITICAL findings. No blockers.

## Traceability — Sources Read

All artifacts were read from the OpenSpec filesystem (no Engram observation reads were required for this phase):

| Source | Path |
|--------|------|
| proposal | `openspec/changes/multi-user-phase-2/proposal.md` (via git tree, b58eda6) |
| delta specs | `openspec/changes/multi-user-phase-2/specs/{bot-brain,dashboard-web,money-movements,telegram-bot}/spec.md` |
| design | `openspec/changes/multi-user-phase-2/design.md` (via git tree, b58eda6) |
| tasks | `openspec/changes/multi-user-phase-2/tasks.md` (23/23 `[x]`) |
| verify-report | `openspec/changes/multi-user-phase-2/verify-report.md` (admitted PASS, evidence_revision `sha256:5250bd25…`) |
| canonical specs | `openspec/specs/{bot-brain,dashboard-web,money-movements,telegram-bot}/spec.md` |
| repo history | commits `b58eda6`, `5a8f718`; canonical-spec history |

## Sequencing Note (bot-hybrid-ux)

This archive is the documented prerequisite for sequencing the next change, `bot-hybrid-ux` (both touch `telegram.service.ts` and the telegram-bot/bot-brain specs). With the deltas now synced, the canonical `telegram-bot` and `bot-brain` specs carry the household-registry owner filtering, the `compartido:` prefix, the `shared` envelope flag, and the per-chat attribution rules that bot-hybrid-ux will build on. The `bot-hybrid-ux` change folder was NOT touched (untracked, left in place).