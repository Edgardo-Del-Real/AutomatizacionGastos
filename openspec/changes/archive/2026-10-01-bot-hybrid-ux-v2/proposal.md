# Proposal: Bot Hybrid UX v2 — Menu-First Deterministic Capture

## Intent

Idle free text hits LLM capture fallback (keywords, prefixes, dialogs), so "14000 pasaje" re-asks its amount. The owner's redesign (2026-09-30): menu-first, deterministic, buttons everywhere; LLM only for queries/greetings.

## Scope

### In Scope

- Main menu, 8 owner-confirmed buttons: ➕ Nuevo gasto, 📅 Gasto previsto, ➕ Ingreso, 👥 Compartido, 🗂 Administrar categorías, 🧾 Administrar gastos, 📊 Reportes, ❓ Ayuda; `/start` always renders it.
- Capture: menu tap stores the type; `monto+nota` → preview "¿Guardamos? $ 14.000 (pasaje)" with existing-category buttons (no "otro"), gated Guardar, ➕ create-category (returns selected), Corregir.
- Idle free text: query → LLM answer; greeting → greet + menu; capture-shaped text and legacy prefixes (`previsto:`/`compartido:`/`sin ahorro`/`con X%`) → educational redirect; else "no puedo resolver eso" + menu.
- Sub-menus: Administrar gastos (delete/correct/mark-paid), Administrar categorías (create/rename/delete), Reportes (five queries + free text).
- Savings: automatic % on Ingreso per pre-defined rule; no button.
- Remove `awaiting_category`, `awaiting_registration`, `awaiting_amount_confirmation`; keep `awaiting_setup` + `/configurar categorias`; menu tap abandons pending preview; post-action menu; Ayuda rewritten; keywords bot-unused (dashboard data intact).

### Out of Scope

- Dashboard changes; Prisma migrations (reuse `pendingNote` payloads); chained-PR slicing (sdd-tasks); REST endpoints.

## Capabilities

### New

- `bot-free-text-routing` — idle routing + offline fallback.
- `bot-manage-expenses` — Administrar gastos chains.
- `bot-manage-categories` — Administrar categorías sub-menu.
- `bot-reports-menu` — Reportes sub-menu + free text.

### Modified

- `bot-main-menu` — 8 buttons; tap supersedes pending; help rewrite.
- `quick-capture` — amount+note only; menu-tap type; category-gated preview + ➕.
- `telegram-bot` — no idle capture; state overhaul; prefix removal; command trim.
- `bot-inline-interactions` — new callbacks; keyboard limits.
- `conversational-categories` — button-chosen, never inferred; "otro" legacy.
- `registration-collection` — REMOVED (dialog eliminated).
- `movement-correction` — button-driven picks.
- `bot-expense-lifecycle` — sub-menu entries; mark-paid chain.
- `savings` — split on Ingreso; legacy redirects.
- `bot-brain` — query/greeting only.
- `planned-fixed-expenses` — button-only creation.
- `money-movements` — types by menu button.
- `movement-categories` — no auto-"otro" creation.

## Approach

Single full-redesign change (exploration Approach 1): replace the capture/edit surface; reuse deterministic executors, delete gate, save-token idempotency, callback channel, `BotStateRepository`; shrink the brain. Chained PRs planned in sdd-tasks.

## Affected Areas

- Modified: `apps/api/src/features/telegram/` — `telegram.service.ts`, `telegram.parser.ts`, `bot-brain.ts`, `reply-text.ts`, `bot-state.repository.ts`, `telegram.commands.ts`, `telegram.bot.ts`, `*executor*.ts`, `*.test.ts` + `__goldens__/`, `app.ts`; `openspec/specs/*` deltas.

## Risks

- **CRITICAL** — ~679 tests encode removed flows → TDD rewrite; regenerate goldens.
- **CRITICAL** — free-text refusal is a visible change → educational-redirect scenarios.
- **WARNING** — capture-type memory traps queries → non-capture message supersedes.
- **WARNING** — LLM shrink degrades classification → keep three-intent taxonomy.
- **WARNING** — legacy "otro" readability → reserved guard; excluded from preview.
- **INFO** — keyboard limits (8 rows/64 bytes) → `cp:` pagination.
- **INFO** — persisted payloads across rollback → corrupt-payload recovery.
- **INFO** — exceeds 400-line budget → chained PRs (sdd-tasks).

## Rollback Plan

Revert the deploy commit (no migrations). Old code treats new persisted states as corrupt payloads, recovering to `idle`; no external consumers.

## Dependencies

None external. PostgreSQL (localhost:5433) for tests; `GROQ_API_KEY` optional — deterministic fallback required.

## Success Criteria

- [ ] "14000 pasaje" in idle → educational redirect, never capture.
- [ ] Menu → monto+nota → category → Guardar registers with zero LLM calls.
- [ ] Four capture types register from buttons; Ingreso triggers savings split.
- [ ] Reportes buttons + free-text queries answer from real data.
- [ ] `pnpm --filter @rita/api test` green; three dialog states removed.
