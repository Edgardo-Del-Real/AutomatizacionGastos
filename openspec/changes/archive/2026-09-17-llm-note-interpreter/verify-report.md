```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:cd57edae4e3d816714b7cd890184ca3dacee0da209397db09fba96bcb56f578a
verdict: pass
blockers: 0
critical_findings: 0
requirements: 12/12
scenarios: 34/34
test_command: pnpm --filter @rita/api test
test_exit_code: 0
test_output_hash: sha256:068cba9431b5cb4935570f849fa419a73b82106f3473c68a1ba3434aa9bf5623
build_command: pnpm --filter @rita/api typecheck
build_exit_code: 0
build_output_hash: sha256:095575b40808b9e67c0e64349658cbd6f005dd95d268ce6cbad0ef14054a08f2
```

# Verify Report: llm-note-interpreter

Change: `llm-note-interpreter` · Branch: `feat/llm-note-interpreter` (HEAD `450ab99`, base `feat/bot-learning-improvements`) · Verdict: **pass**

## Executive Summary

The interpreter slice is implemented exactly per spec and design: an optional `NoteInterpreter` port with a Groq client (`note-interpreter.ts`) that never throws and degrades to `null` on every failure class, wired deterministically-first into `telegram.service.ts` (keyword miss → category suggestion + amount-conflict check; parse failure → amount rescue), a persisted `awaiting_amount_confirmation` state with restart survival, and strict env optionality (no `GROQ_API_KEY` → deterministic-only). All 12 requirements (9 note-interpretation + 3 telegram-bot delta) and all 34 scenarios are covered by 317 passing tests (18 files), typecheck clean, lint clean. No blockers, no critical findings. One known spec-text caveat (the "gaste como 5 mil pesos" scenario example is actually the conflict path, not rescue) is flagged for the archive-phase amendment; rescue behavior itself is fully tested with genuinely unparseable inputs.

## Test Evidence

| Check | Command | Result |
|---|---|---|
| Full suite | `pnpm --filter @rita/api test` (contracts build + `vitest run`) | **18 files passed (18), 317 tests passed (317)**, exit 0, 15.25s |
| Typecheck | `pnpm --filter @rita/api typecheck` | exit 0 (0 errors) |
| Lint | `pnpm --filter @rita/api lint` | exit 0 (0 problems) |

- Integration DB: `rita-postgres` container healthy on localhost:5433, DB `automatizacionrita_test` present; `prisma migrate deploy` runs in `beforeAll`; no 10s hook timeout trip.
- Growth vs baseline: 243 → 317 tests (+74), 17 → 18 files (+1 `note-interpreter.test.ts`). Matches apply-progress.
- Interpreter unit tests (`note-interpreter.test.ts`): 45 tests, zero network (fake `fetchImpl`).

## Requirement Coverage — 12/12

