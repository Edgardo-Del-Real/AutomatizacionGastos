# Proposal: LLM Note Interpreter for Telegram Registration

## Intent

Keyword misses file valid notes under "otro" (manual correction follows), and phrasings like "gaste como 5 mil pesos" — no parseable number — dead-end in help text. Add a Groq LLM interpreter (`openai/gpt-oss-20b`, JSON mode, `fetch`, no new deps) so more Spanish notes register correctly first time; deterministic parsing stays authoritative.

## Scope

### In Scope
- Category suggestion on keyword miss (exact `normalizeForMatch` match against the owner's list).
- Amount rescue: deterministic parse fails → register the LLM amount directly (no confirmation).
- Amount conflict: differing parser/LLM amounts → ask the user; nothing registers silently.
- New `note-interpreter.ts`: `NoteInterpreter` port + `GroqNoteInterpreter` (zod-validated JSON, timeout, no retries, injectable `fetchImpl`).
- Env: optional `GROQ_API_KEY` (no-op without it), `LLM_MODEL`, `LLM_BASE_URL`, `LLM_TIMEOUT_MS`.
- Interpreter stubs in unit harness and integration `buildService` (no real network).

### Non-goals
Relative dates ("ayer"); product column + dashboard surfacing (schema migration); 429 circuit breaker; semantic/embedding category matching; LLM-created categories (never).

## Capabilities

- New `note-interpretation`: interpreter port, Groq client, JSON validation, env config, degrade-to-null contract.
- Modified `telegram-bot`: registration requirements — keyword-miss categorization, amount precedence/rescue, conflict confirmation.
- No spec-level change to `movement-categories` or `money-movements`.

## Approach

Deterministic-first (exploration Approach 1): `parseAmountAndNote` + `matchNote` run first; interpreter fires only on keyword miss or amount-parse failure. User keywords beat LLM suggestions; `classifyMovementType` stays deterministic. Approved rules:
1. LLM category not in the owner's list → "otro" + existing `awaiting_category` correction; never auto-creates categories.
2. Amount conflict → ask which is correct; nothing registers silently.
3. No deterministic amount but the LLM has one → register the LLM amount directly.

Any interpreter failure (HTTP/429/timeout/non-JSON/schema) → `null` → today's exact behavior.

## Affected Areas

| Area | Impact |
|------|--------|
| `apps/api/src/features/telegram/telegram.service.ts` | Modified — interpreter wiring in `handleRegistration` |
| `apps/api/src/features/telegram/note-interpreter.ts` | New |
| `apps/api/src/app.ts` | Modified — DI wiring |
| `apps/api/src/config/env.ts` | Modified — four new vars |
| Telegram unit + integration tests | Modified — interpreter mocks/stubs |

No schema/contracts change. `.env` GROQ key verified — exploration's malformed-line gotcha is stale.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Groq free-tier 429/latency slows ingestion | Med | Timeout, no retries, deterministic fallback |
| Spanish number formats ("1.234,50") mis-normalized | Med | Zod normalization, prompt rules, unit cases |
| LLM returns plausible-but-wrong amount silently | Low | Deterministic amount wins; conflicts ask user |
| Tests hit real Groq endpoint | Low | Injected `fetchImpl`; integration stub |

## Rollback Plan

Single-slice revert — no schema/contract/data migration; remove the env vars and the bot is deterministic-only again.

## Dependencies

- Groq free-tier key (already in `.env`); PostgreSQL :5433 (existing test prerequisite).

## Open Questions

1. Amount-conflict escape: may the user abort or send a new registration instead? Default: follow the `awaiting_category` pattern (new registration abandons the pending question).

## Success Criteria

- [ ] Keyword-miss note with resolvable LLM category registers without correction round-trip
- [ ] "gaste como 5 mil pesos" registers (today: help reply)
- [ ] Conflicting amounts ask the user; nothing registers silently
- [ ] Interpreter absent or failing → behavior identical to today
- [ ] `pnpm --filter @rita/api test` green with stubbed interpreter
