# Tasks: LLM Note Interpreter for Telegram Registration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,100–1,500 |
| 5000-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
5000-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full interpreter slice (port, bot integration, tests) | PR 1 (single) | `pnpm --filter @rita/api test src/features/telegram/note-interpreter.test.ts` | Integration suite: real Prisma + stubbed interpreter, never the real Groq endpoint | Revert slice: drop the 4 env vars + `interpreter` dep → deterministic-only; no schema/data/contract change |

## Phase 1: Foundation — Interpreter port & client

- [x] 1.1 Create `note-interpreter.ts` — port `NoteInterpreter`, `InterpretedNote`, pure exported `normalizeAmountString` (rules: `$ 1.234,50`→1234.5, `1234,50`→1234.5, `1234.5`→1234.5, `1,234.50`→1234.5, `1.234`→1234, `5 mil`→5000, `mil`→1000, `2k`→2000; `NaN`/`0`/`-5`/`""`/`abc`→null), zod `interpretedNoteSchema` (amount union number|string → transform; refine finite > 0), `SYSTEM_PROMPT` (es-AR, JSON-only, never invent amount, ARS), `GroqNoteInterpreter` (fetch POST, `AbortSignal.timeout(timeoutMs)`, 1 attempt, no retry, every failure → `null`, injectable `fetchImpl`). Files: `apps/api/src/features/telegram/note-interpreter.ts`. Δ ~230.
- [x] 1.2 Create `note-interpreter.test.ts` — fake `fetchImpl` (zero network): happy path (string and number amount); non-JSON HTTP body; `choices[0].message.content` not a string; HTTP 429 and 500; timeout (fetchImpl rejects `AbortError`; assert an `AbortSignal` was passed); schema rejects (amount 0 / -5 / "NaN" / missing, category 61 chars, empty category string); `normalizeAmountString` table incl. `"$ 1.234,50"`, `"1234,50"`, `"1234.5"`, `"1,234.50"`, `"1.234"`, `"5 mil"`, `"mil"`, `"2k"`, `"abc"`, `""`, `"0"`, `"-5"`. Files: `apps/api/src/features/telegram/note-interpreter.test.ts`. Δ ~300.

## Phase 2: Config & DI

- [x] 2.1 Add 4 vars to `apps/api/src/config/env.ts` — `GROQ_API_KEY` `z.string().min(1).optional()`, `LLM_MODEL` default `openai/gpt-oss-20b`, `LLM_BASE_URL` `z.string().url()` default Groq chat-completions, `LLM_TIMEOUT_MS` `z.coerce.number().int().positive()` default 5000. Test: invalid `LLM_BASE_URL` fails startup with zod config error. Δ ~10.
- [x] 2.2 Wire DI in `apps/api/src/app.ts` — construct `GroqNoteInterpreter` only when `env.GROQ_API_KEY` is set (no `fetchImpl` → global fetch); otherwise omit `interpreter` → deterministic-only, `interpret` never invoked (spec scenario). Δ ~10.

## Phase 3: Bot integration — state, replies, service

