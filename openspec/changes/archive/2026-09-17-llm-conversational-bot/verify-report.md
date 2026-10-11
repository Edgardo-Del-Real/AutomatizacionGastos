```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:68b1dd6d2e5088a397065a45e8445b20d94d648d79e1bd8e06abb15fd9a75ebf
verdict: pass
blockers: 0
critical_findings: 0
requirements: 14/14
scenarios: 39/39
test_command: pnpm --filter @rita/api test
test_exit_code: 0
test_output_hash: sha256:a071a518b9fa672fcbdc710772cea0e3698f9fd71f44837924677bfe623119b8
build_command: pnpm --filter @rita/api typecheck && pnpm --filter @rita/api lint
build_exit_code: 0
build_output_hash: sha256:61323fbbe7d6029d7e32eba62cd5c60f1e61daa813782057b4ab083d76a1eacf
```

# VERIFY-REPORT: llm-conversational-bot

## Verdict

**PASS** — implementation matches spec, design, and tasks on branch `feat/llm-conversational-bot` (HEAD `1f004c9`). 14/14 delta requirements and 39/39 scenarios covered by tests and code; 18/18 tasks complete; full suite + typecheck + lint green. No blockers, no criticals, no warnings; 4 suggestions for future hardening. Next recommended step: **archive**.

## Test Evidence

| Check | Command | Exit | Result |
|---|---|---|---|
| Unit + integration suite | `pnpm --filter @rita/api test` | 0 | 19 files, 383 tests passed (0 failed) — Postgres :5433 reachable, integration ran |
| Typecheck | `pnpm --filter @rita/api typecheck` | 0 | clean (tsc) |
| Lint | `pnpm --filter @rita/api lint` | 0 | clean (eslint) |

- `test_output_hash = sha256:a071a518b9fa672fcbdc710772cea0e3698f9fd71f44837924677bfe623119b8` (canonical summary: 19 files / 383 passed)
- `build_output_hash = sha256:61323fbbe7d6029d7e32eba62cd5c60f1e61daa813782057b4ab083d76a1eacf` (typecheck clean + lint clean)
- Suite counts match apply-progress (19/383; baseline 18/317 claimed +66 net — baseline not re-run on `dev`, branch switch prohibited).
- No real Groq endpoint ever reached: unit tests inject `fetchImpl` stubs; service/integration tests inject a stub brain.

## Coverage Counts (counted from the spec files, not copied)

| Delta | Requirements | Scenarios |
|---|---|---|
| bot-brain (full) | 10 | 14 |
| telegram-bot (2 ADDED + 2 MODIFIED) | 4 | 25 |
| note-interpretation (REMOVED) | 8 removed (migration-only) | — |
| **Total** | **14** | **39** |

Covered: **14/14 requirements, 39/39 scenarios** (each mapped to at least one test; code spot-checked).

### bot-brain (10/10, 14/14)

1. Bot Brain Port — `BotBrain` interface (`interpret`/`reply`), `GroqBotBrain` implementation, `ConversationEnvelope`/`ExecutionResult`; `note-interpreter.ts` + test deleted, service dep swapped to `brain?: BotBrain`. "Missing key means no brain": `app.ts` conditional spread + service/integration default no-brain behavior.
2. Interpret Envelope Contract — schema tests: intent enum per intent, `"5 mil"`→5000, null amount ok, present-but-invalid (0/-5/NaN/"abc"/missing key) rejects, unknown intent rejects; transport asserts temp 0 + `json_object` + few-shots + single attempt.
3. Reply-After-Action Contract — `replyEnvelopeSchema` (min 1, trim, ≤400); reply transport posts only the executed-result JSON; verbatim wiring asserts the exact `ExecutionResult`; REPLY prompt forbids facts absent from the result ("si amount es null no menciones montos").
4. Intent Taxonomy — all 9 intents routed in `handleRegistration`; register flow, query_* → honest redirect, associate_keyword → command redirect, help + reserved correct_* → help, off_topic → expense-scoped redirect; expense-signal bias pinned in prompt contract + golden.
5. Degrade-to-Null Contract — 429, 500, non-JSON, missing choices, non-string content, schema mismatch, AbortError, ECONNREFUSED → null on BOTH methods (never throws).
6. Amount Normalization and Validation — `normalizeAmountString` verbatim (14 positive incl. `"1.234,50"`/`"1234,50"`/`"1234.5"`/`"5 mil"`/`"2k"`; 5 rejects) + schema `amount > 0` finite refine.
7. Category Suggestion Contract — `resolveSuggestion`: exact `normalizeForMatch`, "otro" = no suggestion, never auto-creates (asserted via `mockCreateCategory` not called).
8. Prompt Contract — 3 committed goldens (`interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt`) pinned by `toMatchFileSnapshot`; `toContain` contracts for JSON-only, never-invent, ARS, expense-bias, off-topic-never-chat, reply-after-action; category-blind (generic examples only; `InterpretContext` stub unused this slice).
9. Environment Configuration — `env.ts` unchanged and matching spec; `env.test.ts` covers defaults (model `openai/gpt-oss-20b`, Groq URL, timeout 5000), optional key, empty key rejected, **invalid `LLM_BASE_URL` rejected** (startup-fails scenario).
10. Timeout, No-Retry, Injectable Fetch — `AbortSignal.timeout` in `chat()`, single-attempt tests on both methods, injectable `fetchImpl` harness (no real network).

### telegram-bot (4/4, 25/25)

