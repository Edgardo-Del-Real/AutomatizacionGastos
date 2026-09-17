# Design: LLM Note Interpreter for Telegram Registration

Change: `llm-note-interpreter` · Integration branch: `feat/bot-learning-improvements` (base `dev`)

## Technical Approach

Deterministic-first enhancement: `parseAmountAndNote` + `matchNote` run unchanged and stay authoritative. A new optional port `NoteInterpreter` (Groq client, `note-interpreter.ts`) is invoked in `handleRegistration` only on (a) keyword miss — category suggestion + amount-conflict check — and (b) deterministic amount-parse failure — amount rescue. Every interpreter failure returns `null` and the flow continues exactly as today. A new persisted state `awaiting_amount_confirmation` asks the owner on amount conflict, encoded into the existing `BotState` row — no migration.

## Verified Parser Behavior (drives test strings)

Verified against `message.parser.ts` (node): `parseAmount("gaste como 5 mil pesos")` → **5** — the lone `5` parses, so that exact string exercises the **conflict** path (5 vs 5000 → ask), not rescue. True rescue inputs (`parseAmount` → `null`): `"gaste cinco mil pesos"`, `"compre mercaderia"`, `"1234,50 cafe"`, `"$ 1.234,50 supermercado"`, `"1234.5 cafe"` — spec scenarios premised on "no deterministic amount" must use these. The conflict path covering "5 mil" is the better outcome anyway (asks instead of silently registering 5).

## Architecture Decisions

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Interpreter input | Always `interpret(body)` — full original text, at both invocation points | Pass the stripped note on keyword miss | Conflict detection on keyword miss requires the LLM to see the amount (spec: "5000 vs 4800 on a keyword miss"); one uniform call site |
| 2 | Failure policy | Single attempt, `AbortSignal.timeout(timeoutMs)`, no retries, whole body wrapped in try/catch → `null` | Retry/backoff, circuit breaker | Free-tier 429 storms; spec mandates degrade-to-null; breaker is a non-goal |
| 3 | Conflict persistence | New state `awaiting_amount_confirmation`; JSON payload in existing `BotState.pendingNote` (`state` is a `String` column) | New Prisma column (migration) / in-memory | Rollback plan forbids migrations; restart survival requires DB persistence; repository `upsert` already persists |
| 4 | Category resolution | Exact `normalizeForMatch` against `listCategories` at ask/register time; a suggestion resolving to `"otro"` → treated as no suggestion → correction flow | Fuzzy/semantic match, auto-create | Never auto-create (product rule); a silent "otro" without correction offer would regress today's keyword-miss UX |
| 5 | Amount normalization | New pure exported `normalizeAmountString`; last-separator-is-decimal disambiguation + `mil`/`k` multiplier | Reuse `parseNumberToken` | `parseNumberToken` rejects decimals (`"1234,50"` → null) — exactly the formats the LLM must handle |
| 6 | Amount comparison | Exact numeric equality (`!==`) | Epsilon tolerance | Formats normalizing to the same value must not conflict (5000 = "5.000" = 5000.0) |
| 7 | Missing key | `interpreter?: NoteInterpreter` optional dep; absent → never invoked | Null-object interpreter | Spec: "no interpreter is constructed and `interpret` is never invoked"; optional dep keeps harness wiring trivial |

## Data Flow

```
handleUpdate ── command? ──► handleCommand (unchanged)
   │ state?
   ├─ awaiting_setup / awaiting_category                 (unchanged)
   ├─ awaiting_amount_confirmation (NEW) ── answer matches a presented amount ──► register(stored context)
   │                                       └─ anything else ──► abandon + handleRegistration(text)
   └─ idle ──► handleRegistration
                 ├─ parseAmountAndNote ok ──► matchNote hit ──► register (interpreter NOT invoked)
                 │                            └─ miss ──► interpret(body)
                 │                                        ├─ null ─────────────► otro + awaiting_category (today)
                 │                                        ├─ amount ≠ parsed ───► ask + persist confirmation
                 │                                        └─ category resolves ─► register | otro + correction
                 └─ parse null ──► interpret(body)
                                  ├─ null ──► help (today)
                                  └─ amount ► register rescued | otro + correction
GroqNoteInterpreter: fetch POST (1 attempt, timeout signal) ── any failure ──► null
```

## Interfaces / Contracts (`apps/api/src/features/telegram/note-interpreter.ts`)

