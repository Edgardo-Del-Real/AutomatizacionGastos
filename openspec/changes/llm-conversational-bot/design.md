# Design: LLM Conversational Bot

## Technical Approach

Two-call loop inside the existing orchestrator. For every non-command `idle` message: `brain.interpret` (strict JSON intent envelope, temperature 0) → deterministic execute (same registration/correction flows; state machine untouched) → `brain.reply` fed ONLY the executed result. `BotBrain` (two methods) replaces `NoteInterpreter`; Groq transport, `normalizeAmountString`, env contract, and the never-throw / single-attempt policy are reused verbatim. Any brain absence or failure (HTTP error, 429, timeout, non-JSON, schema mismatch) degrades to today's deterministic flow with fixed `reply-text.ts` templates. Commands and the setup flow make no brain calls; dialog states keep deterministic classification while their branch replies become brain-written with fixed fallback. The "5 mil" trap is fixed by a bot-layer conflict-trigger refinement (`mil-stance.ts`), not by touching the shared parser.

## Architecture Decisions

| # | Decision | Alternatives | Rationale |
|---|----------|--------------|-----------|
| D1 | Rename `note-interpreter.ts` → `bot-brain.ts`; `GroqNoteInterpreter` → `GroqBotBrain` | Keep filename; new file + re-export shim | One LLM surface, one file, no stale extraction-only name; only 3 importers (service, `app.ts`, tests) so no shim needed |
| D2 | `reply` uses JSON mode, returns `{"reply": string}` validated by zod | Free-text completion | Uniform transport, validation, and degrade-to-null failure classes for both calls; schema bounds reply length (≤400) |
| D3 | Mil-stance is a dedicated pure module `mil-stance.ts` | Inline in service; extend `parseAmount` | Bot-layer policy, golden-testable in isolation; shared-parser blast radius is explicitly out of scope (proposal) |
| D4 | Amount precedence (conflict question + mil-stance) runs uniformly, also on keyword match | Keyword match short-circuits amount checks | Never register silently on disagreement; the mil trap must be fixed even when a keyword matched; the spec's keyword-miss conflict scenario still passes |
| D5 | `interpret` → null means ZERO reply calls: full deterministic path, fixed replies | Still attempt `reply` | Spec scenario "Brain null behaves as today"; no doubled latency on a degraded path |
| D6 | Strict envelope: all four keys required; present-but-invalid amount rejects the whole envelope | Lenient defaults | Spec scenario "invalid amount → envelope null"; json_object + temperature 0 make omissions rare; strictness fails safe to deterministic |
| D7 | Error replies (`movementMissing`, `categoryError`) stay fixed-only | Route through brain | Not in the spec's conversational-outcome list; LLM noise on error paths adds risk, no value |

## Data Flow

    Telegram update
      └─ handleUpdate: dedupe → owner gate → empty → command? (fixed replies, no brain)
         ├─ dialog state? ── deterministic classify ── execute ── send(result, fixed) ──► owner
         └─ idle: handleRegistration
              ├─ setup gate (0 categories) ──► awaiting_setup (NO brain call)
              ├─ brain.interpret(body) ── null ──► today's flow, fixed replies only
              └─ envelope → intent switch
                   ├─ query_* / associate_keyword / off_topic → redirect result → send
                   ├─ help / correct_* (idle) → help result → send
                   └─ register_expense → executeRegistration
                        ├─ amount: det-first · brain rescue · mil-stance (brain wins) · else conflict ask
                        ├─ note: det wins · brain fills gap
                        ├─ category: keyword rule > brain suggestion (exact normalizeForMatch) > otro+correction
                        └─ create movement + set state → send(ExecutionResult, fixed)
                             └─ brain.reply(result) ── text ──► verbatim; null/fail ──► fixed template

## BotBrain Port (`bot-brain.ts`)

```ts
export const BOT_INTENTS = ["register_expense","correct_amount","correct_category",
  "query_recent","query_balance","query_month","associate_keyword","help","off_topic"] as const;
export type BotIntent = (typeof BOT_INTENTS)[number];
export type ConversationEnvelope = { intent: BotIntent; amount: number | null;
  category: string | null; note: string | null };
export type BotAction = "registered" | "asked_amount" | "asked_category" | "redirected" | "none";
export type ExecutionResult = { intent: BotIntent; ok: boolean; action: BotAction;
  amount: number | null; category: string | null; note: string | null };
/** Fase-2 stub: category-blind this slice — callers pass nothing, client ignores it. */
export type InterpretContext = { categories?: readonly string[] };

export interface BotBrain {
  /** Never throws. null = degrade to the deterministic flow. */
  interpret(message: string, context?: InterpretContext): Promise<ConversationEnvelope | null>;
  /** Never throws. null = degrade to the fixed reply-text template. */
  reply(result: ExecutionResult): Promise<string | null>;
}
```

