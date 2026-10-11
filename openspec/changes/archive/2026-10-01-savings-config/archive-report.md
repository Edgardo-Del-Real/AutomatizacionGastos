# Archive Report — savings-config

**Change**: savings-config
**Archived**: 2026-10-01
**Branch**: dev (working tree)
**Store**: hybrid — OpenSpec filesystem + Engram topic `sdd/savings-config/archive-report`
**Status**: success — SDD cycle closed

## Final State (at close)

- Tasks: **23/23 implementation task checkboxes marked `[x]`** in the persisted `tasks.md` (phases 1–7, 1.1–7.4). 0 unchecked. No stale-checkbox reconciliation was needed or performed.
  - Count note: `verify-report.md` and apply-progress (Engram #553) state "Tasks total 24 / complete 24"; the persisted tasks artifact contains 23 numbered implementation checkboxes. Per the Final-State Authority hierarchy the artifact is authoritative for completion visibility: every checkbox is complete, so the gate passes; the 24-vs-23 count is a bookkeeping discrepancy in the intermediate snapshots, recorded here rather than silently resolved.
- Verification: **PASS** — `verify-report.md` (schema `gentle-ai.verify-result/v1`), verdict `pass`, blockers 0, `critical_findings` 0, requirements **17/17**, scenarios **71/71**, evidence_revision `sha256:3009aad5195512c887a999250978f43031c741e9f8fc17267c9c1514ee9fc95c`, tests **921/921 (37 files), exit 0** (output hash `sha256:ba8c1e8ec3ff7f4a51b578ee8f515a45ca0fe9cb13e29805520e8a5d0dc05184`), contracts build exit 0, typecheck + lint clean.
- **Flake-fix note (final state)**: the recurring migration-lock flake in the integration suite (two migration files intermittently timing out at the 5000ms default vitest `testTimeout` under parallel DB lock contention) was fixed in commit `b2e1039` by raising `testTimeout` 5000→15000ms in `apps/api/vitest.config.ts` (task 7.3). The final full run (921/921, exit 0) completed with the timeout bump in place; verify re-confirmed it held.
- Commits on `dev`: **11** work-unit commits `d582b19..99c5bc1` — `d582b19`+`45e38ff` (P1), `9f305bf` (P2), `f9d31a1` (P3), `0eb20a0` (P4), `69549e7` (P5), `7b36014` (P6), `652df51` (P7 e2e), `b2e1039` (P7 timeout), `99c5bc1` (P7 tasks). All part of this change.
- Delivery: **single-pr** (forecast ~1,300–1,800 lines, under the 8000 session budget; **no `size:exception` needed**). **No PR created** — local on `dev`; PR creation is the orchestrator/user decision.
- No drift from the change surface: deterministic savings slice only — no dashboard/API savings-rule config, no LLM paths, no DB migration (the optional `savings` payload field keeps persisted previews decoding; `SavingsRule` model was already migrated `20260927090000_savings_rule`).
- No CRITICAL verification findings, no blockers at close, no intentional archive overrides in effect.

## Artifacts Read (traceability)

- `openspec/changes/savings-config/proposal.md`
- `openspec/changes/savings-config/exploration.md`
- `openspec/changes/savings-config/specs/` — all 6 delta/full specs (`bot-inline-interactions`, `bot-main-menu`, `bot-manage-savings` [NEW full spec], `quick-capture`, `savings`, `telegram-bot`)
- `openspec/changes/savings-config/design.md` (decisions D1–D11)
- `openspec/changes/savings-config/tasks.md` (23/23 checked)
- `openspec/changes/savings-config/verify-report.md`
- Engram observation **#553** `sdd/savings-config/apply-progress` (intermediate snapshot, 7 revisions; final revision read — 24/24 stated, commits + vitest timeout bump confirmed)
- Engram observation **#555** `sdd/savings-config/verify-report` (final PASS verify, 921/921, hashes captured)
- Canonical specs: `openspec/specs/{bot-inline-interactions,bot-main-menu,quick-capture,savings,telegram-bot}/spec.md` (pre-merge bytes taken from `git show HEAD:` — the canonical files had no uncommitted changes before this archive, confirmed by the pre-merge working-tree state)
- Config: `openspec/config.yaml` (`rules.archive`: warn before merging destructive deltas — no REMOVED blocks exist in this change, so no destructive merge occurred)

## Spec Sync (delta → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| bot-manage-savings | **Created (new capability)** | Full spec copied byte-identically via shell `cp` + `diff -r` readback (empty diff, exit 0) |
| telegram-bot | Updated | 4 MODIFIED blocks replaced wholesale (Bot Commands, Savings Rule Commands, Per-Owner State Machine, Savings Split on Income Registration); 1 RENAMED (`Savings Rule Command` → `Savings Rule Commands`) mapped and covered by the MODIFIED block |
| savings | Updated | 1 MODIFIED block replaced (Income Split and Rounding); 1 ADDED block appended (Savings Rule Listing and Deletion) |
| quick-capture | Updated | 1 MODIFIED block replaced (Capture Preview with Save/Correct); 1 ADDED block appended (Savings Override Choice in Confirmation) |
| bot-main-menu | Updated | 2 MODIFIED blocks replaced (Static Help, setMyCommands Registration) |
| bot-inline-interactions | Updated | 1 MODIFIED block replaced (Callback Query Routing); 1 ADDED block appended (Savings Keyboard Budgets) |

Merge method: mechanical, byte-exact, shell/python-executed block splicing (never routed through model Read/Write for content). Each MODIFIED delta block replaced the matching canonical requirement block wholesale — heading, body, `(Previously: ...)` note, and scenarios — per the OpenSpec convention and the bot-hybrid-ux-v2 precedent. ADDED blocks were appended at EOF with exactly one blank-line separator. RENAMED handled as heading rename (old → new) with the MODIFIED block carrying the new content. Requirements not mentioned in the deltas were preserved verbatim (e.g. telegram-bot Long-Polling Lifecycle, Owner Filtering, Savings Query Routing, Guarded Category Creation Funnel; savings SavingsRule Model, SHARED Inheritance, Tolerant Rule Matching; quick-capture Deterministic Capture Parser, Type Selection by Menu, Save Idempotency; bot-main-menu Main Menu Actions, Post-Action Menu Return; bot-inline-interactions Keyboard Reply Port, Callback Idempotency, Stale Button Revalidation, Keyboard Size Limits).

Byte fidelity readback (mandatory): every spliced block verified byte-identical (LF-normalized, trailing separator normalized) against its delta source — **12 MODIFIED PASS, 3 ADDED PASS, 1 RENAMED PASS**; **41 untouched canonical blocks verified preserved byte-identically**. New canonical (`bot-manage-savings`) verified byte-identical at copy time (`diff -r` empty, exit 0). Line endings: canonical specs are CRLF (git autocrlf normalization); spliced content converted to the canonical's dominant EOL (CRLF); deltas are LF; no mixed-EOL drift introduced.

## Canonical Drift Observations (pre-existing headers, NOT covered by any delta — preserved, flagged)

1. `openspec/specs/bot-main-menu/spec.md` — Purpose still reads "five inline actions (Nuevo gasto, Gasto previsto, Borrar, Reporte, Ayuda)" while the (previously merged) Main Menu Actions requirement mandates **eight** buttons. Pre-existing from the bot-hybrid-ux-v2 archive; the savings-config delta did not modify the Purpose section, so it was preserved verbatim.
2. `openspec/specs/quick-capture/spec.md` — Purpose still says the parser "resolves the category against the owner's CLOSED category set" while the Deterministic Capture Parser requirement states the parser yields `{amount, note}` only. Pre-existing; preserved verbatim.

Recorded rather than silently resolved, per the archive Final-State Authority contract. Recommended follow-up delta to align these Purpose sections with the button-first surface.

## Archive

- Moved `openspec/changes/savings-config/` → `openspec/changes/archive/2026-10-01-savings-config/`. The change folder is 10 files tracked + `verify-report.md` untracked; `git mv` on a directory containing untracked files succeeds in git 2.52 (verified in a scratch repo first), so the move ran via `git mv` (exit 0) — tracked files staged as renames (`R`), `verify-report.md` remains untracked at the destination.
- Mandatory readback: pre-move recursive snapshot taken first; `diff -r` (snapshot vs archived destination) — **EMPTY output, exit 0 (byte-identical)**. Active `openspec/changes/` no longer contains the change.
- Archive contents: `proposal.md`, `exploration.md`, `specs/` (6 domains), `design.md`, `tasks.md` (23/23 complete), `verify-report.md`. This `archive-report.md` is additive and was written after the move (excluded from the source/destination comparison by design).
- No commit created. Native SDD dispatcher and ledger untouched.

## Risks

- **INFO (verify-report suggestions, carried at close)**: (1) `sa:del` pick list renders up to 7 rules without pagination (mirrors the `ac:del` cap) — acceptable, informational; (2) a `sv:*` tap while `awaiting_savings_percent` is open replies "ya procesado" (input prompt stays the active channel) — acceptable, informational; (3) the "Legacy shared income keeps SHARED savings" scenario is satisfied structurally (repository applies `data.visibility` to both movements) rather than by a dedicated split-with-SHARED integration test; the household SHARED flow tests pass — low risk since the bot never creates shared incomes post-redesign; (4) no coverage provider configured — no per-file coverage numbers available.
- **INFO (final state)**: the vitest `testTimeout` bump (5000→15000ms, commit `b2e1039`) is a config-only change; if a future migration integration test needs a stricter timeout, it is a deliberate override with the explanatory comment in `apps/api/vitest.config.ts`.
- **INFO**: two Purpose-section drift observations above could mislead a future reader about the menu/parser contract; follow-up delta recommended (pre-existing from bot-hybrid-ux-v2).
- **INFO**: `git mv` staged the 10 tracked change files as renames; the archive folder and the new `openspec/specs/bot-manage-savings/` are untracked until the next commit; the 5 merged canonical specs show as modified. Working tree otherwise retains the delivered state.

## Summary

`savings-config` closed the SDD cycle: planned, implemented (all tasks complete), verified (PASS, 17/17 requirements, 71/71 scenarios, 921/921 tests, exit 0, typecheck + lint clean), and archived. The migration-lock flake from apply was fixed by the `b2e1039` timeout bump and held through verify. Canonical specs now reflect the savings-rule management surface (sub-menu, list/delete commands, setMyCommands) and the manual per-income choice ([5%][10%][Otro][No apartar] on INGRESO confirmations) with net-income category preserved: 1 new capability (`bot-manage-savings`), 5 updated capabilities. Delivery remains a single-PR-sized unit on `dev`; no PR has been opened.