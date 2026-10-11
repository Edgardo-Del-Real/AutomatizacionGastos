# Exploration: LLM Note Interpreter

Change: `llm-note-interpreter` — replace/augment heuristic parsing and (removed) auto-learning with a Groq LLM "note interpreter" for Spanish expense notes (amount, category, product). Provider: Groq free tier, OpenAI-compatible endpoint, model `openai/gpt-oss-20b` (verified working with JSON mode). Explicit `asociar palabra: X a categoria: Y` stays; keyword auto-learning is NOT reintroduced.

## Current State

### Ingestion flow
Entry: `TelegramService.handleUpdate(update: unknown, reply?: ReplyPort): Promise<void>` (`apps/api/src/features/telegram/telegram.service.ts`).

1. `normalizeTelegramMessage(update)` (`telegram.parser.ts`) → `{chatId, messageId, fromId, text} | null` (edited/non-private/non-text → null).
2. `messageRepository.recordProcessed(chatId, messageId, ownerId)` — dedup, unique-violation → skip.
3. Non-owner (`fromId !== ownerChatId`) → ignored.
4. `parseCommand(body)` (`telegram.commands.ts`) — commands win in every state → `handleCommand` (register/rename/associate/list/configurar).
5. State machine (`botStateRepository.get(ownerId)`): `idle` → `handleRegistration`; `awaiting_setup` → `handleSetupReply`; `awaiting_category` → `handleAwaitingCategory`. State names: `"idle" | "awaiting_setup" | "awaiting_category"` (module constants).

`handleRegistration(body, reply)`:
- `parseAmountAndNote(body)` (`apps/api/src/features/messages/message.parser.ts`) → `{amount: number, note: string | null} | null`; null → `helpReply()`.
- Zero categories → set `awaiting_setup`, `setupQuestionReply()` (registration dropped).
- `categoryService.matchNote(ownerId, note)` → keyword match → `createMovement(body, parsed, matched)` + `successReply`.
- Miss → `categoryService.ensureOtro(ownerId)` → create in `"otro"` → state `awaiting_category` with `pendingMovementId`/`pendingNote` → `correctionOfferReply`.

`createMovement(body, parsed, category)` → `expenseService.createExpense({ amount: parsed.amount, currency: "ARS", note: parsed.note, occurredAt: new Date(), type: classifyMovementType(body), category }, ownerId)`.

### Parsing (message.parser.ts)
- `parseAmount`: numeric tokens `/\d[\d.,]*/g`, right-to-left, first valid via `parseNumberToken` (handles `1.234`, `1,234` thousand-groupings and plain ints; NOT `1234,50` mixed cents).
- `extractNote`: body minus last amount token, whitespace-collapsed; null when empty.
- `classifyMovementType`: income keywords (ingreso, cobro, sueldo, venta, recibí, depósito) or `+\d` → `INCOME`, else `EXPENSE`.

### Movement creation
- `ExpenseService.createExpense(input, ownerId)` validates `createMovementSchema` (`packages/contracts`): `amount: z.number().positive()`, `currency` default `"ARS"`, `category`/`note` nullable optional, `occurredAt` coerced, `type` optional.
- `Expense.category` is a plain **string name, no FK** to `Category` (schema.prisma). `createExpense` does NOT validate category ownership — only `MovementService.updateMovement` PATCH calls `categoryService.assertOwnerCategory`.
- `"otro"`: `ensureOtro(ownerId)` upserts the category; the movement is registered immediately in `"otro"` and the `awaiting_category` dialog reassigns it via `updateMovement` (validates category + ownership).

### Categories
- Schema: `Category {id, ownerId, name}` `@@unique([ownerId, name])`; `CategoryKeyword {id, categoryId, keyword, ownerId}` `@@unique([ownerId, keyword])` — keywords stored pre-normalized via `normalizeForMatch`.
- `matchCategory(note, rules)` (`categories/matcher.ts`): length-preserving lowercase+accent-fold, word-boundary regex, ordered `createdAt ASC, keyword ASC` (oldest wins). `CategoryService.matchNote(ownerId, note)` lists rules and delegates.
- Name resolution convention used everywhere: `normalizeForMatch(a) === normalizeForMatch(b)`.