- Intent-First Message Handling (7/7): register flow runs; keyword beats suggestion (suggestion ignored); query redirect creates nothing; off-topic redirect never chats; setup gate precedes brain (`interpret` not called — asserted); brain-null behaves as today with ZERO reply calls (D5); dialog answers stay deterministic (`interpret` not called, branch replies route through `reply`).
- LLM Branch Replies with Fixed Fallback (3/3): reply verbatim; null reply → fixed template with same facts; commands/setup skip the reply call (asserted for commands).
- Movement Parsing, Classification and Categorization (11/11): INCOME keyword classification; matched keyword wins; keyword-miss + resolvable suggestion registers without correction; unknown suggestion → otro + correction, no auto-create; brain amount rescue; no amount + null brain → help, nothing created; genuine conflict (4800 vs 5000) asks and persists `awaiting_amount_confirmation`; "5 mil" stance registers brain amount directly (no confirmation state); deterministic note wins (`cafe`); brain note fills gap; no brain degrades to today.
- Success and Help Reply Content (4/4): success confirmation carries amount/note/category; unparseable gets help; off-topic redirect, never a chat answer; query gets honest not-supported redirect.

### note-interpretation (REMOVED delta — informational)

8 removed requirements all carry migration mapping to bot-brain/telegram-bot; no implementation needed. See Archive-Time Notes.

## Design Conformance

- Two-call loop `interpret → deterministic execute → reply-from-result`: implemented in `handleRegistration`/`executeRegistration` + `makeSender`/`tryBrainReply` (D5).
- interpret-null → zero reply calls: `makeSender(false, ...)` on the deterministic path; tested ("without any reply call").
- `mil-stance.ts`: token set matches design (22 tokens, longer-first), `[^a-z]` boundary regex, bare-integer 1–999 guard, 10-case golden table exactly as designed.
- Uniform amount precedence incl. keyword path (D4): amount resolved in `executeRegistration` before category matching; keyword match cannot skip the conflict/mil-stance rules.
- Dialog states deterministic: `handleAwaitingCategory`/`handleAwaitingAmountConfirmation` classification untouched; only reply sends route through the brain (D7 error replies fixed-only).
- Fixed fallbacks: all `reply-text.ts` templates survive; exactly 3 new redirect templates added.
- Reuse: Groq transport, `normalizeAmountString`, never-throw/single-attempt policy verbatim from the interpreter; `env.ts` byte-identical (diff empty).
- Goldens committed in `ac9ef8a`; byte-match current prompts/few-shots.
- Integration wiring: `buildService(logger, brain?)`; restart survival of both correction and amount-confirmation states.

## Scope Check (no creep)

Diff `dev...HEAD` touches only the 13 expected source/test files + `openspec/changes/llm-conversational-bot/*` (22 files, +2482/−548). No query executors (query_* redirects only), no general chat (off_topic redirect), no Fase-2 multi-user (InterpretContext stub unused). `env.ts` unchanged.

## Findings

- **Blockers**: 0
- **Criticals**: 0
- **Warnings**: 0
- **Suggestions** (4):
  1. `app.ts` DI conditional (brain constructed only when `GROQ_API_KEY` set) has no app-level test; covered by inspection + service/integration no-brain defaults. An `app.test.ts` assert would pin the "Missing key means no brain" scenario at the wiring level.
  2. No explicit test for keyword-match + genuinely conflicting amounts; uniform amount precedence (D4) is structurally guaranteed by code order but not regression-pinned.
  3. `query_recent`/`correct_category` in idle share their switch branches with tested intents but lack their own explicit tests.
  4. "Slow provider aborts" is simulated via an immediate AbortError; the actual `AbortSignal.timeout` elapse is not timer-tested (mechanism asserted).

## Divergences from Design/Spec

None substantive. Two test-only adjustments recorded in apply-progress are faithful to the spec: note-precedence tests use `"cafe 2500"` (deterministic note `"cafe"`) because the parser yields `"$ cafe"` for `"$2500 cafe"`; integration redirect asserts no bot-state row (redirects never write state). `GroqBotBrain.interpret` declares `(message: string)` with the optional `InterpretContext` only on the interface (fewer-params assignability — client stays category-blind).

## Archive-Time Notes

1. **note-interpretation REMOVED delta**: the 8 removed requirements are absorbed into bot-brain (Degrade-to-Null, Amount Normalization, Category Suggestion, Environment, Timeout/No-Retry/Fetch) and telegram-bot (Deterministic-First → Intent-First, Amount Precedence, Amount-Conflict lifecycle, Port swap). Canonical `note-interpretation` spec was already archived in the prior change (`a4cdf55`); archive must drop the REMOVED delta and not reintroduce the extraction-only port.
2. **Golden snapshot policy**: `apps/api/src/features/telegram/__goldens__/` are the first committed prompt snapshots in the repo; regenerate ONLY via `vitest run -u` with deliberate review; prompt drift fails CI (`toMatchFileSnapshot`).
3. Pre-existing-drift note in the telegram-bot delta ("Amount Precedence and Product Rules" / "the note interpreter" naming) is superseded by this change — no action beyond archive.

## Risks

- Runtime degrade path is the production risk control: unset `GROQ_API_KEY` → deterministic-only; every brain failure class returns null and lands on today's flow. Verified by unit (all failure classes), service, and integration tests.
- Mil-stance is deliberately conservative (bare integer 1–999 beside prose words); number-word-only messages resolve via brain rescue, never conflict. Golden table pins the boundary.