- [ ] 3.1 `apps/api/src/features/telegram/bot-state.repository.ts`: `BOT_STATES` += `"awaiting_amount_confirmation"` (Prisma `state` is `String` — no migration). Δ ~5.
- [ ] 3.2 `apps/api/src/features/telegram/reply-text.ts` += `amountConflictReply(deterministic, llm)` (both via `formatARS`, voseo: "respondé con el monto, o mandá un registro nuevo y lo descarto") and `amountConfirmationAbandonedReply()`; additive tests in `reply-text.test.ts`. No existing reply text changes. Δ ~75.
- [ ] 3.3 `apps/api/src/features/telegram/telegram.service.ts`: deps += `interpreter?: NoteInterpreter`; `tryInterpret` (null when dep absent; try/catch → null, belt-and-braces); `resolveSuggestion` (exact `normalizeForMatch` vs `listCategories`, preserves owner spelling; null / "otro" → null; never `createCategory`); `amountConfirmationPayloadSchema` (`body`, `note` nullable, `amounts` positive tuple, `category` nullable); restructured `handleRegistration`: `parseAmountAndNote` → `listCategories` → zero categories → `awaiting_setup` BEFORE any interpreter call; keyword match → register, interpreter NOT invoked; miss → `interpret(body)` → null → otro+correction (today) | `amount !== parsed.amount` → persist + `amountConflictReply` | equal → resolveSuggestion → `registerWithCategory` | `registerOtroWithCorrection`; rescue (`parsed === null`) → interpret → null → `helpReply` (today) | amount → register `{ amount, note: extractNote(body) }` + category tail; shared tails `registerWithCategory` + `registerOtroWithCorrection`. Δ ~200.
- [ ] 3.4 `telegram.service.ts`: `handleAwaitingAmountConfirmation` + `handleUpdate` route (next to `awaiting_category`) — decode via `safeParse` (failure → clear to idle, abandonment reply, process text as new registration); `replied = normalizeAmountString(body) ?? parseAmount(body)` (normalize FIRST — `"5 mil"` → 5000 beats lone-`5` parser trap; `parseAmount` catches `"es 5000"`); match → register from STORED context: `createMovement(payload.body, { amount: chosen, note: payload.note }, category)` (`classifyMovementType` on original body); category ≠ null → `successReply` → idle | null → `ensureOtro` + register in "otro" + `awaiting_category` (`pendingMovementId`, `pendingNote = payload.note`) + `correctionOfferReply`; create failure → log, question stays open; no match → clear-to-idle FIRST + `amountConfirmationAbandonedReply()` + `handleRegistration(body)` (nothing registers from conflicting message). Δ ~120.

## Phase 4: Tests — service & integration (stubbed interpreter)

- [ ] 4.1 `telegram.service.test.ts` harness += `interpret: vi.fn()`; existing matched-note case += `expect(mockInterpret).not.toHaveBeenCalled()`; zero-categories case asserts interpret not called. Δ ~40.
- [ ] 4.2 New unit cases (verified inputs): keyword miss + resolvable suggestion → registered with owner's category spelling, no correction round-trip; miss + unknown suggestion → otro + `awaiting_category`, `createCategory` never called; miss + suggestion "otro" → correction offered; miss + `interpret` null → today's otro path; rescue `"compre mercaderia"` + `{amount: 5000}` → direct register (resolved-category and otro variants); rescue `"gaste cinco mil pesos"` / `"1234,50 cafe"` + null → help, nothing created; conflict `"gaste como 5 mil pesos"` (parser **5** vs LLM 5000 — verified) → no create, state `awaiting_amount_confirmation` + encoded `pendingNote` JSON, reply shows both `formatARS` amounts; answer `"5000"` → registered 5000 (resolved-category and otro+correction variants); answer `"6000"` (neither) → abandonment reply + new text processed normally; restart survival (pre-seed state via `amountConfirmationPayloadSchema` payload); commands during confirmation don't consume it. Δ ~250.
- [ ] 4.3 `telegram.service.integration.test.ts`: `buildService(logger?, interpreter?)` — default no interpreter (existing tests untouched); stubbed: suggestion resolves to a seeded category; rescue registers 5000 from `"compre mercaderia"`; conflict writes a `botState` row `awaiting_amount_confirmation`; answer after a `buildService()` rebuild (restart survival); abandonment registers nothing from the conflicting message. Real Prisma on `TEST_DATABASE_URL`; never the real Groq endpoint. Δ ~120.

## Phase 5: Verification

- [ ] 5.1 Full gate: `pnpm --filter @rita/api test` green (strict TDD — tests written with code), `pnpm --filter @rita/api typecheck`, `pnpm lint`. Δ ~0.

> **Parser-verified input note**: spec scenario "No amount rescued by the interpreter" uses `"gaste como 5 mil pesos"`, but `parseAmount` yields **5** for it (verified against `message.parser.ts`) — that body exercises the AMOUNT-CONFLICT path (5 vs 5000), NOT rescue. Rescue tasks/tests above use genuinely unparseable bodies (`"compre mercaderia"`, `"gaste cinco mil pesos"`, `"1234,50 cafe"`, `"$ 1.234,50 supermercado"`, `"1234.5 cafe"`). Amend the spec scenario text at archive time.