## Affected Areas
- `apps/api/src/features/telegram/telegram.service.ts` — inject interpreter port; wire into `handleRegistration`.
- `apps/api/src/features/telegram/note-interpreter.ts` (new) — port type + `GroqNoteInterpreter` implementation.
- `apps/api/src/app.ts` — `buildApp` DI wiring (construct interpreter, pass to `TelegramService`).
- `apps/api/src/config/env.ts` — add `GROQ_API_KEY` (optional), `LLM_MODEL`, `LLM_BASE_URL`, `LLM_TIMEOUT_MS`.
- `apps/api/.env` — GROQ key present but **malformed**: `TELEGRAM_OWNER_CHAT_ID=8677364917GROQ_API_KEY=gsk_...` on one physical line; must be split onto its own line to load (Node `process.loadEnvFile` parses per line).
- `apps/api/src/features/telegram/telegram.service.test.ts` + `telegram.service.integration.test.ts` — harness must add an interpreter mock; integration `buildService` must stub it (no real network in tests).
- No schema/contract change for slice 1. Product extraction to dashboard is a follow-up (would need `Expense.product String?` column + migration + contract).

## Recommended Integration Design

### Placement and interface
New file `apps/api/src/features/telegram/note-interpreter.ts` (Telegram ingestion concern; expenses is the storage side). Port + implementation:

```ts
export type InterpretedNote = {
  amount: number;          // ARS, already normalized
  category: string | null; // suggested category NAME; null = couldn't pick
  product: string | null;
};

export interface NoteInterpreter {
  interpret(note: string): Promise<InterpretedNote | null>; // null = fall back to deterministic flow
}

export class GroqNoteInterpreter implements NoteInterpreter {
  constructor(private readonly deps: {
    apiKey: string;
    model: string;
    baseUrl: string;        // https://api.groq.com/openai/v1/chat/completions
    timeoutMs: number;
    fetchImpl?: typeof fetch; // injectable for tests
  }) {}
}
```

`null` covers every failure: HTTP error, 429, timeout, non-JSON, schema mismatch, missing/invalid amount.

### Zod schema (validate LLM JSON)
```ts
const llmAmount = z.union([z.number(), z.string()])
  .transform((v) => normalizeAmountString(String(v))); // "1.234,50" | "1234,50" | "1234.5" -> 1234.5; NaN -> reject

const interpretedNoteSchema = z.object({
  amount: llmAmount.refine((n) => Number.isFinite(n) && n > 0),
  category: z.string().trim().min(1).max(60).nullable(),
  product: z.string().trim().max(200).nullable().optional(),
});
```

### Guardrail flow (all failures degrade to today's behavior)
1. **HTTP error / timeout / 429** → catch → return `null` → continue with `parseAmountAndNote` + `matchNote` + otro/correction. Use `AbortSignal.timeout(timeoutMs)`; no retries (avoid 429 storms).
2. **Non-JSON / schema failure** → zod parse fails → `null`.
3. **Amount**: deterministic `parsed.amount` is authoritative. LLM amount used ONLY when deterministic parse yields null (e.g. "gaste como 5 mil pesos"). If LLM amount also invalid → `null`.
4. **Category**: resolve LLM name via `normalizeForMatch` against `categoryService.listCategories(ownerId)`. Exact normalized match → use. No match → `"otro"` + existing `awaiting_category` correction. **Never auto-create categories from LLM output** (existing D6 auto-create only fires on user single-token answers).
5. **Matcher wins**: user-authored keywords (`asociar palabra`) are matched first; the interpreter runs only on keyword miss (and on amount-parse failure).
6. `classifyMovementType` stays deterministic (income keywords / `+\d`).

### Env/config (`apps/api/src/config/env.ts`)
```ts
GROQ_API_KEY: z.string().min(1).optional(),      // optional: unit runs degrade gracefully
LLM_MODEL: z.string().default("openai/gpt-oss-20b"),
LLM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1/chat/completions"),
LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
```
Interpreter constructed only when `GROQ_API_KEY` is present; otherwise `TelegramService` gets a null-safe port (or the port is optional in deps and skipped). Fix the malformed `.env` line.

