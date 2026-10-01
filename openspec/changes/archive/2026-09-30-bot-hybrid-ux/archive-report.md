# Archive Report — bot-hybrid-ux

**Change**: bot-hybrid-ux
**Archived**: 2026-09-30
**Branch**: dev (working tree)
**Store**: hybrid — OpenSpec filesystem + Engram topic `sdd/bot-hybrid-ux/archive-report`
**Status**: success — SDD cycle closed

## Final State (at close)

- Tasks: **25/25** implementation tasks complete. Persisted tasks artifact (`tasks.md`) audited after the move: 0 unchecked boxes. No stale-checkbox reconciliation was needed or performed.
- Verification: **PASS** — `verify-report.md` (schema `gentle-ai.verify-result/v1`), verdict `pass`, blockers 0, `critical_findings` 0, requirements 33/33, scenarios 140/140, evidence_revision `sha256:e98b2fd7fdeb4e00596be44159dfec399daba6b3a6a1b0c9b3562a7642ed01e5`, tests 1177/1177 (39 files), build/typecheck exit 0. Verdict admitted by `gentle-ai sdd-verify-validate` (per orchestrator launch prompt).
- Manual runbook task 7.2 (ghost cleanup): executed 2026-09-30 per `tasks.md` — `--dry-run` detects the 4 phantom categories and does not abort; the `--write` application remains an operator decision with prior DB backup (junk/valid expense guards relaxed to optional due to real drift).
- No CRITICAL verification findings, no blockers at close, no intentional archive overrides in effect.

## Artifacts Read (traceability)

- `openspec/changes/bot-hybrid-ux/proposal.md`
- `openspec/changes/bot-hybrid-ux/specs/{bot-inline-interactions,quick-capture,bot-main-menu,telegram-bot,bot-brain,bot-expense-lifecycle,movement-categories,conversational-categories,registration-collection}/spec.md`
- `openspec/changes/bot-hybrid-ux/design.md`
- `openspec/changes/bot-hybrid-ux/tasks.md`
- `openspec/changes/bot-hybrid-ux/verify-report.md`
- Canonical specs: `openspec/specs/{telegram-bot,bot-brain,bot-expense-lifecycle,movement-categories,conversational-categories,registration-collection}/spec.md`
- Config: `openspec/config.yaml` (`rules.archive`: warn before destructive deltas — the single REMOVED requirement carried `(Reason:)`/`(Migration:)`; no large-section removal triggered a warning)

## Spec Sync (delta → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| bot-inline-interactions | Created (new capability) | Full spec copied byte-identically (`diff -r` empty) |
| quick-capture | Created (new capability) | Full spec copied byte-identically (`diff -r` empty) |
| bot-main-menu | Created (new capability) | Full spec copied byte-identically (`diff -r` empty) |
| telegram-bot | Updated | 9 MODIFIED requirement blocks replaced |
| bot-brain | Updated | 4 MODIFIED requirement blocks replaced |
| bot-expense-lifecycle | Updated | 2 MODIFIED requirement blocks replaced |
| movement-categories | Updated | 2 ADDED requirement blocks appended |
| conversational-categories | Updated | 1 REMOVED (with Reason/Migration), 1 ADDED appended |
| registration-collection | Updated | 1 MODIFIED requirement block replaced |

Merge method: incremental, byte-exact, shell-executed (never routed through model Read/Write). Each MODIFIED delta block replaced the homonymous canonical block wholesale — body, `(Previously: ...)` note, and scenarios — per the OpenSpec convention and the pattern of prior archive syncs (e.g. commit f6902ee). ADDED blocks were appended at EOF; the REMOVED block (`Gated Dialog Auto-Create`) carried `(Reason: decision #3 removes free-text auto-create; ...)` and `(Migration: dialog answers ... resolve against the closed set or the category buttons ...)` before deletion. Requirements not mentioned in the deltas were preserved verbatim (e.g. telegram-bot Long-Polling Lifecycle, Owner Filtering, Savings Split, Dialog Controller; bot-brain Reply-After-Action, Degrade-to-Null, Dialog Action Contract, Shared Flag Contract; bot-expense-lifecycle Mark-Paid Intent Execution; movement-categories keyword matching, SAVINGS guards).

Byte fidelity readback (mandatory): every merged block verified byte-identical (LF-normalized) against its delta source — **16 MODIFIED PASS, 2 ADDED PASS, 1 REMOVED verified absent**; heading counts preserved (telegram-bot 27→27, bot-brain 12→12, bot-expense-lifecycle 3→3, movement-categories 8→10, conversational-categories 6→6, registration-collection 9→9). Line endings: spliced content matched each canonical's dominant EOL (CRLF for 5 canonicals; LF for registration-collection), so no mixed-EOL or byte drift was introduced. New canonicals verified with `diff -r` empty output (exit 0).

## Canonical Drift Observations (pre-existing, NOT covered by any delta — preserved, flagged)

1. `openspec/specs/bot-brain/spec.md` — "Bot Brain Port" still describes `ConversationEnvelope` as carrying a `planned` flag, while the delta-modified "Interpret Envelope Contract" removes `planned` from the schema ("The schema MUST NOT accept a `planned` field"). The delta does not modify "Bot Brain Port", so it was preserved verbatim; the two requirements now disagree.
2. `openspec/specs/telegram-bot/spec.md` — "Movement Parsing, Classification and Categorization" still states "The bot brain MUST be invoked for every non-command `idle` message", in tension with the delta-modified "Intent-First Message Handling" (deterministic `QuickCaptureParser` first, brain as fallback for uncaptured intents).
3. `openspec/specs/conversational-categories/spec.md` — "Suggester Ceiling" scenario "Planned flag is a suggestion only" uses a `planned` GIVEN that is unattainable under the modified bot-brain schema; its THEN ("PENDING ... never from the brain") remains consistent with the new contract.

Recorded rather than silently resolved, per the archive Final-State Authority contract. Recommended follow-up delta to align "Bot Brain Port", "Movement Parsing, Classification and Categorization", and "Suggester Ceiling" with the button-only planned-type contract.

## Archive

- Moved `openspec/changes/bot-hybrid-ux/` → `openspec/changes/archive/2026-09-30-bot-hybrid-ux/` via `git mv` (destination collision guard passed; active `openspec/changes/` no longer contains the change).
- Mandatory readback: `diff -r` of the pre-move recursive snapshot vs the archived destination — **EMPTY output, exit 0 (byte-identical)**.
- Archive contents: `proposal.md`, `specs/` (9 domains), `design.md`, `tasks.md` (25/25 complete), `verify-report.md`. This `archive-report.md` is additive and was written after the move (excluded from the source/destination comparison by design).
- No commit created. Native SDD dispatcher and ledger untouched.

## Risks

- Task 7.2 `--write` (ghost cleanup application) remains an operator decision; dry-run executed 2026-09-30.
- Three canonical drift observations above could mislead a future reader about the planned-type contract; follow-up delta recommended.
- `git mv` staged the rename in the index (no commit); the working tree otherwise retains the uncommitted implementation state as delivered.

## Summary

`bot-hybrid-ux` closed the SDD cycle: planned, implemented (25/25), verified (PASS, 33/33 requirements, 140/140 scenarios), and archived. Canonical specs now reflect the hybrid button-first UX: 3 new capabilities (bot-inline-interactions, quick-capture, bot-main-menu) and 6 updated capabilities (telegram-bot, bot-brain, bot-expense-lifecycle, movement-categories, conversational-categories, registration-collection).