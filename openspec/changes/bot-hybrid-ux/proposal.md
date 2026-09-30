# Proposal: Bot Hybrid UX — Inline Buttons + Deterministic Capture + Bounded LLM

## Intent

LLM-first routing causes 4 confirmed bugs: silent most-recent deletes; planned expenses misrouted (`previsto:` start-anchored → "otro"); reserved-concept dead-end loops; ghost categories from free-text auto-create. Implements the owner-approved P0 hybrid model.

## Scope

### In Scope
- Channels: `callback_query` parser, `handleUpdate` branch, reply port text → text+keyboard+editMessageText, harness migration, offline keyboard assertions via `recordApiCalls` (decision #4).
- `QuickCaptureParser`: amount regex, keyword vs closed set → preview `[✅ Guardar] [✏️ Corregir]`; Real/Previsto by button (fixes #2).
- Delete gate: `awaiting_delete_confirmation`, persisted target id, `[❌ Cancelar] [🗑 Borrar]` (fixes #1).
- Dialog categories → buttons; unknown → buttons, never free text; no auto-create (decision #3).
- Menu (Nuevo gasto/Gasto previsto/Borrar/Reporte/Ayuda), `setMyCommands`, static help (decision #1).
- Ghost cleanup script: drop "No.", "si", "Borrar categoría: no"; orphans → "otro" (decision #2).

### Out of Scope
- `money-movements`/`planned-fixed-expenses`/`movement-correction` untouched (executors reused); no Prisma migration (`pendingNote` pattern); dashboard; group chats.

## Capabilities

### New Capabilities
- `bot-inline-interactions`: callback routing, keyboard port, idempotency, stale buttons, limits (≤8 rows, ≤64 bytes).
- `quick-capture`: deterministic parser vs closed set, preview, type-by-button.
- `bot-main-menu`: menu, `setMyCommands`, static help.

### Modified Capabilities
- `telegram-bot`: Update Filtering (callbacks); Reply Channel (signature); Per-Owner State Machine (preview/delete-confirm states); Intent-First Handling (deterministic-first, LLM fallback); Bot Commands (menu); Correction Loop, Guarded Funnel (buttons, no auto-create); Planned Registration (type by button); Dedup (callbacks).
- `bot-brain`: uncaptured-intent fallback only; never picks delete target or infers type.
- `bot-expense-lifecycle`: Delete-Expense Execution — confirmation gate, explicit target.
- `movement-categories`: closed set, no auto-create, ghost cleanup.
- `conversational-categories`: Gated Dialog Auto-Create removed → buttons.
- `registration-collection`: Category-Answer Cascade → closed-set buttons.

## Approach

Enfoque 1 (explore): integrated deterministic-first router, ONE state machine. Idle: `QuickCaptureParser` before `brain.interpret`; match → preview; else LLM fallback (queries, CRUD, corrections). Stages: (a) parser, payloads (RED) → (b) keyboard port, callbacks, category buttons → (c) preview, type → (d) delete gate → (e) menu/help. Tradeoff: touches the 2509-line router and breaks the reply signature, but avoids dual state machines (drift) and ships the full model; minimal slice leaves bug #2.

## Affected Areas

| Area | Impact |
|------|--------|
| `apps/api/src/features/telegram/telegram.service.ts` | Modified — router, callback branch, states, ReplyPort |
| `apps/api/src/features/telegram/{telegram.bot, telegram.parser, reply-text, bot-state.repository, bot-brain}.ts` | Modified — callback handler, `setMyCommands`, templates, states |
| `apps/api/src/features/telegram/movement-lifecycle-executor.ts` | Modified — delete-gate wiring |
| `apps/api/src/features/telegram/*.test.ts` | Modified — harness migration, keyboard assertions |
| `apps/api/scripts/` | New — ghost cleanup |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Reply signature breaks 4621-line harness | High | Pre-approved; `recordApiCalls` assertions |
| Callback retries double-execute | Med | Dedup; idempotent handlers; save-token |
| Stale buttons | Med | Server revalidation; missing replies; new-message fallback |
| Brain-scope regression ("only queries") | Med | Spec: fallback for uncaptured intents (greetings/CRUD stay) |
| Ghost script destructive | Med | Dry-run + DB backup |

## Rollback Plan

Additive: revert branch; no migration (stale `pendingNote` → corrupt-payload recovery); restore pre-run DB backup for ghosts; goldens from git.

## Dependencies

- PostgreSQL :5433, test DB; grammy 1.46; `multi-user-phase-2` archived first (same specs).

## Success Criteria

- [ ] "Borrar" → target list → `[❌ Cancelar] [🗑 Borrar]`; zero silent deletes (#1).
- [ ] "30000 gym" → deterministic preview, no LLM; type by button (#2).
- [ ] Unknown/reserved → buttons; no loops, no new ghosts (#3/#4).
- [ ] Phantoms cleaned; orphans on "otro".
- [ ] LLM only for uncaptured intents; suite green with migrated harness.

**Evidence**: Engram `sdd/bot-hybrid-ux/explore` (#511).