| # | Requirement (spec file) | Verdict | Evidence |
|---|---|---|---|
| 1 | Note Interpreter Port (note-interpretation) | ✅ pass | `NoteInterpreter` + `InterpretedNote` + `GroqNoteInterpreter` in `note-interpreter.ts`; bot consumes only via optional `interpreter?` dep |
| 2 | Degrade-to-Null Contract (note-interpretation) | ✅ pass | Whole body try/catch → null; HTTP !ok → null; non-JSON, non-string content, JSON.parse failure, schema failure, network/timeout → null |
| 3 | Amount Normalization and Validation (note-interpretation) | ✅ pass | `normalizeAmountString` (pure, exported) + zod union number\|string → normalize, refine finite > 0; rejects 0 / -5 / NaN / missing / "" / "abc" |
| 4 | Category Suggestion Contract (note-interpretation) | ✅ pass | `resolveSuggestion`: exact `normalizeForMatch` equality vs `listCategories`, preserves owner spelling, never `createCategory`, "otro" → null |
| 5 | Deterministic-First Invocation (note-interpretation) | ✅ pass | `handleRegistration` order: parse → zero-categories setup gate → `matchNote` hit registers without interpreter → interpreter only on miss/rescue; `classifyMovementType` unchanged in `message.parser.ts` |
| 6 | Amount Precedence and Product Rules (note-interpretation) | ✅ pass | Equal → register parsed; differ → ask (nothing silent); interpreter-only → direct register (rescue) |
| 7 | Amount-Conflict Question Lifecycle (note-interpretation) | ✅ pass | `handleAwaitingAmountConfirmation` + `handleUpdate` route; `safeParse` decode, stored-context register, clear-to-idle-first abandonment, restart survival via `BotState` upsert |
| 8 | Environment Configuration (note-interpretation) | ✅ pass | `env.ts` 4 vars: `GROQ_API_KEY` optional min(1), `LLM_MODEL` default `openai/gpt-oss-20b`, `LLM_BASE_URL` url() default Groq, `LLM_TIMEOUT_MS` coerce int positive default 5000 |
| 9 | Timeout, No-Retry, and Injectable Fetch (note-interpretation) | ✅ pass | `AbortSignal.timeout(timeoutMs)`, exactly 1 attempt (asserted), injectable `fetchImpl` (tests) |
| 10 | Movement Parsing, Classification and Categorization (telegram-bot delta) | ✅ pass | Shared parser reused; deterministic-first; keyword rules beat suggestions; rescue direct register; conflict asks; null → today's otro+correction / help |
| 11 | Correction Loop (awaiting_category) and Learning (telegram-bot delta) | ✅ pass | Pre-existing D6 behavior confirmed: answer reassigns without learning, single-token auto-create, amount = new registration, multi-word lists categories |
| 12 | Per-Owner State Machine (telegram-bot delta) | ✅ pass | `idle` / `awaiting_setup` / `awaiting_category` + `awaiting_amount_confirmation` (exact value is a design decision); explicit transitions; persisted pending movement and conflict payload survive restart |

## Scenario Coverage — 34/34

### note-interpretation/spec.md (15/15)

| Scenario | Verdict | Evidence |
|---|---|---|
| Valid interpretation | ✅ | `note-interpreter.test.ts` happy paths (string `"1.234,50"` and numeric `4800`) |
| Missing key means no interpreter | ✅ | `app.ts` conditional spread; `tryInterpret` returns null when dep absent; `env.test.ts` "leaves GROQ_API_KEY unset"; zero-categories unit test asserts interpret not called |
| Provider error degrades | ✅ | HTTP 429 / 500 → null tests |
| Malformed payload degrades | ✅ | non-JSON body, non-string content, missing choices, non-JSON content, schema-reject → null tests |
| Timeout degrades | ✅ | fetchImpl rejects `AbortError` → null; `AbortSignal` instance asserted on the call |
| Spanish thousand-and-cents format | ✅ | `normalizeAmountString` table: `"$ 1.234,50"`/`"1234,50"`/`"1234.5"` → 1234.5; schema test `"1.234,50"` → 1234.5 |
| Invalid amount rejected | ✅ | schema rejects 0 / -5 / "NaN" / missing / null; normalize rejects "0" / "-5" / "NaN" |
| Suggestion is a suggestion only | ✅ | unknown suggestion → otro + `awaiting_category`, `createCategory` never called; "otro" suggestion → correction offered; resolvable uses owner's spelling |
| Matched note skips the interpreter | ✅ | `expect(mockInterpret).not.toHaveBeenCalled()` on matched note (service test) |
| Keyword miss invokes the interpreter | ✅ | miss tests drive outcome via `mockInterpret` (resolvable suggestion registers "Supermercado") |
| Conflict asks instead of registering | ✅ | `createExpense` not called; state `awaiting_amount_confirmation` + encoded payload; reply shows both `formatARS` amounts; integration row check |
| Rescue registers the interpreter amount | ✅ | `"compre mercaderia"` + `{amount: 5000}` → direct register (resolved-category and otro variants) |
| Answer selects an amount | ✅ | answer `"5000"` → registered 5000 from stored context (resolved-category and otro+correction variants) |
| Abandonment discards the question | ✅ | answer `"6000"` → abandonment reply + new text registers 6000 normally, nothing from conflicting message; corrupted-payload recovery too |
| Pending question survives restart | ✅ | unit restart via schema payload; integration restart via `buildService()` rebuild |

