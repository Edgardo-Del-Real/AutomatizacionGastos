# Tasks: LLM Conversational Bot

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,100 (≈750 added / ≈350 deleted) |
| Review budget (session) | 5,000 lines |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: BotBrain Port + Client (RED)

- [x] 1.1 RED `bot-brain.test.ts`: absorb `note-interpreter.test.ts` suites (normalizeAmountString verbatim, transport, degrade-to-null) retargeted to `GroqBotBrain` + both methods
- [x] 1.2 RED: schema tests — intent enum, `"5 mil"`→5000, null amount ok, present-but-invalid (0/-5/NaN/"abc"/missing key) rejects, category≤60 / note≤200 / reply≤400 bounds
- [x] 1.3 RED: prompt goldens via `toMatchFileSnapshot` (INTERPRET + few-shots + REPLY) and `toContain` contracts (JSON-only, never-invent, ARS, expense-bias, off-topic, reply-after-action)

## Phase 2: BotBrain Implementation (GREEN)

- [x] 2.1 GREEN: create `bot-brain.ts` — `BOT_INTENTS`, `ConversationEnvelope`, `ExecutionResult`, `BotAction`, `InterpretContext` stub, zod schemas, prompts + few-shots, `normalizeAmountString` verbatim
- [x] 2.2 GREEN: `GroqBotBrain` with private `chat()` (bearer, temp 0, `json_object`, `AbortSignal.timeout`, single attempt) → `interpret` + `reply`; null on every failure class, never throws
- [x] 2.3 GREEN: delete `note-interpreter.ts` + `note-interpreter.test.ts`; update the 3 importers (service, `app.ts`, tests)

## Phase 3: Mil-Stance Module

- [x] 3.1 RED `mil-stance.test.ts`: golden table — `("gaste 5 mil en el super",5)`→true, `("5mil super",5)`→true, `("2k cafe",2)`→true, `("15 mil de nafta",15)`→true, `("500 mil",500)`→true, `("5 MIL",5)`→true, `("gaste 5 en el kiosco",5)`→false, `("cafe 2500",2500)`→false, `("gaste 2500, mil gracias",2500)`→false, `(body,null)`→false
- [x] 3.2 GREEN: create `mil-stance.ts` — `PROSE_NUMBER_WORDS` (longer-first) + `[^a-z]` boundary regex + `isMilStance(body, deterministicAmount)` (bare-integer 1–999 guard)

## Phase 4: Service Orchestration (RED)

- [x] 4.1 RED `telegram.service.test.ts`: brain stub `{interpret, reply}` harness; register flow, keyword beats suggestion (ignored), redirects create nothing, setup gate → interpret not called, dialog answers → interpret not called but branch replies via `reply`, reply verbatim / null→fixed, note precedence both ways, brain null → today
- [x] 4.2 RED: rewrite both "5 mil"-seeded conflict tests (unit + integration) with genuine disagreement (det 4800 vs brain 5000) → conflict persists; new mil-stance service case "gaste 5 mil en el super" + brain 5000 → registered 5000, no `awaiting_amount_confirmation`

## Phase 5: Service Implementation (GREEN)

- [x] 5.1 GREEN: swap dep `interpreter?` → `brain?: BotBrain`; `tryBrainInterpret` + `tryBrainReply` wrappers
- [x] 5.2 GREEN: `handleRegistration` intent-first — setup gate precedes brain; null → deterministic path; envelope switch (register_expense → `executeRegistration`; query_*/associate_keyword/off_topic → redirect; help/correct_* → help)
- [x] 5.3 GREEN: `executeRegistration` — amount: det wins / brain rescue / mil-stance brain-wins / else `askAmountConfirmation`; note det-wins-gap-fill; category keyword > `resolveSuggestion` > otro+correction
- [x] 5.4 GREEN: `makeSender(brainActive, reply)` + `safeReply`; branch `ExecutionResult` wiring table; dialog branches reply via `send`; commands/setup/error replies fixed-only (D7)
- [x] 5.5 GREEN: `reply-text.ts` — add `queryRedirectReply()`, `associateKeywordRedirectReply()`, `offTopicRedirectReply()`

## Phase 6: DI + Integration + Verify

- [x] 6.1 GREEN: `app.ts` — conditional spread → `brain: new GroqBotBrain({...})`; `env.ts` untouched
- [x] 6.2 RED `telegram.service.integration.test.ts`: `buildService(logger, brain?)`; register → verbatim reply, redirects create no movement, restart survival, reply-null fallback (PostgreSQL :5433)
- [x] 6.3 Verify: `pnpm --filter @rita/api test` green, `pnpm typecheck`, `pnpm lint`; regenerate goldens only via `-u`