```ts
const llmAmount = z.union([z.number(), z.string()])
  .transform((v) => normalizeAmountString(String(v)))
  .refine((v) => v !== null, "present-but-invalid amount"); // explicit JSON null passes via .nullable()
export const conversationEnvelopeSchema = z.object({
  intent: z.enum(BOT_INTENTS),
  amount: llmAmount.nullable(),
  category: z.string().trim().min(1).max(60).nullable(),
  note: z.string().trim().min(1).max(200).nullable(),
}).refine((d) => d.intent !== "register_expense" || d.amount === null
  || (d.amount > 0 && Number.isFinite(d.amount))); // belt-and-braces, mirrors today's schema
export const replyEnvelopeSchema = z.object({ reply: z.string().trim().min(1).max(400) });
```

`normalizeAmountString` moves verbatim (same export). `GroqBotBrain` keeps today's constructor (`{ apiKey, model, baseUrl, timeoutMs, fetchImpl? }`) and extracts a private `chat(systemPrompt, messages)`: POST + bearer, `temperature: 0`, `response_format: json_object`, `AbortSignal.timeout(timeoutMs)`, single attempt, `choices[0].message.content` → `JSON.parse` → zod — `null` on every failure class, never throws. `interpret` = chat(INTERPRET prompt + few-shots + message); `reply` = chat(REPLY prompt + `JSON.stringify(result)`).

## Prompt Contracts (pinned by goldens)

**INTERPRET_SYSTEM_PROMPT** (es-AR, category-blind — generic examples only, never owner category names): strict JSON `{"intent","amount","category","note"}` only; the intent enum with one-line semantics (register_expense = any money movement, gasto o ingreso); expense-signal bias (expense verb, `$`, or amount token → `register_expense` even without an amount); never invent an amount; ARS rules verbatim from today's prompt (`"1.234,50"`/`"1234,50"` → 1234.50, `"5 mil"`/`"cinco mil"` → 5000); category = suggestion ≤60; note = concrete description ≤200; off-topic is classified, never chatted.

**Few-shots** (user/assistant JSON pairs; exact bytes live in the goldens):
- "gaste 5 mil en el super" → `{register_expense, 5000, "Supermercado", "super"}`
- "compre mercaderia" → `{register_expense, null, "Supermercado", "mercaderia"}` (bias without amount)
- "cuánto gasté este mes?" → `{query_month, null, null, null}`
- "hola, cómo andás?" → `{off_topic, null, null, null}`
- "de ahora en más uber va a transporte" → `{associate_keyword, null, null, null}`
- "5000" → `{correct_amount, 5000, null, null}`

**REPLY_SYSTEM_PROMPT** (es-AR): input is the executed-result JSON only; warm voseo, ≤2 sentences, no markdown; NEVER assert a fact absent from the result (null amount → no amount mentioned); action semantics: `registered` = movement saved/updated — confirm with the present facts (null amount = category reassignment); `asked_amount` = ambiguous amount — ask for the exact number, never claim which is right; `asked_category` = movement already saved in `category` — offer reassignment; `redirected` = not supported yet — say so honestly; `none` = nothing executed — guide the user.

Both prompts + the few-shot array are pinned by committed goldens (vitest `toMatchFileSnapshot`, deliberate regen via `-u`); semantic `toContain` assertions cover JSON-only, never-invent, ARS, off-topic-never-chat, expense-signal bias, and reply-after-action phrases.

## Mil-Stance Detection (`mil-stance.ts`)

```ts
const PROSE_NUMBER_WORDS = ["millones","millon","mil","k","ciento","cien",
  "doscientos","doscientas","trescientos","trescientas","cuatrocientos","cuatrocientas",
  "quinientos","quinientas","seiscientos","seiscientas","setecientos","setecientas",
  "ochocientos","ochocientas","novecientos","novecientas"]; // longer-first
const PROSE_NUMBER_WORD_REGEX =
  new RegExp(`(?:^|[^a-z])(?:${PROSE_NUMBER_WORDS.join("|")})(?![a-z0-9])`);

/** Fires only in the conflict path (detAmount ≠ brainAmount, both non-null). */
export function isMilStance(body: string, deterministicAmount: number | null): boolean {
  // Bare small integer = the parser trapped the digit part of a prose amount
  // ("5 mil"→5, "15 mil"→15, "2k"→2, "500 mil"→500). Integers ≥1000 beside prose
  // words are likelier genuine amounts ("2500, mil gracias") → keep the question.
  if (deterministicAmount === null || !Number.isInteger(deterministicAmount)
    || deterministicAmount < 1 || deterministicAmount > 999) return false;
  return PROSE_NUMBER_WORD_REGEX.test(normalizeForMatch(body));
}
```

