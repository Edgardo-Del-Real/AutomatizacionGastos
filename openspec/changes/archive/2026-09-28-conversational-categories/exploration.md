# Exploration: conversational-categories

- Change: `conversational-categories`
- Artifact store: openspec
- Date: 2026-09-28
- Status: exploration (read-only; no code changes made)

## Product Context (confirmed by the user, not re-opened here)

The bot must understand conversation "within reason" instead of only exact commands. Manual testing produced three concrete failures:

1. **"gasto fijo" vs "gastos fijos" duplicate category** — the keyword matcher is literal, singular/plural variants never match, and the correction flow learns a new category each time.
2. **"quiero dejar un gasto provisto para el mes que viene: Cama algarrobo 210.000" did not trigger planned** — it was registered as a normal PAID expense and the follow-up correction created a phantom "previsto" category (colliding with the system's PENDING concept).
3. **Phantom categories accumulated** — previsto, gasto fijo, gastos fijos, ahorros — all learned from note keywords, colliding with system concepts (previsto, gastos fijos, ahorro/SAVINGS). Already cleaned from the DB; the change MUST prevent recurrence.

## Current State — how the bot understands messages today

### 1. Arrival pipeline (`apps/api/src/features/telegram/telegram.service.ts`)

`handleUpdate` (line 173) runs a fixed order: owner gate → dedupe → `parseCommand` (line 204, exact commands only) → `parseArrivalPrefixes` (line 213) → `parseSavingsOverride` (line 220) → persisted state machine (line 227: `idle` / `awaiting_setup` / `awaiting_category` / `awaiting_amount_confirmation` / `awaiting_movement_selection`) → `handleRegistration` (line 244).

Understanding is split between:
- **Deterministic layers**: commands (`telegram.commands.ts`), arrival prefixes (`telegram.parser.ts`), amount/note/type parser (`message.parser.ts`), category keyword matcher (`categories/matcher.ts`), dialog rules (D6 fallback), movement-correction scorer.
- **LLM layer**: `GroqBotBrain` (`bot-brain.ts`), optional — absent when `GROQ_API_KEY` is unset (`app.ts` line 62). Every brain failure degrades to the deterministic flow (never throws, null → deterministic).

### 2. Arrival prefixes are literal, position-anchored (`telegram.parser.ts`)

- `parseSharedPrefix` (line 10): `/^compartido\s*:\s*/i` — start-of-text only.
- `parseArrivalPrefixes` (line 32): loop-strips `compartido:` and `previsto:` in any order (lines 27-30, 36-46). Both are start-anchored exact spellings. The stripped text flows to the brain/parser; `shared`/`planned` bits thread down (AD6, D10).
- The brain envelope CANNOT carry `planned`: `ConversationEnvelope` (`bot-brain.ts` lines 25-53) has `shared` (line 52) but NO `planned` field. Conversational planned registration is impossible by construction — only the `previsto:` prefix (or the dashboard "Agregar previsto" form) creates PENDING expenses.

### 3. Category matching is exact-normalized word-boundary (`categories/matcher.ts`)

- `normalizeForMatch` (line 13): lowercase + per-char accent fold, length-preserving. No plural/singular handling, no stemming.
- `boundaryRegex` (line 28): `(?:^|[^a-z0-9])<keyword>(?![a-z0-9])` on normalized text.
- `matchCategory` (line 42): oldest-learned wins (createdAt ASC, keyword ASC).
- Keywords are stored **normalized** at associate time (`categories.service.ts` line 90 `associateKeyword`) and created ONLY through the explicit `asociar palabra: P a categoria: X` command (`telegram.commands.ts` line 14; `telegram.service.ts` lines 1287-1299). Corrections NEVER learn keyword rules (spec movement-categories "Keyword Learning and Matching", telegram-bot "Correction Loop": keyword rules only via the explicit command). So the tolerance gap is in **matching** (literal) and **category creation** (unguarded), not in keyword learning.

### 4. Category creation paths — the phantom factory

Every path below creates a NORMAL category with NO reserved-concept check and NO duplicate-variant check (unique is exact `[ownerId, name]` in prisma):

| Path | Location | Notes |
|---|---|---|
| Dialog single-token auto-create | `telegram.service.ts` `d6AwaitingCategory` rule 3 (lines 720-725), `resolveAwaitingCategory` (lines 922-927) | A 1-token reply that is not an existing category → `createCategory` |
| `correct_category` target auto-create | `movement-corrector.ts` `resolveTargetCategory` (lines 112-134) | ANY target name, multi-word included, auto-creates |
| `create_category` intent | `category-executor.ts` `create` (lines 40-66) | Any name |
| Setup list | `telegram.service.ts` `handleSetupReply` (lines 628-671) | Comma/newline split, multi-word allowed |
| `registrar categoria:` command | `telegram.service.ts` `handleCommand` case register (lines 1255-1267) | Any name |

`CategoryService.createCategory` (`categories.service.ts` lines 12-31) only guards: empty name, and `normalizeForMatch(name) === "ahorro"` → SAVINGS upsert (line 19). It does NOT reject "previsto", "gastos fijos", "ahorros", or a plural variant of an existing category.

### 5. Reserved system concepts today

- **ahorro**: `normalizeForMatch(name) === "ahorro"` routes create to `ensureAhorro` (SAVINGS) and forbids rename TO it (`categories.service.ts` lines 19-21, 53-55); delete/rename of the SAVINGS category throws `SavingsForbiddenError` (lines 49-55, 70-74). Reply text: "La categoría de ahorro no se puede borrar ni renombrar…" (`reply-text.ts` line 221).
- **otro**: cannot be deleted (line 67-69); auto-created via `ensureOtro`.
- **previsto / gastos fijos / ahorros (plural) / compartido**: NOT reserved. `normalizeForMatch("ahorros")` ≠ `"ahorro"`, so the ahorro guard is bypassed and a NORMAL "ahorros" category is legal. "previsto" collides with the PENDING concept; "gastos fijos" collides with the planned-query phrasing the brain prompt teaches (`bot-brain.ts` lines 213-214).

### 6. Movement writes do not validate category ownership on the bot path

`registerWithCategory`/`registerOtroWithCorrection` → `createMovement` (lines 1342-1370) → `expenseService.createExpense` (`expenses.service.ts` lines 16-30) validates only `createMovementSchema`; category is a free string. The dashboard path (`movements.service.ts` line 39) calls `assertOwnerCategory`, the bot path does not. Consequence: the bot can persist any category string; integrity relies on the category-creation paths being sane.

### 7. Brain prompt is category-blind and pinned by goldens

`INTERPRET_SYSTEM_PROMPT` (`bot-brain.ts` lines 203-225) never embeds owner categories; category is a suggestion resolved by exact `normalizeForMatch` (`resolveSuggestion`, `telegram.service.ts` lines 617-626) — never auto-created on the registration path. 8 golden files under `__goldens__/` pin both prompts, few-shots, dialog addenda, and rendered dialog context (`bot-brain.test.ts` lines 1017-1062). Any prompt change requires regenerating all 8 goldens in-cycle (spec bot-brain "Prompt changes regenerate goldens in-cycle").

## Exact Failure Paths (evidence)

### F1 — "gasto fijo" vs "gastos fijos" duplicate category

- `boundaryRegex("gasto fijo")` requires the literal token sequence on normalized text; "gastos fijos" contains "gasto" followed by `s` (a word char), so `(?![a-z0-9])` fails (`matcher.ts` lines 28-30). No match → `registerOtroWithCorrection` (`telegram.service.ts` lines 1425-1472) → PAID movement in "otro" → `awaiting_category` dialog.
- The user's variant answer becomes a NEW category: single-token answers auto-create (`telegram.service.ts` lines 720-725, 922-927); multi-word targets auto-create via `MovementCorrector.resolveTargetCategory` (`movement-corrector.ts` lines 112-134) when the brain classifies `correct_category`; `create_category` intent auto-creates (`category-executor.ts` lines 40-66).
- Both "gasto fijo" and "gastos fijos" end up as distinct NORMAL rows (unique is exact `[ownerId, name]`), neither's notes match the other, and the cycle repeats. Duplicates are the RESULT of literal matching + unguarded creation.

### F2 — "quiero dejar un gasto provisto para el mes que viene: Cama algarrobo 210.000"

1. `parseArrivalPrefixes` finds no prefix: the text does not start with `previsto:` (`telegram.parser.ts` lines 27-30) — it starts with "quiero…", and the word is "provisto" (user typo). `planned = false` (line 213 of telegram.service.ts).
2. Not a command → `handleRegistration` → brain interprets: expense signal ("gasto", "210.000") → `register_expense` (`bot-brain.ts` line 207 bias). The envelope has no `planned` field, so the brain CANNOT express planned intent even if it understood it.
3. `executeRegistration` (`telegram.service.ts` lines 401-457): deterministic amount 210000, note "Cama algarrobo", category suggestion resolved by exact match → null → `registerOtroWithCorrection` → **PAID** EXPENSE in "otro" (`createMovement` line 1396: `status` undefined → default PAID).
4. Bot asks for a category; user replies "previsto" (meaning "it was a previsto") → single token → auto-create `createCategory("previsto")` (`telegram.service.ts` lines 720-725 D6 path or 922-927 brain-resolve path) → phantom NORMAL category "previsto"; the movement is reassigned to it and stays PAID. The planned intent is lost forever and the PENDING concept is polluted by a category of the same name.

### F3 — "ahorros" phantom colliding with SAVINGS

- `createCategory("ahorros")`: `normalizeForMatch("ahorros")` is `"ahorros"` ≠ `"ahorro"` → skips the SAVINGS upsert (`categories.service.ts` line 19) → NORMAL category created next to the SAVINGS "ahorro". Same collision family as "previsto": a user category shadows a system concept.

### F4 — keyword tolerance gap is structural, not a learning bug

- Corrections do not learn keyword rules (spec contract, confirmed in code: `associateKeyword` only reachable from the `asociar palabra` command). So the fix is NOT "stop learning bad keywords" — it is (a) make matching tolerant of variants, and (b) stop creating categories that shadow system concepts or duplicate existing ones.

## Options and Tradeoffs

### (a) Tolerant matching (singular/plural, normalization)

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A1. Morphological fold at match time** — fold plural suffixes (`-s`, `-es`, `-as/-os` endings) in `normalizeForMatch` or a new `normalizeForMatchTolerant` used only by `boundaryRegex`/`matchCategory` | Fixes F1 at the matcher, applies to ALL keyword rules and savings keywords; no data change; length-preserving property can be kept with a same-length fold | Spanish plurals are irregular (hombre→hombres, pan→panes, lunes invariant); over-folding risks false positives ("gastos"→"gasto" is desired, but "mes"→"me" is not); needs a small rule table + tests | Medium |
| **A2. Token-set containment matching** — a note matches a multi-word keyword when all keyword tokens appear in the note (order-insensitive), still word-boundary per token | Cheap, handles "gastos fijos" vs "gasto fijo" (tokens {gasto/s, fijo/s} overlap) partially; simple | Order/plural still literal per token; false positives for common tokens; changes semantics pinned in `matcher.test.ts` | Low-Medium |
| **A3. Keyword expansion at associate time** — store the base form plus generated singular/plural variants as separate rules (same category) | Deterministic, no matcher semantic change, variants visible in `listar categorias` | Duplicates rules in DB (unique `[ownerId, keyword]` forces upsert per variant); user must associate variants explicitly or generation must be automatic at associate time; auto-generation has the same irregular-plural risk | Low |
| **A4. LLM-assisted residual matching** — keep deterministic matching, but on a miss let the brain suggest a category that resolves by tolerant/exact match; never create | Already partially built (`resolveSuggestion`); adds conversational understanding for free | Doesn't fix the "otro" miss on the brain-absent path; suggestion is still exact-resolve only today; prompt change → goldens | Low-Medium |

### (b) Reserved system concepts

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **B1. Hard blocklist on every creation path** — reject createCategory (and every auto-create path: dialog, correct_category, setup, command) for a reserved set: `previsto`, `gastos fijos`, `ahorro` (+ its plural/singular variants), `compartido`, `otro` | Directly prevents F2/F3 recurrence; single choke point in `CategoryService.createCategory` covers ALL paths (all creation funnels through it — verify: yes, every path calls `categoryService.createCategory`) | Blocked names must be explained conversationally (reply text); risk of surprising the user who legitimately wants "gastos fijos" as a personal category (product decision needed); irregular plurals need the fold to compare | Low |
| **B2. Soft guard / redirect** — creating "previsto"/"gastos fijos"/"ahorros" replies "eso no es una categoría: usá 'previsto: monto nota' para gastos previstos" instead of silently creating | Educational, keeps intent; prevents collision without hard rejection | More reply text to write/pin; the redirect must still reject the create (else phantom persists) | Low |
| **B3. Normalized reserved set with tolerant fold** — compare the folded name against reserved concepts using the SAME tolerant normalization chosen in (a) | One normalization source; catches "ahorros", "provisto", "gastos fijos" consistently | Tied to A1's fold correctness; reserved matching must be conservative (false-positive folds would over-block) | Low (once (a) lands) |

### (c) Conversational intents without exact prefixes

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **C1. Add `planned` to the brain envelope** (mirror of `shared`, `bot-brain.ts` lines 45-52) — the brain can flag a registration as planned conversationally ("dejalo para el mes que viene"); deterministic `previsto:` prefix stays authoritative (win over the flag, AD6 pattern) | Makes the F2 sentence work with the brain present; symmetric with the existing `shared` mechanism; thread-down plumbing already exists for `planned` through dialogs (`amountConfirmationPayloadSchema` line 128, `registerWithCategory` line 1389) | Prompt + envelope schema change → goldens regeneration; brain-absent path still needs the prefix; the flag alone doesn't fix "provisto" typo | Medium |
| **C2. Loosen the arrival prefix** — accept `provisto`/`previsto` (and `compartido`) anywhere in the first tokens, or tolerate the typo | Fixes the typo deterministically, no brain needed | Free-form note text is full of false positives ("compartido" as a real note word); start-anchored exactness is a deliberate safety property (AD6); high risk of misclassification | Low (mechanical) but High risk |
| **C3. Keep prefix-only, improve discovery** — no new intent; reply text teaches the `previsto:` form on correction offers | Zero brain/prompt risk | F2 keeps failing for conversational phrasing; contradicts the product decision ("within reason") | Low |

### (d) LLM brain vs deterministic fallback — where understanding should own

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **D1. Deterministic-first, LLM as suggester (current) with tolerant matcher** — matcher + reserved guards handle F1/F3; brain suggests categories/amounts/notes; brain NEVER creates | Preserves the brain-absent guarantees; smallest blast radius; the LLM is already reply-after-action and category-blind | Conversational planned (C1) still needs the envelope change; auto-create paths still need the B guards | Medium |
| **D2. LLM-first for intent, deterministic for every write** — the brain owns intent classification (including planned via C1), but every materialization (category creation, movement write, status) stays deterministic and guarded | Maximum conversational surface; the state machine stays authoritative (spec contract); matches the product intent | Prompt taxonomy grows; more golden churn; the brain-absent fallback diverges further from the brain path (two behaviors to maintain) | Medium-High |
| **D3. Remove/gate dialog auto-create** — single-token dialog answers no longer auto-create a category; they list existing categories or require the explicit `create_category` intent | Kills the largest phantom source (F2's "previsto" and repeated F1 variants) | Behavior change pinned by specs/tests (`telegram-bot` "Unknown single-token answer auto-creates the category only", `telegram.service.test.ts`); product decision: convenience vs pollution | Low-Medium |

## Affected Areas

- `apps/api/src/features/categories/matcher.ts` — tolerant matching (A1/A2/A3); `normalizeForMatch`/`boundaryRegex` are shared with `savings.service.ts` (savings keyword matching reuses them).
- `apps/api/src/features/categories/categories.service.ts` — reserved-concept guard in `createCategory`/`renameCategory` (B1/B2/B3); single choke point for every creation path.
- `apps/api/src/features/telegram/telegram.service.ts` — dialog auto-create paths (D3), conversational planned plumbing (C1), registration tails.
- `apps/api/src/features/telegram/movement-corrector.ts` — `resolveTargetCategory` auto-create (B guards + D3).
- `apps/api/src/features/telegram/category-executor.ts` — create/rename/delete result shaping (B guard errors surfaced as `savings_forbidden`-style machine codes).
- `apps/api/src/features/telegram/bot-brain.ts` — envelope `planned` field + prompt instruction (C1); goldens.
- `apps/api/src/features/telegram/bot-brain.test.ts` + `__goldens__/*` — 8 goldens MUST be regenerated in-cycle on any prompt/envelope change.
- `apps/api/src/features/telegram/reply-text.ts` — reserved-concept redirect/error replies (B2).
- `apps/api/src/features/telegram/telegram.parser.ts` — only if C2 is chosen (not recommended).
- Specs: `movement-categories` (matching semantics, reserved names), `telegram-bot` (dialog auto-create, planned registration channel), `bot-brain` (envelope, prompts, goldens), `savings` (savings keyword matching if the matcher semantics change — shared `boundaryRegex`).
- Tests pinning current behavior: `matcher.test.ts`, `telegram.service.test.ts` (dialog rules, planned prefix), `telegram.parser.test.ts`, `bot-brain.test.ts`, `reply-text.test.ts`, `categories.service.integration.test.ts`, `telegram.service.integration.test.ts`.

## Risks

- **Shared matcher semantics**: `boundaryRegex`/`normalizeForMatch` are reused by savings-rule matching (`savings.service.ts` lines 37-46) — a tolerant fold changes savings matching too; scope that deliberately (A1 on category matching only vs shared).
- **Golden churn**: any prompt/envelope change forces regeneration of 8 pinned goldens in the SAME change or CI fails (spec contract).
- **Plural folding false positives**: Spanish irregular plurals and invariant words; over-folding misroutes notes. Needs a conservative rule set + fixtures.
- **Product semantics of reserved names**: hard-blocking "gastos fijos"/"previsto" as categories is a product decision — the user may want a real "gastos fijos" category for the dashboard. The proposal must pick B1 vs B2 and define the exact reserved set.
- **Brain-absent path divergence**: conversational planned (C1) only works with the brain; the deterministic fallback must keep a discoverable path (prefix). Two behaviors to test.
- **DB integrity**: `Expense.category` is a denormalized string; the bot write path skips `assertOwnerCategory` — guards must live at category-creation time, not write time.

## Open Product Forks (for the proposal gate)

1. **Reserved names: hard block or soft redirect?** Which names are reserved (`previsto`, `gastos fijos`, `ahorro`/`ahorros`, `compartido`, `otro`)? What reply when the user insists?
2. **Dialog auto-create: keep, gate, or remove?** Single-token correction answers currently auto-create categories — the phantom source. Convenience vs pollution.
3. **Conversational planned: add the `planned` brain flag?** Mirrors `shared`. Also: should the arrival prefix tolerate the "provisto" typo, or is start-anchored exactness a safety property to keep?
4. **Plural handling: morphological fold vs token containment vs associate-time expansion?** And does it apply to savings keywords too (shared matcher)?
5. **LLM ownership ceiling**: does the brain ever get to *create* (categories, planned status), or is it permanently a suggester with deterministic writes?

## Recommendation (exploration leanings)

- (b) **B1+B2 combined**: a reserved-concept guard inside `CategoryService.createCategory` (single choke point) with a friendly redirect reply — prevents F2/F3 recurrence everywhere with minimal blast radius.
- (a) **A1 conservative plural fold** on `normalizeForMatch` (or a scoped variant) — fixes F1 at the source; add irregular-plural fixtures; decide savings-keyword scope explicitly.
- (c) **C1**: add `planned` to the brain envelope mirroring `shared`, prefix stays authoritative — makes the F2 sentence work conversationally without touching prefix safety.
- (d) **D1 with D3 gated**: deterministic-first remains; gate dialog auto-create behind the reserved+duplicate checks (B) rather than removing it outright (smaller product delta).
- LLM stays a suggester; no brain-owned writes. Any prompt change regenerates the 8 goldens in-cycle.

## Ready for Proposal

**Yes** — the failure paths are fully traced with file/line evidence and the option space is mapped. The proposal gate should present the five product forks above; the user's answers on forks 1-4 determine the concrete approach (especially B1 vs B2 and A1's scope).