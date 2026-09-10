# Archive Report — Migrate Inbound Bot from WhatsApp Cloud API to Telegram Bot API

**Change**: `migrate-bot-to-telegram`
**Archived at**: 2026-09-02
**Artifact store**: hybrid (OpenSpec filesystem + Engram mirror)
**Archived to**: `openspec/changes/archive/2026-09-02-migrate-bot-to-telegram/`
**Archive type**: standard (full cycle completed, verified PASS — no override required)

## Final State (at close)

Reported per the Final-State Authority hierarchy. The `verify-report.md` snapshot and the apply notes in `tasks.md` are intermediate snapshots; final counts reflect the launch-prompt final-state facts corroborated by repository evidence (all ranks above snapshots).

| Metric | Final value |
|--------|-------------|
| SDD cycle | Complete (proposal → specs → design → tasks → apply → verify → archive) |
| Tasks | 16/16 complete, all `[x]` in `tasks.md` (1.1–4.2) |
| Verification verdict | **PASS** canonical (`gentle-ai.verify-result/v1`, evidence_revision `sha256:df199bec1764ec235e360619753f07e1f167afc45bdae58151e2c75dbb33e942`) |
| Requirements | 8/8 (7 telegram-bot + 1 money-movements) |
| Scenarios | 20/20 (16 telegram-bot + 4 money-movements) |
| CRITICAL findings | 0 |
| WARNING findings | 0 at close (see remediation note below) |
| SUGGESTION findings | 2 (non-blocking: logger-callback assertion could be added; no coverage tool configured) |
| API test suite | 114 passed / 114 (10 files), exit 0 (canonical re-verify run) |
| Typecheck | exit 0 (hash `sha256:095575b4…`) |
| Lint | exit 0 (hash `sha256:25bf01ad…`) |
| Contracts build | exit 0 (hash `sha256:e06be89e…`) |
| Delivery | Branch `feat/migrate-bot-to-telegram`, NOT merged to main/dev (see Delivery Status) |

**Remediation history**: a single evidence gap (Graceful stop on shutdown scenario, PARTIAL at first verify) was closed by commits `d7e34fb` + `ea28df1`; the canonical re-verify (`b01df32`) then passed 114/114 with the graceful-stop scenario covered by `telegram.bot.test.ts > stops the bot when the Fastify app closes via the onClose hook`.

**WARNING resolution**: `verify-report.md` snapshot lists one WARNING — openspec contract artifacts (`specs/`, `design.md`, `proposal.md`, `exploration.md`) untracked. This was resolved by the contract-artifacts commit `9284541`; at close, `git ls-files openspec/changes/migrate-bot-to-telegram` shows all 7 artifacts tracked and `git status` clean for `openspec/`. Final state: 0 WARNING. The snapshot claim is superseded by the later commit (launch-prompt final-state fact, corroborated by git evidence).

## Native Review Receipt Gate

`reviewGate` is structurally ABSENT for this candidate — no review was ever started for this change. Per the sdd-archive skill, archive proceeds under ORDINARY REPOSITORY POLICY. There is no receipt to read and no gate to block on; the absence is not a defect. No `dependencies.archive` block was present to investigate.

## Task Completion Gate

The persisted `tasks.md` was inspected before any spec sync or archive move: all 16 implementation tasks are marked `[x]` (5 F1, 6 F2, 3 F3, 2 F4-verify). Task 4.2 (manual smoke with a real BotFather token) is a documented user-run step post-delivery, not code completion — it is marked `[x]` per the task plan's own definition ("manual smoke is a documented user-run step post-delivery, NOT part of code completion"). No stale unchecked implementation tasks; no archive-time reconciliation required. The `## Review Workload Forecast` table is not implementation tasks.

## Specs Synced

### telegram-bot (new domain — full spec)

- Main spec did NOT exist at `openspec/specs/telegram-bot/spec.md`.
- The delta spec (`specs/telegram-bot/spec.md`) IS a full spec (`# Telegram Bot Specification`, `## Requirements`), so it was copied mechanically as the new main spec (shell `Copy-Item` → temp → GNU `diff -r` readback → `Move-Item`). Readback exit 0 — empty diff, byte-identical.
- 7 requirements / 16 scenarios: Long-Polling Lifecycle, Update Filtering, Owner Filtering, Message Deduplication, Movement Parsing and Classification, Movement Persistence and Error Tolerance, Configuration and Token Secrecy.

