# Exploration: Product features — auto-categorization, bot confirmations, delete/correct movements (2026-09-10-product-features)

## Current State

**Category flow today** — `Expense.category` is `String?` in `apps/api/prisma/schema.prisma` (no enum, free-form). The ONLY writer is the demo seed (`apps/api/scripts/seed-demo.ts`) with canonical English slugs (`food`, `transport`, `services`, `entertainment`, `shopping`, `health`, `salary`, `freelance`, `sales`). The bot never sets it: `TelegramService.handleUpdate` calls `expenseService.createExpense({ amount, currency, note, occurredAt, type })` — no `category` — so every bot-created movement stores NULL. Readers: `PrismaMovementRepository.summaryCategories` uses `COALESCE("category", '')`, so NULL collapses into an empty-name bucket that `CategoryBreakdown` renders as a blank row; `listByOwner` supports an exact `category` filter (free-text input in `MovementFilters`); contracts `createMovementSchema` declares `category: z.string().min(1).nullable().optional()`.

**Bot flow today** — `server.ts` wires `createTelegramBot(env.TELEGRAM_BOT_TOKEN, app.telegramService)`; `telegram.bot.ts` does `bot.on("message", (ctx) => service.handleUpdate(ctx.update))` — the context is discarded, so no reply channel exists. `TelegramService` pipeline: normalize (`edited_message`, non-private chats, non-text → null/skip) → `recordProcessed(chatId, messageId, ownerId)` (P2002 → skip) → owner filter (`fromId !== ownerChatId` → record only, silent) → `parseAmountAndNote` (null → record only, silent) → `classifyMovementType` → `createExpense`. All failures are caught + logged; the batch never crashes. Env: `TELEGRAM_BOT_TOKEN` (required), `TELEGRAM_OWNER_CHAT_ID` (int, required), `OWNER_ID`. The dashboard has `formatARS` (Intl es-AR); the API has NO currency formatter.

**CRITICAL test constraint** — `telegram.bot.test.ts`'s `buildOfflineBot` installs `bot.api.config.use(() => { throw new Error("network call in offline test"); })`. Any outbound call (`ctx.reply`, `bot.api.sendMessage`) throws in tests. Tests never hit Telegram network (`bot.init()`/`getMe` excluded from all suites; integration tests drive `handleUpdate` against real Postgres 5433 `automatizacionrita_test`).

**Dashboard today** — fully read-only. `infra/api.ts` `request()` builds only GET requests (`URLSearchParams` + `ownerId` query param) with zod response validation; exposes `fetchMovements` + `fetchMovementSummary`. Hooks `useMovements` / `useMovementSummary` are plain React hooks (AsyncState idle/loading/success/error + `retry` attempt bump); NO react-query, NO shared invalidation — `MovementList` and `DashboardOverview` are siblings under `App` with independent hooks. `MovementList` renders a table (fecha/tipo/monto/moneda/categoría/nota) with zero row actions. Vite proxies `/api` → `localhost:3000`.

**API patterns** — vertical slices (route/service/repository/types/tests). Owner scoping: GETs use `ownerId` query param; mutations use `x-owner-id` header (missing → `ValidationFailedError` 422). Errors: `AppError` hierarchy — `ValidationFailedError` 422, `NotFoundError` 404, `UnauthorizedError` 401 (unused). Existing `DELETE /expenses/:id` is EXPENSE-ONLY (`deleteById` filters `type: "EXPENSE"`), returns 404 when absent, and is UI-dead (dashboard only calls `/movements`). **No update endpoint exists anywhere.** `MovementRepository` is read-only.

## Affected Areas

- `apps/api/src/features/messages/message.parser.ts` (+ test) — home of transport-agnostic pure text functions; add `classifyCategory` + keyword dictionary (feature 1).
- `apps/api/src/features/telegram/telegram.service.ts` (+ unit/integration tests) — pass `category` to `createExpense`; add reply port + reply text building (features 1+2).
- `apps/api/src/features/telegram/telegram.bot.ts` (+ test) — wire reply port to `ctx.reply`; evolve offline middleware from throw → record for reply assertions.
- `apps/api/src/features/movements/movements.route.ts` / `.service.ts` / `.repository.ts` (+ tests) — new `DELETE /movements/:id` + `PATCH /movements/:id` covering BOTH types (feature 3).
- `packages/contracts/src/index.ts` (+ test) — new `updateMovementSchema`; possibly category enum/list if canonical set is decided.
- `apps/dashboard/src/infra/api.ts` (+ test) — extend `request()` with method/body/headers; add `deleteMovement`/`updateMovement`; add `x-owner-id` header support.
- `apps/dashboard/src/features/movements/useMovements.ts` (+ hooks for mutations), `MovementList.tsx` (+ tests) — row actions, confirm dialog, refresh.
- `apps/dashboard/src/App.tsx` (or a small shared state) — cross-component invalidation of list + summary after mutations.
- `apps/dashboard/src/features/movements/CategoryBreakdown.tsx` — benefits from real category data (no code change required, but its "" bucket disappears once the bot categorizes).

