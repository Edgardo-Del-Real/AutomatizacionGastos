# Exploration: LLM Conversational Bot

Change: `llm-conversational-bot` — the LLM becomes the conversational brain of the Telegram bot. `TelegramService` stays the orchestrator: it asks the LLM to interpret every user message (intent + amount + category + tone), validates, executes through the SAME existing flow (register → dashboard, persist state, history), then asks the LLM to write the reply from the ACTUAL result (reply-after-action, zero hallucination). Deterministic parser + `reply-text.ts` remain the fallback when the LLM is down/rate-limited/off-topic. Bot stays 100% expense-scoped: off-topic is redirected, never answered as general chat.

## Current State (conversational surface)

Entry: `TelegramService.handleUpdate(update, reply)` (`apps/api/src/features/telegram/telegram.service.ts`). Only owner, text, non-duplicate messages produce replies.

```
handleUpdate
├── normalizeTelegramMessage (telegram.parser.ts) — edited/non-text/group → no reply
├── dedup + owner filter → no reply
├── parseCommand (telegram.commands.ts) → handleCommand — DETERMINISTIC, wins in every state
│     register / rename / associate / list / configurar (5 commands)
├── state dispatch (botStateRepository.get):
│     awaiting_setup            → handleSetupReply (extract names, create, confirm)
│     awaiting_category         → handleAwaitingCategory (D6 rules: exact match / amount / single-token / list)
│     awaiting_amount_confirmation → handleAwaitingAmountConfirmation (normalizeAmountString ?? parseAmount)
└── idle                        → handleRegistration
      parseAmountAndNote → null → handleAmountRescue (interpreter or helpReply)
      zero categories → awaiting_setup
      matchNote hit → registerWithCategory  (keyword rule wins, no interpreter)
      interpreter (keyword miss): null → otro+correction; amount differs → askAmountConfirmation;
        category resolves → register; else otro+correction
```

State machine values (`bot-state.repository.ts`): `idle | awaiting_setup | awaiting_category | awaiting_amount_confirmation`.

reply-text.ts templates in play (18): success, help, setupQuestion, setupRetry, setupDone, correctionOffer, correctionDone, otroKept, categoryNotFound, correctionAbandoned, amountConflict, amountConfirmationAbandoned, categoryCreated, categoryRenamed, keywordAssociated, categoryList, duplicateCategory, missingCategory, movementMissing, categoryError.

**LLM-reply candidate points** (conversational tone adds value): successReply, helpReply/redirect, correctionOfferReply, correctionDoneReply, otroKeptReply, categoryNotFoundReply, amountConflictReply, amountConfirmationAbandonedReply, categoryListReply.
**Keep deterministic** (structured admin ops, LLM adds nothing): setup flow (Question/Retry/Done), all 5 command replies (Created/Renamed/keywordAssociated/duplicate/missing/movementMissing/categoryError).

## Intent Taxonomy

| intent | LLM outputs | deterministic action after classification |
|---|---|---|
| `register_expense` | amount (nullable), category?, note? | existing `handleRegistration` flow (matcher → interpreter amount/category validation → register / otro+correction / amount-conflict) |
| `correct_amount` | amount | resolve `awaiting_amount_confirmation` via existing payload flow |
| `correct_category` | category name | resolve `awaiting_category` via D6 rules (exact match wins; LLM name validated via `normalizeForMatch`) |
| `query_recent` / `query_balance` / `query_month` | — | NO executor exists today. Recommend: classify + honest redirect ("todavía no sé consultar") in this change; executor is a follow-up. |
| `associate_keyword` | keyword, category | explicit command only (`asociar palabra`); plain-text equivalent → redirect to the command |
| `help` | — | help/redirect reply (LLM-written or fixed) |
| `off_topic` | — | expense-scoped redirect; never answered as general chat |

## Approaches