### money-movements (existing main spec — RENAMED + MODIFIED delta)

- Main spec existed at `openspec/specs/money-movements/spec.md` with `### Requirement: Webhook Income Detection` (4 scenarios).
- Applied the delta per the merge rules — deliberate RENAMED + MODIFIED split (NOT REMOVED+ADDED), preserving scenario lineage verbatim:
  - **RENAMED**: `Webhook Income Detection` → `Message Income Detection` (explicit old/new names; Reason + Migration notes present in the delta).
  - **MODIFIED**: the requirement body was replaced with the delta's transport-neutral wording ("The system MUST classify an inbound message…"); all 4 scenarios preserved (Keyword match, Plus-prefixed amount, No signal defaults to expense, Ambiguous message is conservative), triggers reworded per the delta ("WHEN the system processes the message").
  - **Preserved** (not in the delta): Movement Type Model, Movement Contracts, Movement List Endpoint, Movement Summary Endpoint, Expense Retrocompatibility — untouched.
- **Normalization note**: the Purpose line "classifies webhook messages as income or expense" was normalized to "classifies inbound messages as income or expense" — a factual-consistency fix aligned with the delta's declared transport-neutral intent (the webhook transport no longer exists). No requirement content was invented; requirement text taken verbatim from the delta MODIFIED block.
- Result: 6 requirements / 16 scenarios (unchanged counts; one requirement renamed + reworded).

### dashboard-web (existing main spec — untouched)

- This change has NO delta for `dashboard-web` (only `telegram-bot` and `money-movements`). Confirmed byte-identical to HEAD (sha256 `1613E625B1BE…`). No action taken.

## Archive Move

The entire change folder was moved mechanically to `openspec/changes/archive/2026-09-02-migrate-bot-to-telegram/` using `git mv` (all 7 artifacts git-tracked). Byte-identity was verified with GNU `diff -r` (recursive) comparing the archived folder against a pre-move recursive snapshot taken before the move; the source was confirmed gone before the comparison. Readback exit 0 — empty diff, no differences. The `archive-report.md` is additive and excluded from that comparison (it did not exist in the source snapshot).

Verbatim `diff -r` output (source snapshot vs archived folder):

```
---DIFF-R-OUTPUT-BEGIN---
---DIFF-R-OUTPUT-END---
```

(Empty — the only passing evidence.)

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/telegram-bot/spec.md` ✅
- `specs/money-movements/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (16/16 tasks complete, no unchecked implementation tasks)
- `verify-report.md` ✅ (verdict PASS, canonical)
- `archive-report.md` ✅ (this file, additive)

The active changes directory no longer contains this change (only `archive/` remains).

## Remaining Manual Steps

- **4.2 Manual smoke (post-delivery, user-run)**: set real `TELEGRAM_BOT_TOKEN` / `TELEGRAM_OWNER_CHAT_ID`, run the API, send the owner "café 2500" → an EXPENSE movement must appear. Not part of code completion; by constraint no real BotFather token smoke runs in CI/apply.

## Delivery Status

The whole change lives on branch `feat/migrate-bot-to-telegram` and is NOT yet merged to main/dev. The archive documents the completed, verified change; the merge/PR is a delivery step handled separately by the orchestrator. Delivery forecast from `tasks.md`: auto-chain, stacked-to-main, 3 chained PRs (F1 foundation → F2 telegram feature → F3 cutover), 400-line budget risk High per PR. `drop_pending_updates` resolved as default — process queued messages (no code drops updates).

## Engram Mirror

Mirrored to Engram topic `sdd/migrate-bot-to-telegram/archive-report` (type `architecture`, `capture_prompt: false`, project `automatizaciongastos`). The OpenSpec `archive-report.md` file is authoritative; no Engram observations were read for this archive — all source artifacts were retrieved from the filesystem per the OpenSpec convention (the apply-progress Engram observation #231 referenced by `tasks.md`/`verify-report.md` was not re-read; its claims are superseded at close by the launch-prompt final-state facts and repository evidence above).