Boundary convention follows `matcher.ts` (`normalizeForMatch` + word boundaries), adapted so a digit prefix matches ("5mil", "2k") while "kiosco"/"Millka" cannot. Unit/decade words ("dos", "tres"…) are deliberately excluded — they false-positive on "gaste 5 en dos cuotas"; number-word-only messages ("gaste quinientos pesos") have no deterministic amount and resolve via rescue, never conflict. Precedence: mil-stance → register the brain amount directly, no conflict question, no `awaiting_amount_confirmation`.

Golden cases: `("gaste 5 mil en el super",5)`→true; `("5mil super",5)`→true; `("2k cafe",2)`→true; `("15 mil de nafta",15)`→true; `("500 mil",500)`→true; `("5 MIL",5)`→true; `("gaste 5 en el kiosco",5)`→false; `("cafe 2500",2500)`→false; `("gaste 2500, mil gracias",2500)`→false; `(body,null)`→false.

## Integration in `telegram.service.ts`

- **Deps**: `interpreter?: NoteInterpreter` → `brain?: BotBrain`; `tryInterpret` → `tryBrainInterpret`; new `tryBrainReply` (same never-throw wrapper + logging).
- **Per-message sender**: `makeSender(brainActive, reply)` returns `send(result, fixed)` — `brainActive ? (await tryBrainReply(result)) ?? fixed : fixed`, via `safeReply`. `brainActive` = envelope !== null on the idle path; brain !== undefined on dialog branches. When false, no `reply` call ever happens (D5). The register/ask helpers take `send` instead of the raw `ReplyPort`; each call site computes its fixed template so the fallback always carries the full facts.
- **`handleRegistration`** (idle): parse → `listCategories` → setup gate (unchanged, precedes the brain) → `tryBrainInterpret(body)`:
  - null → `deterministicRegistration`: today's flow verbatim minus brain (parsed null → fixed help; keyword match → register; keyword miss → otro + correction), fixed replies only.
  - envelope → intent switch: `query_*`/`associate_keyword`/`off_topic` → redirect result (no movement, no state change); `help` and reserved `correct_*` → help result; `register_expense` → `executeRegistration`.
- **`executeRegistration`** (absorbs `handleAmountRescue`):
  1. Amount — detAmount = parsed amount; brainAmount = envelope.amount. det null → brain rescue (or help outcome when both null); brain null/equal → det; differ + `isMilStance(body, detAmount)` → brain wins directly; differ otherwise → `askAmountConfirmation` (unchanged payload/state semantics).
  2. Note — `parsed !== null ? parsed.note ?? envelope.note : envelope.note ?? extractNote(body)` (deterministic wins, brain fills gaps, never conflict-asks).
  3. Category — `matchNote(ownerId, note ?? body)` first (keyword beats suggestion); else `resolveSuggestion` (exact `normalizeForMatch`, "otro" = none, never auto-create); else otro + correction.
- **Branch-reply wiring** (`send` sites):

| Branch | ExecutionResult | Fixed fallback |
|---|---|---|
| Registration success (all paths incl. confirmation answer) | `register_expense, true, registered, amount, category, note` | `successReply` |
| Otro + correction offer | `register_expense, true, asked_category, amount, "otro", displayNote` | `correctionOfferReply` |
| Amount-conflict question | `register_expense, false, asked_amount, detAmount, null, body` | `amountConflictReply` |
| No amount anywhere | `register_expense, false, none, null, null, body` | `helpReply` |
| help / correct_* in idle | `intent, true, none, null, null, null` | `helpReply` |
| query_* / associate_keyword / off_topic | `intent, false, redirected, null, null, null` | new redirect templates |
| Correction done (awaiting_category) | `correct_category, true, registered, null, category, pendingNote` | `correctionDoneReply` |
| Otro kept | `correct_category, true, none, null, "otro", null` | `otroKeptReply` |
| Category not found (awaiting_category) | `correct_category, false, asked_category, null, null, attempted` | `categoryNotFoundReply` |
| Correction / confirmation abandoned | `correct_category | register_expense, false, none, null, null, body` | `*AbandonedReply` |

- Dialog-state classification (`handleAwaitingCategory`, `handleAwaitingAmountConfirmation`) is untouched — `interpret` never fires there; only their reply sends route through `send`. Error replies (`movementMissingReply`, `categoryErrorReply`) and ALL command + setup replies stay fixed-only, per spec.
- **`reply-text.ts`**: every existing template survives as fallback; command/setup/error templates stay primary. Three new fallbacks: `queryRedirectReply()`, `associateKeywordRedirectReply()`, `offTopicRedirectReply()` (es-AR, expense-scoped).

