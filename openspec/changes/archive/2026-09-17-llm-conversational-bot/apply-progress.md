# Apply Progress: LLM Conversational Bot

## Status

**success** — all 18 tasks implemented on `feat/llm-conversational-bot` (from `dev` a4cdf55), strict TDD (RED→GREEN per phase), full verification green. Branch pushed; no PR, no merge, no commits on `dev`.

## What Changed

| Area | Change |
|------|--------|
| `apps/api/src/features/telegram/bot-brain.ts` | New — `BotBrain` port (`interpret` + `reply`), `BOT_INTENTS`, `ConversationEnvelope`/`ExecutionResult`/`BotAction`/`InterpretContext`, zod schemas, INTERPRET/REPLY prompts + few-shots, `GroqBotBrain` with private `chat()` (bearer, temp 0, `json_object`, `AbortSignal.timeout`, single attempt, never-throw), `normalizeAmountString` verbatim |
| `apps/api/src/features/telegram/note-interpreter.ts` | Deleted — absorbed into `bot-brain.ts` |
| `apps/api/src/features/telegram/note-interpreter.test.ts` | Deleted — absorbed into `bot-brain.test.ts` |
| `apps/api/src/features/telegram/mil-stance.ts` | New — `isMilStance` with longer-first prose token set + `[^a-z]` boundary + bare-integer 1–999 guard |
| `apps/api/src/features/telegram/telegram.service.ts` | Brain dep (`brain?: BotBrain`), `tryBrainInterpret`/`tryBrainReply`, `makeSender(brainActive, reply)`/`Sender`, intent-first `handleRegistration`, `deterministicRegistration`, `executeRegistration` (amount precedence incl. mil-stance, note det-wins-gap-fill, category keyword > suggestion > otro+correction), branch `ExecutionResult` wiring, dialog branches reply via `send`, commands/setup/error fixed-only (D7) |
| `apps/api/src/features/telegram/reply-text.ts` | `queryRedirectReply()`, `associateKeywordRedirectReply()`, `offTopicRedirectReply()` added; all existing templates survive as fallbacks |
| `apps/api/src/app.ts` | Conditional spread swaps to `brain: new GroqBotBrain({...})`; `env.ts` untouched |
| `apps/api/src/features/telegram/bot-brain.test.ts` | New — absorbed + extended suites: normalizeAmountString verbatim, envelope schema (enum, "5 mil"→5000, null ok, present-but-invalid rejects, bounds), reply schema, transport assertions, failure classes → null on both methods, prompt goldens (`__goldens__/`), `toContain` contracts |
| `apps/api/src/features/telegram/mil-stance.test.ts` | New — 10-case golden table |
| `apps/api/src/features/telegram/telegram.service.test.ts` | Brain harness `{interpret, reply}`; orchestration tests (register flow, keyword beats suggestion, redirects, setup gate, dialog answers, reply verbatim/null→fixed, note precedence both ways, brain null → today); conflict tests rewritten with genuine disagreement; mil-stance service case |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | `buildService(logger, brain?)`; stubbed-brain full loops on PostgreSQL :5433: verbatim reply, null-reply fallback, redirects create no movement, restart survival, mil-stance direct registration, genuine conflict |

## Verification Evidence

- `pnpm --filter @rita/api test` → **19 files, 383 tests passed** (baseline 18 files / 317; +66 net tests)
- `pnpm --filter @rita/api typecheck` → clean
- `pnpm --filter @rita/api lint` → clean
- Prompt goldens: first committed snapshots in the repo, generated via `vitest run -u` once, byte-pinned by `toMatchFileSnapshot`
- No real Groq endpoint ever hit — fake `fetchImpl` in unit tests, stubbed brain in service/integration tests

## Commits

1. `ac9ef8a` feat(telegram): add BotBrain port with interpret and reply (+ goldens)
2. `a2b3cf8` feat(telegram): add mil-stance conflict-trigger refinement
3. `fc1bfb3` feat(telegram): orchestrate the bot brain intent-first with branch replies (service + DI + tests, interpreter files deleted)
4. `docs(sdd)` — this progress record + tasks checkboxes

## Risks / Divergences

- **No divergences from design/spec.** Two test-only adjustments while staying faithful to the spec: deterministic note for `"$2500 cafe"` is `"$ cafe"` (parser behavior, not brain) so note-precedence tests use `"cafe 2500"`; integration redirect asserts no bot-state row (redirects never write state) instead of an `idle` row.
- `GroqBotBrain.interpret` declares only `(message: string)` — the optional `InterpretContext` is accepted via the `BotBrain` interface (fewer-params assignability), keeping the client category-blind this slice.
- Mil-stance "5 mil en el super" registers 5000 with category suggestion null → falls to `otro` + correction offer (`awaiting_category`), as designed (no `awaiting_amount_confirmation`).

## Next Step

`verify` — run the SDD verification phase against spec/design/tasks, then archive.