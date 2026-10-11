# Archive Report — bot-hybrid-ux-v2

**Change**: bot-hybrid-ux-v2
**Archived**: 2026-10-01
**Branch**: dev (working tree)
**Store**: hybrid — OpenSpec filesystem + Engram topic `sdd/bot-hybrid-ux-v2/archive-report`
**Status**: success — SDD cycle closed

## Final State (at close)

- Tasks: **31/31** implementation tasks complete (30 planned + 1 corrective, per orchestrator). Persisted tasks artifact (`tasks.md`) audited after the move: 0 unchecked boxes. No stale-checkbox reconciliation was needed or performed.
- Verification: **PASS** — `verify-report.md` (schema `gentle-ai.verify-result/v1`), verdict `pass`, blockers 0, `critical_findings` 0, requirements **76/76**, scenarios **180/180**, evidence_revision `sha256:f077e4d69599329159488d1c9321edc9f3e589f9d7d8b5b257abbf0c124ff0ac`, tests **846/846 (37 files), exit 0**, contracts build/typecheck/lint all exit 0.
- **Flake-fix note (final state)**: the 5 movements-module date-boundary flakes that caused the FIRST verify envelope's `fail` (exit 1, evidence `sha256:747333903be2c140213c589e438c5a37e791ea793713eb550e97b73244632b09`) were **fixed** after apply-progress (Engram #536) and the first verify-report were persisted, in commit `ea3580f` (`fix(movements): deterministic date-scoped seeding for month-bucket tests`, 2 test files, +31/−4, no production code). The final verify re-run confirms those 5 tests green. The earlier `fail` envelope is superseded and never re-presented as current state.
- Commits on `dev`: **15** (14 apply commits `6384fcd..d9d6c63` + `ea3580f` flake fix).
- Delivery: `single-pr` with maintainer-approved `size:exception` (2026-10-01). **No PR created** — local on `dev`; PR creation is the orchestrator/user decision.
- No drift from the change surface: `git diff 6384fcd..ea3580f` shows 34 paths under `features/telegram/` + 2 movements TEST files only (the flake fix); no dashboard, no Prisma migrations, no REST changes.
- No CRITICAL verification findings, no blockers at close, no intentional archive overrides in effect.

## Artifacts Read (traceability)

- `openspec/changes/bot-hybrid-ux-v2/proposal.md`
- `openspec/changes/bot-hybrid-ux-v2/exploration.md`
- `openspec/changes/bot-hybrid-ux-v2/specs/` — all 17 delta/full specs (`bot-brain`, `bot-expense-lifecycle`, `bot-free-text-routing`, `bot-inline-interactions`, `bot-main-menu`, `bot-manage-categories`, `bot-manage-expenses`, `bot-reports-menu`, `conversational-categories`, `money-movements`, `movement-categories`, `movement-correction`, `planned-fixed-expenses`, `quick-capture`, `registration-collection`, `savings`, `telegram-bot`)
- `openspec/changes/bot-hybrid-ux-v2/design.md` (decisions D1–D10)
- `openspec/changes/bot-hybrid-ux-v2/tasks.md` (31/31 checked)
- `openspec/changes/bot-hybrid-ux-v2/verify-report.md`
- Engram observation **#536** `sdd/bot-hybrid-ux-v2/apply-progress` (intermediate snapshot; superseded by final-state facts on the flake fix)
- Engram observation **#541** `sdd/bot-hybrid-ux-v2/verify-report` (final PASS verify)
- Canonical specs: `openspec/specs/{bot-brain,bot-expense-lifecycle,bot-inline-interactions,bot-main-menu,conversational-categories,money-movements,movement-categories,movement-correction,planned-fixed-expenses,quick-capture,registration-collection,savings,telegram-bot}/spec.md`
- Config: `openspec/config.yaml` (`rules.archive`: warn before merging destructive deltas — REMOVED blocks all carried `(Reason:)`/`(Migration:)`; no large-section removal beyond the intended capability removal, which follows precedent)