### telegram-bot/spec.md delta (19/19)

| Scenario | Verdict | Evidence |
|---|---|---|
| Keyword classification | ✅ | `"Recibí $50000 de sueldo"` → INCOME 50000 (service test) |
| Matched note skips the interpreter | ✅ | same as note-interpretation scenario |
| Keyword miss with resolvable interpreter category | ✅ | suggestion `"supermercado"` resolves to owner's `"Supermercado"` spelling, success reply, no correction round-trip (unit + integration) |
| Keyword miss with unknown interpreter category | ✅ | `"Kiosco"` → otro + `awaiting_category`, no auto-create |
| No amount rescued by the interpreter | ✅ with caveat (SUGGESTION) | Scenario example `"gaste como 5 mil pesos"` parses to **5** (verified against `message.parser.ts`: tokens `["5"]`) → exercises the CONFLICT path (5 vs 5000 → ask), which is covered. Rescue itself is covered with genuinely unparseable inputs (`"compre mercaderia"`, `"gaste cinco mil pesos"`, `"1234,50 cafe"`, `"$ 1.234,50 supermercado"`, `"1234.5 cafe"`). Spec text amendment needed at archive time. |
| No amount and interpreter null | ✅ | `"gaste cinco mil pesos"` / `"1234,50 cafe"` + null → help reply, nothing created |
| Conflicting amounts ask the owner | ✅ | 5 vs 5000 → no create, ask, persisted payload (unit + integration) |
| No interpreter configured degrades to today | ✅ | integration `buildService()` default (no interpreter) exercises otro+correction and help paths; unit asserts interpret not called |
| Unmatched triggers correction | ✅ | unmatched registration → otro + `awaiting_category` + offer (unit + integration) |
| Answer reassigns without learning | ✅ | answer "Transporte" → `updateMovement` reassign, `associateKeyword` never called, integration checks 0 `categoryKeyword` rows |
| Unknown single-token answer auto-creates the category only | ✅ | "Mascotas" → created + applied, no keyword learned |
| Amount during awaiting_category is a new registration | ✅ | `"$8000 super"` → new registration, correction abandoned (unit + integration) |
| Multi-word non-category answer lists categories | ✅ | lists existing categories, state stays open, movement stays in otro (unit + integration) |
| Idle to setup | ✅ | zero categories → `awaiting_setup`, nothing persisted/created |
| Correction to idle | ✅ | valid answer → state `idle` |
| Pending correction survives restart | ✅ | unit pre-seed + integration rebuild |
| Conflict answer registers the chosen amount | ✅ | same as note-interpretation "Answer selects an amount" |
| Conflict abandoned by a new registration | ✅ | integration: only 6000 registers, state returns to `awaiting_category` |
| Pending conflict question survives restart | ✅ | integration: fresh `buildService()` resolves the persisted question |

## Task Completeness — 10/10 (per apply-progress; spot-checked against code)