## Approaches

### Feature 1 — Auto-categorization

1. **Keyword dictionary + word-boundary regex in `features/messages` (recommended)** — `classifyCategory(body: string): string | null` as a pure function next to `classifyMovementType`, mirroring `INCOME_KEYWORDS` (`(?:^|[^LETTER])...(?![LETTER])`). Normalize diacritics for matching ("café"/"cafe" → "cafe"), first-match wins with a deterministic priority order, default `null` (or `"other"`, see decisions). `TelegramService` adds `category: classifyCategory(body)` to the create payload.
   - Pros: pure + transport-agnostic like the existing parser; strict-TDD friendly (RED first in `message.parser.test.ts` pattern); zero schema changes (column already nullable); reuses proven boundary-regex approach from the PR #3/#4 parser fix.
   - Cons: dictionary is static data in code (user-defined categories need a future extension point); accent normalization adds a small util; canonical value set must be agreed (English slugs vs Spanish labels).
   - Effort: Low
2. **Separate `features/categories/` slice** — own module for the dictionary + classifier.
   - Pros: clearer home if the dashboard later needs a categories endpoint/picker.
   - Cons: one pure function + a constant does not justify a new slice; the summary already exposes the runtime category list to the dashboard; extra indirection for the same test surface.
   - Effort: Low-Medium
3. **ML/heuristic scoring** — score keywords by relevance.
   - Pros: marginally better for ambiguous text.
   - Cons: no training data, opaque, unmaintainable at this scale; a deterministic dictionary is more testable and honest.
   - Effort: High

### Feature 2 — Bot confirmations

1. **Reply port injected into `TelegramService` (recommended)** — add `sendReply?: (chatId: string, text: string) => Promise<void>` to `TelegramServiceDeps`; `telegram.bot.ts` wires `(chatId, text) => ctx.reply(text)` (or `bot.api.sendMessage`); the service decides WHEN and WHAT to reply; reply failures caught + logged (non-fatal, matching the existing "batch never crashes" behavior).
   - Pros: keeps the service grammY-free and unit-testable with a mock port; reply dedupes for free (dedupe `recordProcessed` runs before any reply branch); the offline bot test can swap the throw-middleware for a recording middleware and assert outbound payloads without touching the network.
   - Cons: needs the offline test middleware change (throw → record); reply text builder must be tested for formatting.
   - Effort: Low-Medium
2. **Pass `ctx` into `handleUpdate(update, ctx)`** — service reaches into grammY's context.
   - Pros: zero new wiring.
   - Cons: couples the transport-agnostic service to grammY types; unit tests must fabricate a ctx; contradicts the service's current envelope-only input.
   - Effort: Medium
3. **Service returns a result; bot layer replies** — pipeline returns a discriminated result (created / parse-fail / ignored).
   - Pros: pure separation.
   - Cons: every early-return (dedupe, non-owner, empty, edited) must become a result value; more plumbing and more surface to test for the same behavior.
   - Effort: Medium

Reply content decisions: success → `✅ Gasto registrado: $2.500,00 café` (with category when detected, e.g. `(food)`); parse-fail → `No entendí...` (optional, see decisions); non-owner / empty / edited / dedupe → silent. Formatting: the API has no currency formatter — either a small local es-AR `Intl` formatter in the telegram slice or plain `AR$ 2500` (moving `formatARS` to `@rita/contracts` would touch the dashboard and is out of proportion).

### Feature 3 — Delete/correct movements from the dashboard

1. **Write methods in the `movements` slice: `DELETE /movements/:id` + `PATCH /movements/:id` (recommended)** — the dashboard's read model is `Movement` (both types); the expense slice is EXPENSE-only legacy. New repository methods `deleteById(id, ownerId)` / `updateById(id, ownerId, patch)` without the `type: "EXPENSE"` filter (this is exactly why `DELETE /expenses/:id` cannot delete an INCOME today). New contracts `updateMovementSchema` (all fields optional, at least one required; `category: null` clears, `undefined` leaves unchanged). Missing row → 404 (codebase convention). Mutations scoped by `x-owner-id` header.
   - Pros: matches the read model and the dashboard's `/api/movements` surface; fixes the INCOME-delete gap; PATCH is the standard partial-update verb; repository pattern mirrors `PrismaExpenseRepository.deleteById` (deleteMany + count).
   - Cons: two write endpoints + service/repo methods + contracts + route tests; dashboard needs the api client extended (method/body/header), two new hooks, row UI, and a refresh story.
   - Effort: Medium-High
2. **Generalize the `expenses` slice to both types and add PATCH there; dashboard calls `/expenses`** —
   - Pros: one slice owns writes.
   - Cons: dashboard reads `Movement` (with `type`); `/expenses` responses and DTOs are EXPENSE-shaped; mixing read model (movements) and write model (expenses) across the UI is confusing; still needs the same dashboard work.
   - Effort: Medium-High
