# Proposal: LLM Conversational Bot

## Intent

The bot replies in fixed templates and understands only parser-decodable notes. Make the LLM the conversational brain: it interprets every user message (intent, amount, category, note) and writes the replies. `TelegramService` stays the orchestrator — validates, executes the SAME flow (register → dashboard, persist state, history), then feeds the ACTUAL executed result to the LLM for the reply. Zero hallucination by construction.

## Scope

### In Scope
- Two-call loop per non-command message: `interpret` (strict JSON, temperature 0) → deterministic execute (flow unchanged) → `reply` fed ONLY the executed result. Commands and setup skip the reply call.
- `BotBrain` port (`interpret` + `reply`) replaces `NoteInterpreter`; Groq transport, `normalizeAmountString`, env vars, never-throw/no-retry policy reused verbatim.
- Intent taxonomy: `register_expense`, `correct_amount`, `correct_category`, `query_recent`/`query_balance`/`query_month` (honest redirect — no executor yet), `associate_keyword` (redirect to command), `help`, `off_topic` (expense-scoped redirect, never chat).
- LLM-written branch replies (success, help, correction, conflict, otro, list) with fixed `reply-text.ts` fallback on any reply failure.
- "5 mil" conflict-trigger refinement (below); prompt golden tests; stubbed brain in unit + integration harnesses.

### Out of Scope
Query executors (recent/balance/month); shared Rita account (Fase 2); general chat; multi-user; LLM-created categories (never); semantic matching; LLM classification of dialog-state answers.

## Capabilities

### New Capabilities
- `bot-brain`: conversational LLM port — intent/amount/category/note interpretation, reply generation from executed results, Groq transport, degrade-to-null, prompt + env contracts.

### Modified Capabilities
- `telegram-bot`: intent-first message handling, LLM branch replies with fixed fallback, off-topic/query redirects, conflict-trigger refinement; state machine and commands unchanged.
- `note-interpretation`: superseded — extraction-only port and deterministic-first invocation requirements replaced by `bot-brain`; surviving contracts (degrade-to-null, normalization, suggestion, timeout, env) migrate.

## Approach

Interpret fires on every non-command message; the state machine stays authoritative — the LLM never decides state transitions. Dialog states (`awaiting_setup`/`awaiting_category`/`awaiting_amount_confirmation`) keep deterministic classification; the LLM writes only their branch replies. Any interpret failure (HTTP/429/timeout/schema) → full deterministic flow + fixed reply, no retries.

### "5 mil" stance (first slice)

Refine the conflict trigger, not the parser: a bare digit followed by "mil"/"k" is a known-broken deterministic parse — the LLM amount registers directly, no conflict question. Genuine disagreements (5000 vs 4800) still ask. LLM absent → today's exact behavior. Deterministic "mil" support in `parseAmount` is a follow-up (shared-parser blast radius).

## Affected Areas

| Area | Impact |
|------|--------|
| `apps/api/src/features/telegram/telegram.service.ts` | Modified — brain wiring, intent dispatch, reply call |
| `apps/api/src/features/telegram/note-interpreter.ts` | Modified — port becomes `BotBrain`; transport reused (likely renamed `bot-brain.ts`) |
| `apps/api/src/features/telegram/reply-text.ts` | Modified — templates unchanged + off-topic/query redirect fallbacks |
| `apps/api/src/app.ts`, `apps/api/src/config/env.ts` | Modified — DI swap; same env vars |
| Telegram unit/integration tests | Modified — stubbed brain, prompt goldens |
| `message.parser.ts`, `bot-state.repository.ts`, Prisma schema | Unchanged |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ~2s latency per message (2 calls) | Med | Skip reply call for commands/setup; timeout; degrade |
| Free-tier rate limit (~500 msgs/day) | Low | No retries; deterministic fallback |
| Reply contradicts open question | Med | Reply sees only executed result; fixed template on failure |
| Expense misclassified `off_topic` | Low | Expense-signal bias + few-shots; unknown → deterministic help |
| Prompt drift | Med | Golden prompt tests |

## Rollback Plan

Revert the slice — no schema/contract/data migration. Unset `GROQ_API_KEY` → deterministic-only at runtime, no revert needed.

## Dependencies

Groq free-tier key (in `.env`); PostgreSQL :5433 for integration tests.

## Open Questions

1. May `interpret` classify non-matching prose answers inside `awaiting_amount_confirmation` ("es el de cinco mil")? Default: no — deterministic-only this slice.
2. Owner category names in the interpret prompt (better suggestions, larger prompt) or category-blind as today? Default: category-blind; prompt accepts an optional context field for Fase 2.
3. Note precedence: deterministic note wins, LLM note fills gaps (rescue), never conflict-asks — confirm at spec time.

## Success Criteria

- [ ] "gaste 5 mil en el super" registers 5000 with an LLM-written reply — no conflict question
- [ ] Off-topic message → expense-scoped redirect, never a chat answer
- [ ] "cuánto gasté" → honest not-yet redirect
- [ ] Brain absent/failing → behavior identical to today
- [ ] Dialog round-trips and command replies unchanged
- [ ] `pnpm --filter @rita/api test` green with stubbed brain