1. **Interpret-every-message + reply-after-action, two calls (recommended)** — call 1 (`interpret`): strict JSON, temperature 0, `{intent, amount, category, note}`. Execute deterministically. Call 2 (`reply`): LLM receives ONLY the executed result `{intent, registered|asked_amount|asked_category|redirected, amount, category, note, ok}` and writes the reply. Zero hallucination by construction; ~2s latency per conversational message.
2. **Single call with embedded `reply_draft`** — draft is written BEFORE execution → hallucination risk on the exact thing we're eliminating. Rejected: the draft must never be sent; if used as fallback it re-introduces the bug.
3. **Interpret-only (deterministic replies)** — today's bot plus interpretation. Loses the "conversational brain" goal. Only the fallback path.

**Loop shape (recommended, approach 1):**
- Call 1 (`interpret`) fires for every non-command message in `idle` AND for dialog-state messages (awaiting_category / awaiting_amount_confirmation) when the deterministic classifier is ambiguous — but the DETERMINISTIC classifier stays authoritative for state transitions. The LLM never decides state; it suggests, the state machine validates.
- `awaiting_category` / `awaiting_amount_confirmation` / `awaiting_setup`: deterministic classification + confirmation flow STAYS (persisted payload, D6 rules, `normalizeAmountString ?? parseAmount` answer matching). The LLM only writes the reply for each branch. Amount-conflict state from the archived change is untouched.
- Call 2 (`reply`) skipped for commands and setup flow (deterministic replies). Failure of call 2 → fixed `reply-text.ts` template with the same executed facts (still zero hallucination).
- Circuit breaker: interpret failure/429/invalid schema → full deterministic flow + fixed reply (exact today's behavior). No retries (avoid 429 storms) — same policy as the interpreter.

**Zod envelope (conversational response, `temperature: 0`, `response_format: json_object`):**

```ts
const conversationEnvelopeSchema = z.object({
  intent: z.enum(["register_expense","correct_amount","correct_category",
                  "query_recent","query_balance","query_month","associate_keyword","help","off_topic"]),
  amount: z.union([z.number(), z.string()]).transform((v) => normalizeAmountString(String(v))).nullable(),
  category: z.string().trim().max(60).nullable(),
  note: z.string().trim().max(200).nullable(),
}).refine((d) => d.intent !== "register_expense" || d.amount === null || (d.amount > 0 && Number.isFinite(d.amount)));

const replyEnvelopeSchema = z.object({ reply: z.string().trim().min(1).max(500) });
```

Unknown intent or schema failure → `null` → deterministic fallback. Off-topic reliability: intent enum + system-prompt rejection + few-shots; any expense-signal message ("compre…", "gaste…", "$", amounts) is biased to `register_expense` even when missing an amount.

## Prompt Design Sketch

**System (es-AR, voseo, warm, concise):**
1. "Sos Rita, asistente personal de gastos. El usuario registra SOLO gastos e ingresos en pesos argentinos (ARS)."
2. "Respondé SOLO un objeto JSON con `intent`, `amount`, `category`, `note`. Sin texto extra."
3. "NUNCA inventes un monto: `amount: null` cuando el mensaje no tiene monto."
4. "Monto: '5 mil'/'cinco mil'/'5k' → 5000; '1.234,50' → 1234.5; ignorá símbolos ($, usd, €); no conviertas."
5. "`category` es solo una sugerencia; el sistema valida contra las categorías del dueño."
6. "Off-topic (clima, política, preguntas personales) → `intent: off_topic`. NUNCA respondas como chat general."
7. "Mensajes con señal de gasto ('compre', 'gaste', 'pague', '$', montos) son `register_expense` aunque falte el monto."

**Few-shots (call 1):**
- `gaste 5 mil en el super` → `{"intent":"register_expense","amount":5000,"category":"Supermercado","note":"gaste en el super"}`
- `compre mercaderia` → `{"intent":"register_expense","amount":null,"category":"Mercaderia","note":"compre mercaderia"}`
- `¿cuál es el clima?` → `{"intent":"off_topic","amount":null,"category":null,"note":null}`
- `no me acuerdo cuánto gasté` → `{"intent":"help","amount":null,"category":null,"note":null}`

**Reply contract (call 2):** receives a JSON `execution_result` (the executed facts ONLY: intent, ok, amount, category, note, state) and writes the confirmation in voseo, warm, ≤2 sentences, no markdown. System: "Escribí SOLO la respuesta. No afirmes ningún dato que no esté en `execution_result`. Si el resultado falló, decilo simple."

## Impact on the Just-Shipped Interpreter

**Replace, not extend.** `NoteInterpreter`/`GroqNoteInterpreter` (`note-interpreter.ts`) is an extraction-only contract (`interpret(note) → {amount, category, product}`). The conversational layer supersedes it with a two-method `BotBrain` port; the old port is deprecated and its call site (`tryInterpret`) is absorbed into `interpret`. **Reuse:** the Groq transport (fetch/baseUrl/model/timeout, JSON mode, never-throw, `AbortSignal.timeout`) and `normalizeAmountString` + zod transform are shared verbatim — the prompt changes from extraction-only to conversation, the call shape stays identical. `GroqNoteInterpreter`'s prompt/method can be folded into `GroqBotBrain.interpret` (adding `intent` to the response and `SYSTEM_PROMPT` expansion); `reply` is a second method on the same client. The deterministic-first wiring, keyword-matcher priority, and amount-conflict state are untouched.

## Tests Strategy

- **Unit (interpret contract)** — stub `fetchImpl` with canned JSON (pattern from `note-interpreter.test.ts`): valid envelope, "5 mil" → 5000, amountless → null amount, off-topic → `off_topic`, unknown intent / schema mismatch / 429 / timeout → `null`.
- **Unit (reply contract)** — stub reply → sent verbatim; reply `null` → fixed `reply-text.ts` template with same facts; reply asserts nothing absent from `execution_result` (prompt-level guarantee, snapshot-tested).
- **Unit (service)** — extend `telegram.service.test.ts` harness: interpret returns register_expense → same flows as today + LLM reply; interpret null → deterministic; off_topic → redirect; reply failure → fixed text. `awaiting_category`/`awaiting_amount_confirmation` dialog tests re-run unchanged (deterministic classifier still decides).
- **Integration** — `telegram.service.integration.test.ts` `buildService` gains a stubbed `BotBrain` (no real network, per existing convention); amount-conflict + correction round-trips stay green.
- **Prompt snapshotting** — golden test asserting the full system prompt bytes (both calls) so prompt drift fails CI.
- **Affected existing tests:** `telegram.service.test.ts` (mock swap: interpreter → brain), `telegram.service.integration.test.ts` (wiring), `note-interpreter.test.ts` (kept for the reused transport; updated if the class is renamed), `reply-text.test.ts` (unchanged — fallback templates still tested as-is).

## Risks

1. **Latency per message** — every idle message now costs 2 Groq calls (~1s each). Mitigation: skip call 2 for commands/setup; 5s timeout + circuit breaker so the bot never blocks.
2. **Rate limit** — gpt-oss-20b free tier ≈ 1.000 req/day → ~500 conversational messages/day (2 calls each). Personal use (~10–50 msgs/day) is fine; failure degrades to the full deterministic flow.
3. **"5 mil" misparse class** — deterministic `parseAmount("gaste 5 mil")` = 5 while LLM says 5000 → spurious amount-conflict question on every "X mil" message. Mitigation: extend the deterministic side (`parseAmount`/`normalizeAmountString` on token+surrounding words) or refine the conflict trigger (bare digit immediately followed by "mil"/"k" → LLM wins).
4. **Multi-turn clarifications** — LLM writes words, deterministic state decides; risk of the reply contradicting the open question. Mitigation: reply contract receives only executed state; fixed templates on any reply failure.
5. **Off-topic drift** — LLM classifying a real expense as off-topic. Mitigation: expense-signal bias in prompt + few-shots; unknown intent → deterministic help.
6. **Fase 2 (shared account with Rita)** — multi-owner multiplies volume and needs per-owner category context in the prompt. Design the prompt to accept owner categories as an input context field so Fase 2 only adds context, not a prompt rewrite.

## Ready for Proposal

Yes — the orchestrator can move to `sdd-propose` with: two-call interpret→execute→reply loop (approach 1), deterministic state machine + fallback untouched, `BotBrain` port replacing `NoteInterpreter` with shared Groq transport, query intents redirected (no executor yet).