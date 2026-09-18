# Proposal: Bot Conversation Controller

## Intent

The bot breaks in dialog states. User-verified: queries/prose in `awaiting_category` all get the same reassignment prompt; mixed intents ("creá X y guardalo ahí") never execute; `correct_category` is dormant; a bare "si" registered a fabricated movement. Dialog states bypass the brain. Make the LLM the controller in ALL states; deterministic executors stay authoritative.

## Scope

### In Scope
- Dialog-aware `interpret`: context = state + pending payload + open question; envelope gains `dialog_action: resolve | abandon | null`.
- Dialogs route through the brain; today's D6 rules become the fallback (brain null/absent).
- Queries and CRUD execute during dialogs without consuming the pending.
- `correct_category` executor: reference → matcher (recent, amount + note) → reassign; ambiguous → ask.
- Mixed intent: create_category + reassign-pending (`then_reassign`).
- Phantom guard: resolve uses only the persisted payload; affirmations without an answer never register.

### Out of Scope
Multi-user (Fase 2); general chat; dashboard changes; new data models; `awaiting_setup`; keyword learning.

## Capabilities

### New Capabilities
- `movement-correction`: free-form correction of past movements — matching, reassignment, ambiguity.

### Modified Capabilities
- `bot-brain`: dialog context, `dialog_action`, `then_reassign`, dialog-aware prompts.
- `telegram-bot`: brain-routed dialogs, deterministic fallback, dialog-safe queries/CRUD, mixed create + reassign, phantom guard.

## Approach

Keep the two-call loop; dialog classification moves into the envelope. Order: dedupe → owner → command → state → `interpret(body, {state, pending, openQuestion})`. `resolve` → deterministic resolution from the persisted payload only; `abandon`/null-brain → D6 rules verbatim; `null` → intent routing, pending untouched; `register_expense` → abandon + register. New `movement-corrector.ts`: amount equality + note similarity over a recent window; unique hit → `updateMovement`, else ask. `then_reassign` chains create → reassign.

## Affected Areas

| Area (`apps/api/src/features/telegram/`) | Impact |
|---|---|
| `telegram.service.ts` | Modified — dialog controller, guard |
| `bot-brain.ts` | Modified — context, prompts |
| `movement-corrector.ts` | New — matcher, reassign |
| `reply-text.ts` | Modified — fallbacks |
| `*.test.ts` | Modified — goldens, routing |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Misrouted resolve | Med | Payload-only resolve; wrong abandon keeps "otro" |
| Prompt drift | Med | Goldens, per-dialog few-shots |
| Matcher ambiguity | Med | Recency tie-break; ask |
| Dialog latency | Low | Timeout, fallback |

## Rollback Plan

No schema/data migration. Revert the slice; unset `GROQ_API_KEY` → dialogs return to today's rules.

## Dependencies

Groq key (existing env); PostgreSQL :5433; existing `movementService` primitives.

## Open Questions

1. Open-question context: reconstruct from payload vs persist last reply? Default: reconstruct.
2. Matcher window: 10 movements or 30 days? Default: 10 by recency.
3. `then_reassign` without pending: ignore or correct_category-by-reference? Default: ignore.
4. Spec pins query redirects though queries execute — sync here? Default: yes.

## Success Criteria

- [ ] "decime los últimos movimientos" in dialog answers; pending intact
- [ ] "creá gastos hormiga y guardalo ahí" → created + reassigned, one reply
- [ ] "esos 2500 → gastos hormiga" → reassigned; ambiguous → asks
- [ ] Bare "si" on a pending question registers nothing
- [ ] Brain null/absent in dialogs → today's behavior
- [ ] `pnpm --filter @rita/api test` green