### Testing
- **Unit (interpreter)**: inject `fetchImpl` stub returning canned JSON; cases: valid JSON, non-JSON, 429, schema mismatch, string amount `"1.234,50"`.
- **Unit (service)**: extend the existing harness (`telegram.service.test.ts`) with `interpret: vi.fn()`; assert: interpreter hit → movement created with LLM category and `matchNote` not called; interpreter `null` → matcher/otro path; LLM category unknown → otro + `awaiting_category`; deterministic amount wins over LLM amount; LLM rescues when deterministic parse fails.
- **Integration**: repo has NO nock — bot HTTP is mocked via a grammy transformer (`recordApiCalls`), DB via real Prisma against `TEST_DATABASE_URL` (`execSync prisma migrate deploy`). For the interpreter, `buildService` must pass a stub `fetchImpl`/interpreter so tests never hit the real Groq endpoint.
- Affected existing tests: `telegram.service.test.ts` (harness gains the port), `telegram.service.integration.test.ts` (`buildService` wiring). `matcher`/`message.parser` tests unaffected.

## Approaches
1. **Deterministic-first, interpreter as enhancement (recommended)** — keep `parseAmountAndNote` + `matchNote` first; interpreter only on keyword miss (category suggestion) and on amount-parse failure (rescue). Zero extra cost/latency for matched notes; degradation is trivial.
2. **Interpreter-first with deterministic fallback** — always call the LLM. Better note quality, but cost/latency per message, 429 risk, harder tests.
3. **Replace parser entirely** — LLM owns amount+category+product. Highest risk: no amount → no registration; network dependency on the core flow. Not recommended.

## Recommendation
Approach 1: matcher first (offline, user-authored, instant), interpreter as the enhancement layer on keyword misses and amount-parse failures, never blocking the deterministic path. Amount precedence: deterministic > LLM. Category: normalized exact-match resolution, `"otro"` + correction on unknown. Product stored in-memory only for slice 1 (dashboard surfacing is a follow-up needing a schema column).

## Risks / Edge Cases (Spanish parsing — concrete prompt examples)
1. Thousands + cents: `"$ 1.234,50"`, `"1234,50"`, `"1,234.50"` — LLM must return `1234.5`; never split digits.
2. `"gaste 5000 en el super"` — "gaste" phrasing; deterministic finds 5000; LLM must not treat "gaste" as a number.
3. Missing amount: `"compre mercaderia"` — no digits → deterministic help today; LLM must return null rather than fabricate an amount.
4. Multiple amounts: `"pague 500 de un total de 1200"` — deterministic takes last token (1200); LLM may pick 500 — deterministic wins.
5. Currency symbols: `"usd 50"`, `"€30"` — bot is hardcoded ARS; prompt must say "always ARS, ignore currency symbols, do not convert".
6. Short/no-digit notes: `"cafe"`, `"uber"`, `"kiosco"` — amount required; LLM may classify category but cannot supply an amount → still null → help.
7. Amount-only `"5000"` — no note; LLM must not hallucinate a category/product from an empty note.
8. Income phrasing `"+2500"` / `"sueldo"` — keep `classifyMovementType` deterministic; LLM must not flip type.
9. LLM category not in the owner's list → `"otro"` + correction; never auto-create.
10. Malformed `.env` (GROQ key concatenated onto previous line) — must be fixed for the env schema to see the key.

## Follow-ups (out of scope for slice 1)
- `Expense.product` column + migration + contract + dashboard surfacing.
- Date extraction ("ayer", "el 12") — `occurredAt` is always now today.
- Semantic category matching (token overlap / embeddings) instead of exact normalized match.
- Circuit breaker / longer backoff when Groq 429s repeatedly.

## Ready for Proposal
Yes — the orchestrator can move to `sdd-propose` with the interpreter-as-enhancement scope (Approach 1, slice 1 as described).