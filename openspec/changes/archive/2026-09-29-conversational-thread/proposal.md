# Proposal: Conversational Thread — Registration Detail Collection

## Intent

No persisted "in-progress registration" exists: an amount-less "quiero cargar un gasto previsto" gets a free-text brain question over `action:"none"` with NO state persisted (telegram.service.ts:444-450), so follow-ups ("gym") re-interpret as fresh commands and misroute into category CRUD. Goal: ask "¿qué monto?" then "¿en qué categoría?", keep the registration alive across turns, and greet back without killing an open dialog.

## Scope

### In Scope
- New `awaiting_registration` state + zod payload (`body, note, amount?, category?, shared, planned, override`) in `BotState.pendingNote`; no migration.
- Deterministic entries (amount-null `:444-450`; category-signal-unresolved `:474-480`) and resolvers: amount-answer; category cascade (exact → folded plural → guarded single-token auto-create → multi-word list-and-stay-open); abandon; queries/CRUD/off_topic never consume the pending.
- Reply action `asked_registration` with fixed fallbacks (`reply-text.ts`).
- Real `greeting` intent: warm reply; open dialogs stay alive (signed reversal of never-chat).
- Brain context teaching (`InterpretContext`, addendum/few-shots), goldens regeneration, spec deltas.

### Out of Scope
- Reusing `awaiting_category` (correction-only + phantom guard — CRITICAL).
- money-movements / planned-fixed-expenses deltas (guarded create path reused unchanged).
- Brain-less collection beyond brain envelopes / deterministic prefixes ("gym" keeps helpReply).
- `awaiting_movement_selection` behavior.

## Capabilities

### New Capabilities
- `registration-collection`: collect dialog — state, payload, entries, resolver cascade, abandon, non-consuming intents, restart + corrupt-payload recovery, deterministic-only mode.

### Modified Capabilities
- `telegram-bot`: Per-Owner State Machine (new state + restart), Dialog Controller (new state), Intent-First Handling (`greeting` routing), reply content (greeting + ask templates).
- `bot-brain`: Intent Taxonomy + Envelope Contract (`greeting`), Reply-After-Action (`asked_registration`), Dialog Action + Prompt Contracts (teaching, goldens).

## Approach

Copy proven patterns: `amountConfirmationPayloadSchema` (`:125-135`) for the payload; the D6 category-answer cascade (`d6AwaitingCategory:707-798`) for resolution. The state machine stays transition authority — brain classifies; deterministic code enters/persists/resolves/consumes (phantom-guard rule). Sequence: amount → category → register from stored context.

## Affected Areas

| Area | Impact |
|------|--------|
| `apps/api/src/features/telegram/telegram.service.ts` | Modified — state constants, payload schema, entries, resolvers, greeting routing |
| `apps/api/src/features/telegram/{bot-brain.ts, bot-state.repository.ts, reply-text.ts, __goldens/*}` | Modified — context union, prompts, taxonomy, state name, templates, goldens |
| `apps/api/src/features/telegram/*.test.ts` | Modified — dialog suites extended; locked tests updated with deltas |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Conflating collect with `awaiting_category` | High | New state; never reuse |
| Pinned prompt goldens fail on teaching | High | Regenerate in-cycle |
| LLM decides state transitions | Medium | Entry/persist/consume deterministic |
| Greeting reverses locked never-chat tests | Medium | Deliberate spec delta + test updates |
| Multi-word non-category answers dead-end | Medium | List categories, stay open |

## Rollback Plan

Additive state + payload: remove the state/schema/resolvers/teaching and restore goldens + locked tests from git. No Prisma migration; stale collect rows degrade via corrupt-payload recovery (amount-confirmation precedent).

## Dependencies

- PostgreSQL on localhost:5433 (integration suite).
- Load-bearing tests updated with deltas: telegram.service.test.ts (`:584-783`, `:2023-2455`), bot-brain.test.ts (`:859-932`, `:1065-1110`).

## Success Criteria

- [ ] "quiero cargar un gasto previsto" → dialog persisted → "dale, 5000" → category question → "gym" resolves → registered; no misroute.
- [ ] "hola" greets back; the open collect dialog survives.
- [ ] Suite green with deliberate updates; goldens regenerated.
- [ ] Restart survival + corrupt-payload recovery.

**Evidence**: `exploration.md` in this folder (bug path, proven patterns, locked tests).