3. **`PUT /movements/:id` full replacement** —
   - Pros: simpler semantics.
   - Cons: forces clients to send the whole entity for a one-field fix; loses clear-null semantics; heavier payloads.
   - Effort: Low-Medium

Dashboard refresh story (decisions): deleting/updating must refresh BOTH the list (`useMovements`) and the summary (`useMovementSummary`, a sibling). Options: (a) App-level refresh token passed to both hooks (fits the plain-hook codebase), (b) add react-query (new dependency, big pattern change), (c) optimistic local state only (leaves KPIs stale — unacceptable), (d) micro event bus (over-engineering). Recommendation: (a) — a `refreshKey` bumped after each successful mutation, consumed as an extra effect dep by both hooks.

## Recommendation

Ship all three features in this change, sequenced: **(1) auto-categorization** as a pure `classifyCategory` in `features/messages` (keyword dictionary, word-boundary + diacritic-insensitive matching, canonical values matching the seed slugs) consumed by `TelegramService`; **(2) bot confirmations** via a `sendReply` port injected into `TelegramService` and wired to `ctx.reply` in `telegram.bot.ts`, with the offline test middleware evolving from throw → record to assert outbound payloads; **(3) dashboard delete/correct** as `DELETE` + `PATCH /movements/:id` in the movements slice (both types), new contracts schema, extended api client, two mutation hooks, row actions with confirm dialog, and an App-level refresh token so list + summary stay coherent. Delivery forecast is High against the 400-line review budget — plan chained PRs (bot slice = features 1+2; dashboard slice = feature 3).

## Risks

- **CRITICAL — offline bot suite breaks on replies**: `buildOfflineBot` throws on ANY api call; the reply feature is untestable until the middleware records instead of throws. Must land with the reply code, not after.
- **CRITICAL — summary/list staleness after mutations**: with independent sibling hooks, deleting a movement leaves KPIs/categories stale unless a refresh mechanism is added. Decided approach: App-level refresh token.
- **WARNING — category value drift**: bot dictionary, seed slugs, and the free-text filter/editor must agree on canonical values or CategoryBreakdown fragments into near-duplicate buckets ("food" vs "comida"). Decide the canonical set in the spec phase; consider exporting it.
- **WARNING — PATCH null vs undefined semantics**: contracts must model "clear category" (`null`) distinctly from "leave unchanged" (`undefined`) or category can never be unset.
- **INFO — overlapping delete surface**: `DELETE /expenses/:id` (EXPENSE-only, UI-dead) coexists with new `DELETE /movements/:id`; decide whether to deprecate or leave it (tests pin it).
- **INFO — delete semantics**: 404 on missing (existing convention, chosen) vs idempotent 204; pick once for both DELETE endpoints.
- **INFO — parse-fail replies and dedupe**: replying to unparseable messages is safe (dedupe runs first) but changes bot behavior; confirm the user wants an error reply or silence.
- **INFO — no auth**: mutations add surface; owner scoping via `x-owner-id` header follows the existing convention (dashboard must start sending it).
- **INFO — reply formatting**: API has no ARS formatter; keep a tiny es-AR `Intl` formatter local to the telegram slice rather than moving `formatARS` to contracts.

## Edge Cases & Ambiguity

- **Categorization**: match on the whole message, not `extractNote` (note reconstruction is lossy — e.g. `"Recibí $50000 de sueldo"` → note `"Recibí $ de sueldo"`); numbers inside words must not match ("cafe2go"); `"sueldo"` is both an INCOME signal and a likely `salary` category — classification and categorization are orthogonal, both apply; multiple keywords → deterministic first-match; accented vs unaccented input; user-defined categories vs fixed set (v1: fixed dictionary + default).
- **Bot replies**: non-owner messages stay silent; edited messages stay ignored (no reply); deduped re-deliveries get no second reply (already covered by ordering); empty text silent; Telegram API failures on reply are logged, never crash the polling loop; truncate long notes (Telegram 4096-char limit).
- **Delete/correct**: deleting an INCOME movement must work (today's `/expenses` delete cannot); deleting a bot-created movement (NULL category) is fine — PATCH can set its category; dashboard state after delete must remove the row AND update KPIs/categories/top lists; PATCH scope — amount/note/category/occurredAt editable; `type` change is risky (income↔expense flip) — propose restricting it.

## Ready for Proposal

**Yes.** Confirm with the user before `sdd-propose`:
1. **Category set**: canonical English slugs matching the seed (recommended) vs Spanish labels; unmatched default `null` (today's behavior, "" bucket) vs `"other"`.
2. **Bot reply scope**: success-only (recommended) vs success + parse-fail ("No entendí"); confirm non-owner stays silent.
3. **Delete semantics**: 404 on missing (consistent with existing routes, recommended) vs idempotent 204.
4. **PATCH field scope**: amount/note/category/occurredAt (recommended); whether `type` is editable.
5. **Refresh strategy**: App-level refresh token (recommended) vs adopting react-query.
6. **Delivery**: chained PRs — bot slice (features 1+2), then dashboard slice (feature 3); or a single PR if the combined diff is accepted as an exception.