```ts
export type InterpretedNote = {
  amount: number;          // ARS, normalized, positive, finite
  category: string | null; // suggestion; null = none — never auto-created
  product: string | null;  // validated; NOT used by the bot in this slice (dashboard is a follow-up)
};

export interface NoteInterpreter {
  /** Never throws. null = fall back to today's deterministic behavior. */
  interpret(note: string): Promise<InterpretedNote | null>;
}

export class GroqNoteInterpreter implements NoteInterpreter {
  constructor(deps: {
    apiKey: string;
    model: string;      // "openai/gpt-oss-20b"
    baseUrl: string;    // "https://api.groq.com/openai/v1/chat/completions"
    timeoutMs: number;  // 5000
    fetchImpl?: typeof fetch;  // defaults to global fetch (Node 20); injected in tests
  }) {}
}
```

`normalizeAmountString(value: string): number | null` (exported, pure): strip whitespace, `$`, `€`, and leading `ars`/`usd` (case-insensitive); then —

| Input | Output | Rule |
|---|---|---|
| `"$ 1.234,50"` / `"1,234.50"` | `1234.5` | both separators present → the LAST is the decimal marker, the other is removed |
| `"1234,50"` / `"1.234"` | `1234.5` / `1234` | single separator: `^\d{1,3}([.,]\d{3})+$` → thousands (removed); else `^\d+([.,]\d{1,2})$` → decimal |
| `"1234.5"` | `1234.5` | dot-only, not a thousands group (integer part > 3 digits) → decimal |
| `"5 mil"` / `"mil"` / `"2k"` | `5000` / `1000` / `2000` | `^(\d*)\s*(mil|k)$` multiplier |
| `NaN`, `0`, `-5`, `""`, `"abc"` | `null` | non-finite / non-positive → schema rejects → `null` |

Zod (repo uses zod ^3.25):

```ts
const llmAmount = z.union([z.number(), z.string()]).transform((v) => normalizeAmountString(String(v)));
export const interpretedNoteSchema = z
  .object({
    amount: llmAmount,
    category: z.string().trim().min(1).max(60).nullable(),
    product: z.string().trim().max(200).nullable().optional(),
  })
  .refine((d) => d.amount !== null && Number.isFinite(d.amount) && d.amount > 0);
```

Note: per the approved schema shape, an empty-string category or a missing/invalid amount rejects the payload → `null`. The prompt instructs `null` instead, so this only fires on misbehavior.

Request: `POST baseUrl`, headers `Authorization: Bearer <key>` + `Content-Type: application/json`, body `{ model, messages: [{role:"system",content:SYSTEM_PROMPT},{role:"user",content:body}], temperature: 0, response_format: { type: "json_object" } }`, `signal: AbortSignal.timeout(timeoutMs)`. Response policy: `!res.ok` → null (covers 429/4xx/5xx); `res.json()` throws → null; `choices[0].message.content` not a string → null; `JSON.parse(content)` throws → null; `safeParse` fails → null. One attempt, no retries, never throws to the caller.

`SYSTEM_PROMPT` (Spanish, es-AR): respond ONLY with one JSON object `{"amount": number|null, "category": string|null, "product": string|null}`, no extra text/fields; NEVER invent an amount — `null` when the message has none; everything is ARS — ignore currency symbols/names (`$`, `usd`, `€`), never convert; `"1.234,50"` and `"1234,50"` mean 1234.50, `"1234.5"` means 1234.5, `"5 mil"`/`"cinco mil"` mean 5000 — return the number; `category` = most likely category name (e.g. "Supermercado", "Transporte"), max 60 chars, `null` if unsure; `product` = the concrete product/service if mentioned, max 200 chars, else `null`.

## State Machine — `awaiting_amount_confirmation`

- `BOT_STATES` += `"awaiting_amount_confirmation"` (`bot-state.repository.ts`). Prisma `BotState.state` is `String` — **no migration**.
- Stored on ask: `state = "awaiting_amount_confirmation"`, `pendingMovementId = null` (nothing registered yet — nothing registers silently), `pendingNote = JSON.stringify(payload)`:

```ts
export const amountConfirmationPayloadSchema = z.object({
  body: z.string().min(1),                // original text — classifyMovementType + context
  note: z.string().nullable(),            // parsed.note captured at ask time
  amounts: z.tuple([z.number().positive(), z.number().positive()]), // [deterministic, llm]
  category: z.string().min(1).nullable(), // resolveSuggestion result captured at ask time
});
```