## DI & Env

`app.ts`: the conditional spread swaps `interpreter: new GroqNoteInterpreter({...})` → `brain: new GroqBotBrain({ apiKey: env.GROQ_API_KEY, model: env.LLM_MODEL, baseUrl: env.LLM_BASE_URL, timeoutMs: env.LLM_TIMEOUT_MS })` — still only when `GROQ_API_KEY` is set; absent key → no brain constructed, `interpret`/`reply` never invoked. `env.ts` needs NO changes: the four vars already match the spec (optional min-1 key, model default `openai/gpt-oss-20b`, URL-validated base URL, positive-int timeout default 5000).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/features/telegram/bot-brain.ts` | Create | Renamed from `note-interpreter.ts`: port, types, zod schemas, prompts + few-shots, `GroqBotBrain`, `normalizeAmountString` verbatim |
| `apps/api/src/features/telegram/note-interpreter.ts` | Delete | Absorbed into `bot-brain.ts` |
| `apps/api/src/features/telegram/mil-stance.ts` | Create | `isMilStance` + pinned prose-number token set |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | Brain dep, intent-first orchestration, `executeRegistration`, `makeSender`/`send`, branch wiring |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | Three redirect fallback templates |
| `apps/api/src/app.ts` | Modify | DI swap to `GroqBotBrain` |
| `apps/api/src/features/telegram/bot-brain.test.ts` | Create | Absorbs + extends `note-interpreter.test.ts` (schemas, client, goldens) |
| `apps/api/src/features/telegram/note-interpreter.test.ts` | Delete | Absorbed |
| `apps/api/src/features/telegram/mil-stance.test.ts` | Create | Golden case table |
| `apps/api/src/features/telegram/telegram.service.test.ts` | Modify | Brain harness + orchestration tests |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Modify | Stubbed-brain full loops |

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit `bot-brain.test.ts` | `normalizeAmountString` suite kept verbatim; envelope schema (enum, `"5 mil"`→5000, null amount ok, present-but-invalid 0/-5/NaN/"abc"→reject, missing key→reject, category/note bounds); reply schema; `interpret` happy path per intent + transport assertions (URL, bearer, model, temp 0, json_object, few-shots present, single attempt, AbortSignal); 429/500/non-JSON/choices-missing/content-not-string/schema-fail/AbortError/ECONNREFUSED → null on BOTH methods; prompt goldens + contract `toContain` phrases | injectable `fetchImpl`, no network |
| Unit `mil-stance.test.ts` | The golden table above | pure function |
| Unit `telegram.service.test.ts` | Harness brain stub `{interpret, reply}`; orchestration per intent (register runs the flow, keyword beats suggestion, redirects, help); setup gate → `interpret` not called; dialog answers → `interpret` not called but branch replies via `reply`; reply verbatim / null → fixed fallback; mil-stance service cases ("gaste 5 mil en el super" + brain 5000 → registered 5000, no conflict state, no question); note precedence both directions; brain null → today | vi.fn stubs |
| Integration `telegram.service.integration.test.ts` | Full loops on PostgreSQL :5433 with stubbed brain: register → verbatim reply; redirect intents create no movement; genuine conflict (det 4800 vs brain 5000) persists `awaiting_amount_confirmation`; restart survival; reply-null fallback | existing harness, `brain?: BotBrain` param |

Existing tests that change: `note-interpreter.test.ts` (absorbed/retargeted); service test "matched keyword rule beats the interpreter: it is never invoked" (interpret IS invoked now — asserts the suggestion is ignored instead); both conflict tests seeded with "gaste como 5 mil pesos"/[5,5000] (now mil-stance direct registration — rewritten with genuine disagreement); all interpreter-stubbed tests reshaped to `ConversationEnvelope` (intent + note, no product); integration `buildService(logger, interpreter?)` → `brain?`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Message ingestion (`handleUpdate` pipeline) is unchanged; the only new external call is the existing Groq HTTP client pattern, bounded by timeout and degrade-to-null.

## Migration / Rollout

No data migration, no feature flags. Runtime kill switch: unset `GROQ_API_KEY` → deterministic-only. Rollback: revert the slice (no schema/contract changes).

## Open Questions

None blocking — the proposal's three open questions are resolved by the spec (dialog answers deterministic; category-blind prompt with a Fase-2 context stub; deterministic-note-wins). Prompt micro-copy is apply-time detail behind the goldens.