## Spec Sync (delta → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| bot-free-text-routing | Created (new capability) | Full spec copied byte-identically (`diff` empty) |
| bot-manage-categories | Created (new capability) | Full spec copied byte-identically (`diff` empty) |
| bot-manage-expenses | Created (new capability) | Full spec copied byte-identically (`diff` empty) |
| bot-reports-menu | Created (new capability) | Full spec copied byte-identically (`diff` empty) |
| bot-brain | Updated | 5 MODIFIED blocks replaced (incl. rename `Prompt Contract (category-blind, dialog-aware)` → `Prompt Contract (three-intent)`); 3 REMOVED blocks deleted |
| bot-expense-lifecycle | Updated | 1 ADDED block appended; 3 MODIFIED blocks replaced |
| bot-inline-interactions | Updated | 2 MODIFIED blocks replaced |
| bot-main-menu | Updated | 3 MODIFIED blocks replaced; 1 ADDED block appended |
| conversational-categories | Updated | 1 MODIFIED block replaced; 1 ADDED block appended |
| money-movements | Updated | 1 MODIFIED block replaced; 1 ADDED block appended |
| movement-categories | Updated | 2 MODIFIED blocks replaced; 1 ADDED block appended |
| movement-correction | Updated | 3 MODIFIED blocks replaced |
| planned-fixed-expenses | Updated | 1 MODIFIED block replaced |
| quick-capture | Updated | 4 MODIFIED blocks replaced (incl. renames `Type Selection by Button` → `Type Selection by Menu`, `Deterministic-First Ordering` → `Menu-Gated Capture Ordering`); 1 ADDED block appended |
| savings | Updated | 2 MODIFIED blocks replaced; 1 REMOVED block deleted |
| telegram-bot | Updated | 10 MODIFIED blocks replaced (incl. rename `Planned Expense Registration (`previsto:` prefix)` → `Planned Expense Registration (Gasto previsto button)`); 5 REMOVED blocks deleted |
| registration-collection | **Deleted** (capability fully removed) | All 9 requirements REMOVED with Reason/Migration; canonical spec file deleted per precedent (53bb18e deleted a fully-removed capability's spec) |

Merge method: incremental, byte-exact, shell-executed (never routed through model Read/Write for whole-file copies). Each MODIFIED delta block replaced the matching canonical block wholesale — body, `(Previously: ...)` note, and scenarios — per the OpenSpec convention and the pattern of prior archive syncs. ADDED blocks were appended at EOF with exactly one blank-line separator. REMOVED blocks carried `(Reason: ...)`/`(Migration: ...)` before deletion. Requirements not mentioned in the deltas were preserved verbatim (e.g. telegram-bot Long-Polling Lifecycle, Owner Filtering, Reply Channel, Savings Rule Command; bot-brain Degrade-to-Null, Amount Normalization; quick-capture Save Idempotency; movement-correction Correction Safety; savings SavingsRule Model, KPI invariants; money-movements endpoint/visibility contracts).

Byte fidelity readback (mandatory): every merged block verified byte-identical (LF-normalized, trailing separator normalized) against its delta source — **37 MODIFIED PASS, 6 ADDED PASS, 18 REMOVED verified absent** (registration-collection ×9, telegram-bot ×5, bot-brain ×3, savings ×1). New canonicals verified byte-identical at copy time. Line endings: spliced content converted to each canonical's dominant EOL (CRLF after git autocrlf normalization); deltas are LF; no mixed-EOL drift introduced.

## Canonical Drift Observations (pre-existing headers, NOT covered by any delta — preserved, flagged)

1. `openspec/specs/bot-main-menu/spec.md` — Purpose still reads "five inline actions (Nuevo gasto, Gasto previsto, Borrar, Reporte, Ayuda)", while the merged Main Menu Actions requirement mandates **eight** buttons (➕ Nuevo gasto, 📅 Gasto previsto, ➕ Ingreso, 👥 Compartido, 🗂 Administrar categorías, 🧾 Administrar gastos, 📊 Reportes, ❓ Ayuda). The delta did not modify the Purpose section, so it was preserved verbatim; the two now disagree.
2. `openspec/specs/quick-capture/spec.md` — Purpose still says the parser "resolves the category against the owner's CLOSED category set", while the merged Deterministic Capture Parser requirement states the parser yields `{amount, note}` only and "MUST NOT resolve, infer, or match any category — the category is chosen by button at the preview".
3. `openspec/specs/bot-brain/spec.md` — Purpose still says the brain "interprets every conversational message into a strict intent envelope", while the merged intent taxonomy limits the brain to idle query/greeting classification only (capture-shaped text and legacy prefixes are handled deterministically before the brain).

Recorded rather than silently resolved, per the archive Final-State Authority contract. Recommended follow-up delta to align these Purpose sections with the button-first surface.

## Archive

- Moved `openspec/changes/bot-hybrid-ux-v2/` → `openspec/changes/archive/2026-10-01-bot-hybrid-ux-v2/`. The change folder is untracked in git, so `git mv` refused (exit 128); the plain-`mv` fallback ran after verifying the pre-move snapshot matched the source (`git diff --no-index --quiet` exit 0). Destination collision guard passed; active `openspec/changes/` no longer contains the change.
- Mandatory readback: recursive `git diff --no-index --quiet` of the pre-move snapshot vs the archived destination — **EMPTY output, exit 0 (byte-identical)**. Warnings emitted were only git's autocrlf LF→CRLF notices, identical on both sides.
- Archive contents: `proposal.md`, `exploration.md`, `specs/` (17 domains), `design.md`, `tasks.md` (31/31 complete), `verify-report.md`. This `archive-report.md` is additive and was written after the move (excluded from the source/destination comparison by design).
- No commit created. Native SDD dispatcher and ledger untouched.

## Risks

- **WARNING (verify-report)**: apply-progress (Engram #536) lacks the formal per-task TDD Cycle Evidence table (RED/GREEN/TRIANGULATE/SAFETY-NET) the Strict TDD module expects; the mode/phase/commit/verification evidence is present in narrative form and independently substantiated (interleaved RED/GREEN commits, tests present and green). No table backfill was required to archive; flagged for process-evidence format.
- **INFO (verify-report suggestions)**: a dedicated "delete target survives restart" unit test would strengthen restart-persistence coverage; `pv:catnew` save-token embedding could use a token-rotation note in future design work; the movements flake fix (`ea3580f`) is a test-only change outside the change surface — tracked here for auditability.
- **INFO**: three Purpose-section drift observations above could mislead a future reader about the menu/parser/brain contract; follow-up delta recommended.
- **INFO**: plain-`mv` archive (untracked change folder) leaves the archive untracked in git until the next commit; working tree otherwise retains the delivered state.

## Summary

`bot-hybrid-ux-v2` closed the SDD cycle: planned, implemented (31/31), verified (PASS, 76/76 requirements, 180/180 scenarios, 846/846 tests, exit 0), and archived. The 5 date-boundary flakes from the first verify were fixed by `ea3580f` (test-only) and are green at close; the earlier `fail` envelope is superseded. Canonical specs now reflect the menu-first deterministic UX: 4 new capabilities (bot-free-text-routing, bot-manage-categories, bot-manage-expenses, bot-reports-menu), 12 updated capabilities, and registration-collection deleted as a fully removed capability. Delivery remains a single PR-sized unit (maintainer-approved `size:exception`) on `dev`; no PR has been opened.