- [x] 1.1 Port & client — `note-interpreter.ts` matches the design contract exactly (port, `InterpretedNote`, `normalizeAmountString`, `interpretedNoteSchema`, `SYSTEM_PROMPT`, `GroqNoteInterpreter`: fetch POST, `AbortSignal.timeout`, 1 attempt, no retry, degrade-to-null, injectable `fetchImpl`).
- [x] 1.2 Unit tests — 45 tests, fake `fetchImpl`, zero network; full normalize table incl. `"$ 1.234,50"`, `"1234,50"`, `"1234.5"`, `"1,234.50"`, `"1.234"`, `"5 mil"`, `"mil"`, `"2k"`, invalids.
- [x] 2.1 Env vars — 4 zod vars; `env.test.ts` covers defaults, empty-key rejection, invalid-URL rejection, timeout coercion/rejection.
- [x] 2.2 DI wiring — `app.ts` constructs `GroqNoteInterpreter` only when `GROQ_API_KEY` set; no `fetchImpl` → global fetch.
- [x] 3.1 Bot state — `BOT_STATES` includes `"awaiting_amount_confirmation"`; no migration (`state` is String).
- [x] 3.2 Reply texts — `amountConflictReply` (both amounts via `formatARS`, voseo) + `amountConfirmationAbandonedReply`; 2 additive tests.
- [x] 3.3 Service restructure — setup gate before interpreter; matched rule skips interpreter; miss → suggestion + conflict; rescue; shared `registerWithCategory` / `registerOtroWithCorrection`; exported `amountConfirmationPayloadSchema`.
- [x] 3.4 Confirmation handler — `handleAwaitingAmountConfirmation` + route; `normalizeAmountString ?? parseAmount` matching; stored-context registration; abandon → clear → reprocess.
- [x] 4.1 Harness — `interpret: vi.fn()`; matched-note and zero-categories assert not invoked.
- [x] 4.2 Service unit cases — 16 new tests (resolve/unknown/"otro"/null suggestion; rescue variants; conflict ask + payload; answers 5000 both variants; abandonment + reprocess; restart; corrupted payload; create-failure keeps question open; commands don't consume).
- [x] 4.3 Integration — `buildService(logger?, interpreter?)`; 5 new tests (suggestion→seeded category; rescue 5000; conflict row; restart-survival answer; abandonment).
- [x] 5.1 Full gate — green (evidence above).

## Design Conformance

- NoteInterpreter port + Groq client (fetch POST, `AbortSignal.timeout`, single attempt, injectable `fetchImpl`): ✅
- zod validation (`interpretedNoteSchema` per design shape): ✅
- Env optionality — no-op without `GROQ_API_KEY`, `interpret` never invoked: ✅
- Deterministic-first ordering (setup gate → matchNote → interpreter only on miss/rescue): ✅
- Amount-conflict state (`awaiting_amount_confirmation`, restart survival, resolution/abandonment): ✅
- Unknown category → "otro" + `awaiting_category`, no auto-create: ✅
- LLM-only amount → direct register: ✅
- Rescue inputs genuinely unparseable (`"compre mercaderia"`, `"gaste cinco mil pesos"`, `"1234,50 cafe"` — verified `parseAmount` → null): ✅; `"gaste como 5 mil pesos"` correctly routes to the conflict path (parser yields 5).

## No Scope Creep

- No relative dates; no product column/dashboard (`product` is validated but unused in this slice, per design non-goals); no circuit breaker (decision #2 explicitly rejects it). Diff is limited to the 10 designed files plus `openspec` docs. No prisma schema, migration, or contracts change.

## Findings

- **Blockers: 0**
- **Critical findings: 0**
- **Warnings: 0**
- **Suggestions:**
  1. Archive-time spec amendment: "No amount rescued by the interpreter" (`telegram-bot/spec.md`) uses `"gaste como 5 mil pesos"`, which `parseAmount` reads as **5** (verified) — that string exercises the amount-CONFLICT path, not rescue. Rescue scenario examples should use genuinely unparseable bodies (`"compre mercaderia"`, `"gaste cinco mil pesos"`, `"1234,50 cafe"`).
  2. Close design open question 2 (third-amount reply "6000" abandons + reprocesses as a new registration): implemented per the design default and covered by unit + integration tests.
  3. Close design open question 3 (category renamed between ask and answer keeps the stored name): implemented per the design default (`Expense.category` has no FK — accepted edge).
  4. `product` is validated but unused by the bot in this slice — dashboard follow-up per non-goals; no action.

## Next

- **ready-for-archive** — verdict pass; archive phase should apply the spec-scenario amendment (suggestion 1) and close the two design open questions.

## Artifacts

- OpenSpec: `openspec/changes/llm-note-interpreter/verify-report.md`
- Engram: topic_key `sdd/llm-note-interpreter/verify-report` (project `automatizaciongastos`)