- Ask: conflict branch in `handleRegistration` → persist → `amountConflictReply(parsed.amount, interpretation.amount)` (both via `formatARS`, voseo, "respondé con el monto, o mandá un registro nuevo y lo descarto").
- Answer (`handleAwaitingAmountConfirmation`, routed in `handleUpdate` before `handleRegistration`): decode via `safeParse` — failure → clear to idle, abandonment reply, process text as a new registration. `replied = normalizeAmountString(body) ?? parseAmount(body)` — normalize FIRST so `"5 mil"` → 5000 beats the lone-`5` parser trap; `parseAmount` fallback catches prose-wrapped replies like `"es 5000"`. `chosen = amounts.find(a => a === replied)`:
  - Match → register from the **stored** context: `createMovement(payload.body, { amount: chosen, note: payload.note }, category)` — `classifyMovementType` runs on the original body. `category ≠ null` → register + `successReply` → idle. `null` → `ensureOtro` + register in "otro" + `awaiting_category` (`pendingMovementId`, `pendingNote = payload.note`) + `correctionOfferReply` — the normal category rules. Movement-creation failure → log, question stays open (today's `createMovement` convention).
  - No match → abandonment: clear state to idle **first** (a non-parsing reply must not leave stale state), `amountConfirmationAbandonedReply()`, then `handleRegistration(body)` — nothing registers from the conflicting message; the new text is processed normally (same semantics as the D6 rule-2 correction abandonment).
- Restart survival: same `botStateRepository` upsert mechanism as `awaiting_category` — state + payload live in the DB row. Accepted edge: a category renamed between ask and answer keeps the stored name (`Expense.category` has no FK).
- Commands still win before state consumption (existing `handleUpdate` order, unchanged).

## Category Resolution

Private `resolveSuggestion(suggestion, categories)`: `null` → `null`; else exact `normalizeForMatch` equality against `listCategories` → returns the owner's actual category name (preserves original spelling). No match → `null` → "otro" + `awaiting_category`. A suggestion that normalizes to `"otro"` → `null` (correction flow — never a silent otro). Never calls `createCategory`.

## Integration Points (`telegram.service.ts`)

1. `TelegramServiceDeps` += `interpreter?: NoteInterpreter`. Private `tryInterpret(body)`: `null` when the dep is absent; try/catch wrapper around `interpret` (port contract is never-throw; the wrapper is belt-and-braces so the bot cannot die on a misbehaving client).
2. `handleRegistration` restructured — order matters:
   - `parseAmountAndNote(body)` → `listCategories` → zero categories → `awaiting_setup` **before any interpreter call** (the setup gate wins; the interpreter never fires for category-less owners).
   - `parsed === null` → `tryInterpret(body)` (full body as the matching note) → `null` → `helpReply` (today); amount → register with `{ amount: interpretation.amount, note: extractNote(body) }` — `extractNote`'s no-parseable-token fallback returns the full body (e.g. note stays `"1234,50 cafe"`; deterministic, documented) — then the category-resolution tail.
   - Keyword match → register (interpreter NOT invoked — asserted in tests).
   - Keyword miss → `tryInterpret(body)` → `null` → otro + correction (today); `interpretation.amount !== parsed.amount` → conflict branch (above); equal → `resolveSuggestion` → resolved → register + `successReply` → idle, else otro + correction (today).
   - Shared private tails reused by rescue, keyword-miss, and conflict-answer paths: `registerWithCategory(body, amount, note, category)` (create + success + idle) and `registerOtroWithCorrection(...)` (ensureOtro + create + `awaiting_category` + `correctionOfferReply`).
3. `handleUpdate` adds the `awaiting_amount_confirmation` route next to `awaiting_category`.
4. `reply-text.ts` += `amountConflictReply(deterministic, llm)` and `amountConfirmationAbandonedReply()`. No existing reply text changes.

## DI & Env

`env.ts` additions (zod 3.25 syntax):

```ts
GROQ_API_KEY: z.string().min(1).optional(),
LLM_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
LLM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1/chat/completions"),
LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
```

Invalid `LLM_BASE_URL` fails startup with the zod config error (spec scenario). `app.ts`: construct `GroqNoteInterpreter` only when `env.GROQ_API_KEY` is set (no `fetchImpl` passed — defaults to global fetch); otherwise pass no `interpreter` → deterministic-only.

## File Changes

| File | Action | What |
|---|---|---|
| `apps/api/src/features/telegram/note-interpreter.ts` | Create | Port, `InterpretedNote`, `normalizeAmountString`, zod schema, `GroqNoteInterpreter`, `SYSTEM_PROMPT` |
| `apps/api/src/features/telegram/note-interpreter.test.ts` | Create | Unit tests (fake `fetchImpl`) |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | `interpreter` dep, `tryInterpret`, `resolveSuggestion`, restructured `handleRegistration`, `handleAwaitingAmountConfirmation`, payload schema, shared register tails |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | `BOT_STATES` += `awaiting_amount_confirmation` |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | 2 new replies |
| `apps/api/src/features/telegram/reply-text.test.ts` | Modify | Tests for the new replies |
| `apps/api/src/features/telegram/telegram.service.test.ts` | Modify | Harness + `mockInterpret`; new cases; existing matched-note case gains a not-invoked assertion |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Modify | `buildService(logger?, interpreter?)`; new stubbed-interpreter cases |
| `apps/api/src/app.ts` | Modify | Conditional interpreter construction |
| `apps/api/src/config/env.ts` | Modify | 4 env vars |

No prisma schema or contracts change.

## Testing Strategy

| Layer | Cases | Approach |
|---|---|---|
| Unit `note-interpreter.test.ts` | happy path (string and number amount); non-JSON HTTP body; content not JSON; HTTP 429 and 500; timeout (fetchImpl rejects `AbortError`; assert an `AbortSignal` was passed); schema failures (amount 0 / -5 / "NaN" / missing; category 61 chars; empty category string); `normalizeAmountString` table incl. `"$ 1.234,50"`, `"1234,50"`, `"1234.5"`, `"1,234.50"`, `"5 mil"`, `"mil"`, invalids | fake `fetchImpl` returning `new Response(...)` (Node 20 global) or a minimal `{ ok, json }` lookalike; zero network |
| Unit `telegram.service.test.ts` | keyword miss + resolvable suggestion → registered with the owner's category spelling, no correction round-trip; miss + unknown suggestion → otro + `awaiting_category`, `createCategory` never called; miss + suggestion "otro" → correction offered; miss + `interpret` null → today's otro path; matched note → `expect(mockInterpret).not.toHaveBeenCalled()`; rescue (`"compre mercaderia"` + `{amount: 5000}`) → direct register (resolved category and otro variants); rescue + null → help, nothing created; conflict → no create, state `awaiting_amount_confirmation` + encoded `pendingNote`, reply shows both formatted amounts; answer `"4800"` → registered 4800 (resolved-category and otro+correction variants); answer matching neither + new registration → abandonment reply + normal processing; restart survival (pre-seed state via `amountConfirmationPayloadSchema` payload); commands during confirmation don't consume it; zero categories → `awaiting_setup`, interpret not called | harness += `interpret: vi.fn()`; existing tests unchanged apart from added not-invoked assertions |
| Integration `telegram.service.integration.test.ts` | `buildService(logger?, interpreter?)` — default no interpreter (deterministic; existing tests untouched); stubbed cases: suggestion resolves to a seeded category; rescue registers 5000 from `"compre mercaderia"`; conflict writes a `botState` row `awaiting_amount_confirmation`; answer after a `buildService()` rebuild (restart survival); abandonment registers nothing from the conflicting message | real Prisma on `TEST_DATABASE_URL`; stubbed interpreter only — never the real Groq endpoint |

Existing tests that must change: `telegram.service.test.ts` (harness + assertions above), `telegram.service.integration.test.ts` (`buildService` wiring), `reply-text.test.ts` (additive). Matcher/parser/command tests unaffected.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The only new external boundary is the outbound Groq HTTPS call, whose failure modes are fully specified (single attempt, timeout abort, no retry, degrade-to-null).

## Migration / Rollout

No migration. Env-only activation: unset `GROQ_API_KEY` → deterministic-only. Rollback = revert the slice; no data/contract change.

## Open Questions

- [ ] The specs use "gaste como 5 mil pesos" as a no-deterministic-amount example, but the parser yields 5 for it (verified). Tasks/tests must use genuinely unparseable bodies for rescue scenarios; should the spec scenario text be amended at archive time?
- [ ] Conflict answers match via `normalizeAmountString ?? parseAmount` equality against the two presented amounts; a reply naming a third amount ("6000") abandons the question and processes as a new normal registration (spec-mandated "any other reply" semantics). OK as designed?
- [ ] A category renamed between ask and answer keeps the stored name (no FK on `Expense.category`) — accepted edge, or re-resolve on answer?
