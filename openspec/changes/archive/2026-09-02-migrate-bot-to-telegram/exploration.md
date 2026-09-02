# Exploration: Migrate inbound bot transport from WhatsApp Cloud API to Telegram Bot API (migrate-bot-to-telegram)

## Current State

The API (`apps/api`, `@rita/api`) has one inbound messaging surface: the WhatsApp Cloud API webhook in `src/features/webhook/`:

- `webhook.route.ts` — registers a global `application/json` **buffer** content-type parser (captures `request.rawBody`), a GET `/webhook/whatsapp` verification handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`), and POST `/webhook/whatsapp` which reads `x-hub-signature-256` and delegates to the service.
- `webhook.service.ts` — verifies the HMAC signature (`verifyWebhookSignature`, SHA-256 over the raw body, `timingSafeEqual`), extracts messages, dedupes via `ProcessedMessage.messageId UNIQUE` (P2002 → skip), filters non-owners by `WHATSAPP_OWNER_PHONE`, parses amount/note, classifies type, and creates an `Expense` (INBOUND-ONLY — no outbound replies exist).
- `webhook.parser.ts` — `classifyMovementType` (keywords `ingreso|cobro|sueldo|venta|recibí|depósito` / `+`-prefix → INCOME, else EXPENSE), `parseAmount` (last parseable number token, `.`/`,` thousands), `extractNote`, `parseAmountAndNote` — all **pure string functions, transport-agnostic**. `extractMessages` is the ONLY WhatsApp-specific function (walks `entry[].changes[].value.messages[]`).
- `webhook.repository.ts` — `PrismaProcessedMessageRepository.recordProcessed(messageId, ownerId)` + `isUniqueConstraintViolation` (P2002).
- `webhook.signature.ts` — HMAC verification (WhatsApp-specific).
- `webhook.types.ts` — `WebhookMessage` + Fastify `rawBody` module augmentation.
- 4 test files: `webhook.route.test.ts` (integration, real Prisma on `automatizacionrita_test`), `webhook.service.test.ts`, `webhook.parser.test.ts`, `webhook.signature.test.ts`.

Wiring: `src/app.ts` composition root constructs `WebhookService` from `env.WHATSAPP_APP_SECRET` / `env.WHATSAPP_OWNER_PHONE` / `env.OWNER_ID` and registers `webhookRoute`. `src/server.ts` only starts Fastify (`tsx watch src/server.ts` for dev). Env schema (`src/config/env.ts`): `WHATSAPP_VERIFY_TOKEN` (default), `WHATSAPP_APP_SECRET` (default), `WHATSAPP_OWNER_PHONE` (required). `vitest.config.ts` injects `WHATSAPP_OWNER_PHONE: "+5491100000000"`. Prisma model `ProcessedMessage { messageId String @unique; ownerId String }`.

Production reality: local dev on Windows, `docker-compose` for PostgreSQL only (port 5433), no CI, **no public HTTPS URL / no deployment story**.

## Affected Areas

- `apps/api/prisma/schema.prisma` + new migration — `ProcessedMessage`: add `chatId`, replace `messageId @unique` with `@@unique([chatId, messageId])`.
- `apps/api/src/config/env.ts` — remove WhatsApp vars, add `TELEGRAM_BOT_TOKEN` (required) + `TELEGRAM_OWNER_USER_ID` (coerced number).
- `.env.example` (root) — replace WhatsApp block with Telegram block.
- `apps/api/vitest.config.ts` — env injection swaps to `TELEGRAM_OWNER_USER_ID`.
- `apps/api/package.json` — add `grammY` dependency.
- `apps/api/src/app.ts` — remove webhook wiring; register nothing new (long polling is not an HTTP surface) or minimal.
- `apps/api/src/server.ts` — start the long-polling bot with graceful shutdown (`bot.start()` + `SIGINT`/`SIGTERM` → `bot.stop()`).
- `apps/api/src/features/webhook/**` — deleted (route, service, signature, repository, types, 4 tests); parser functions move out first.
- `apps/api/src/features/messages/message.parser.ts` — NEW home for the 4 pure text functions + moved tests.
- `apps/api/src/features/telegram/**` — NEW: `telegram.types.ts`, `telegram.parser.ts` (Telegram `Update` envelope → normalized message), `telegram.service.ts` (dedupe/owner/parse/classify/persist), `telegram.repository.ts` (composite-key `recordProcessed`), `telegram.bot.ts` (thin grammY glue), tests.
- `openspec/specs/money-movements/spec.md` — webhook-scoped requirements MUST be MODIFIED to the Telegram transport (spec phase).
- `openspec/config.yaml` — context line references the WhatsApp webhook; update in a later phase (not during exploration; archives untouched).

## Investigation Findings

### 1. Transport: webhook vs long polling

**Telegram webhook** — `setWebhook` **requires a public HTTPS URL** (ports 443/80/88/8443; self-signed certs possible). Telegram POSTs updates to your server with an optional `secret_token` echoed in the `X-Telegram-Bot-Api-Secret-Token` header (no body HMAC). Webhook and `getUpdates` are **mutually exclusive** per bot; Telegram retries failed deliveries with backoff.

**Long polling (`getUpdates`)** — your server calls `api.telegram.org` (client-side HTTPS only; **no public URL needed**). `offset` is the acknowledgment mechanism (`offset = last_update_id + 1` confirms receipt); pending updates are queued by Telegram (~24h) and delivered on the next poll, so a stopped process loses nothing, only delays. The bot token is the sole credential.

**Recommendation: long polling.** This project has no public HTTPS URL, no tunnel, no CI, and is a personal single-user tool on a local Windows dev box. A webhook would force ngrok/cloudflared or a deployment just to develop. Long polling works with the existing `tsx watch src/server.ts` process, needs zero new infra, and the low single-user message volume makes the polling loop trivial. The handler logic is transport-independent either way, so switching to webhook later is a config-level change (`setWebhook` + `webhookCallback(bot, "fastify")`) — design the service to accept a verified `Update`, and the swap stays cheap. (One caveat: webhook and polling are mutually exclusive; choosing polling now means NOT calling `setWebhook`.)

### 2. Library: grammY vs telegraf vs raw fetch

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **grammY** (recommended) | TypeScript-first, ESM-native (TS 5.8 monorepo); active maintenance (v1.46.0, Aug 2026, ~4.5M weekly downloads, health 90/100 "Excellent"); `bot.start()` = long polling with offset/retry handled; `bot.handleUpdate(update)` = transport-free testing hook; `webhookCallback(bot, "fastify")` = free future webhook path; sequential processing by default (deterministic, matches today's sequential loop); best docs; no plugins needed for inbound-only text | Adds a dependency to a deliberately minimal API (`fastify`, `cors`, `prisma`, `zod`, contracts); bundles `node-fetch@2` internally (transparent on Node ≥ 20) | Low |
| telegraf | Established, TS since v4 | **v4 lags current Bot API**; the v6 modernization is still an open PR (May 2026) — mainline maintenance is the risk; historical ESM/type friction (`telegraf/filters` subpaths) | Low |
| raw `fetch` to api.telegram.org | Zero dependencies; trivially injectable for tests | Reimplements the hard parts: `getUpdates` offset loop, 409-conflict/retry/backoff handling, polling lifecycle, and typing the huge `Update` union (or hand-rolled zod, a large surface); more code to test and maintain for zero benefit at this scale | Medium |

**Recommendation: grammY.** ESM + TS-first fits the monorepo; `handleUpdate` gives deterministic offline testing of the full pipeline; `start()`/`webhookCallback` make transport a config choice; maintenance is verifiably healthy (unlike telegraf v4's drift). zod synergy: keep the existing pure text parser (it already returns `MovementType` from contracts); grammY types give us the `Update` shape for free, and the service can stay untyped-input-safe via `telegram.parser.ts` normalization.

### 3. Scope: replace vs keep both

**Recommendation: clean replacement in one change** (the user said "cambiar de whatsapp a telegram"):

1. **F1** — Prisma migration (composite dedupe key) + move the 4 pure parser functions to `features/messages/message.parser.ts` (tests move 1:1; pure refactor, green throughout).
2. **F2** — New `features/telegram/` (parser, service, repository, grammY glue) with full unit + integration tests.
3. **F3** — Delete `features/webhook/**` + env cleanup (schema, `.env.example`, vitest env) + `app.ts`/`server.ts` rewiring.

Keep-both is **actively wrong**: `ProcessedMessage.messageId UNIQUE` is a single shared column — a Telegram numeric message id (`"1365"`) and a WhatsApp `wamid` are both strings in the same column, so cross-transport collisions would silently drop valid messages. Parallel operation would *require* the composite-key migration anyway while doubling the env/config surface and contradicting the user's stated intent. Deletion of the WhatsApp route is the honest cutover, and the dedupe-table change makes it safe.

### 4. Security model

- **WhatsApp today**: HMAC-SHA256 over raw body (`x-hub-signature-256`) + `hub.verify_token` handshake; phone-number owner filter.
- **Telegram long polling**: there is **no inbound HTTP surface** — the bot token is the credential for `getUpdates`. Threat model shifts to token secrecy: store `TELEGRAM_BOT_TOKEN` server-side only (env, required — no default, fail fast), never log it, and never log the `https://api.telegram.org/bot<token>/...` URL.
- **Owner identification**: Telegram IDs are integers. Filter on `message.from.id === TELEGRAM_OWNER_USER_ID` (sender, not `chat.id` — `chat.id` is negative for groups and equals `from.id` only in private chats; the owner is "the person who texts the bot"). Env schema: `TELEGRAM_BOT_TOKEN: z.string().min(1)` (required), `TELEGRAM_OWNER_USER_ID: z.coerce.number().int().positive()` (required). Keep `OWNER_ID` (tenant). Remove the three WhatsApp vars.
- **Future webhook hook**: if webhook mode is ever enabled, verify the `X-Telegram-Bot-Api-Secret-Token` header with a timing-safe compare — reuse the `timingSafeEqual` pattern from `webhook.signature.ts` (that file is deleted, but the pattern survives in the new service or a small `telegram.security.ts`). Not needed for the long-polling slice.
- `vitest.config.ts` must inject a test `TELEGRAM_OWNER_USER_ID` (e.g. `"123456789"`) where `WHATSAPP_OWNER_PHONE` is injected today.

### 5. Dedupe

`message_id` is unique **per chat** (not globally like WhatsApp `wamid`s), and `update_id` is the per-bot delivery counter. The correct dedupe key for re-delivered webhook retries (and crash-redelivery in polling) is **(chat.id, message.message_id)**.

- **Option A — composite key (recommended)**: `ProcessedMessage { chatId String; messageId String; ownerId String; @@unique([chatId, messageId]) }`. Requires one Prisma migration. Repository interface becomes `recordProcessed(chatId, messageId, ownerId)` — a clean, honest model. Legacy WhatsApp rows: **prune** them in the migration (the table is a retry guard with zero business value; backfilling a sentinel `chatId` buys nothing since WhatsApp is being removed).
- **Option B — transport-prefixed `messageId`** (`wa:<wamid>` / `tg:<chatId>:<messageId>` in the existing UNIQUE column): zero migration, but pollutes column semantics with opaque encoded keys and keeps a WhatsApp-shaped schema.
- **Option C — drop `ProcessedMessage` entirely**: not recommended — Telegram webhook retries (future) and polling redelivery still warrant a dedupe guard, and the service logic (P2002 → skip) is already proven.

**Recommendation: A.** Migration is routine (drop unique on `messageId`, add `chatId`, add composite unique, `DELETE FROM "ProcessedMessage"`), and the composite key is a superset that would even remain correct if WhatsApp were ever re-added with `chatId = phone`.

### 6. Parser reuse

Confirmed: `classifyMovementType`, `parseAmount`, `extractNote`, `parseAmountAndNote` are **pure string functions with zero transport coupling** (they never touch the WhatsApp envelope; `classifyMovementType` returns `MovementType` from `@rita/contracts`). Only `extractMessages` is WhatsApp-specific and must be deleted with the feature.

**Recommendation:** move the 4 pure functions to `apps/api/src/features/messages/message.parser.ts` (same names, same assertions — `webhook.parser.test.ts` moves 1:1, zero logic change, green). New `features/telegram/telegram.parser.ts` owns the Telegram `Update` envelope → normalized message (`{ id, chatId, fromId, text }`), mirroring the `extractMessages` role. Do NOT keep the parser inside the to-be-deleted webhook feature and import from it — that couples the new transport to the dying feature.

### 7. Test strategy (strict TDD, vitest)

**Unit (no DB, pure):**
- `messages/message.parser.test.ts` — moved unchanged (`parseAmount`, `extractNote`, `parseAmountAndNote`, `classifyMovementType` cases).
- `telegram.parser.test.ts` (NEW, RED first) — fixtures from official Telegram Bot API docs: text `Update` (private chat), non-text (`photo`) → skipped, group chat (`chat.type === "group"`, negative id), `edited_message` → ignored (mirrors WhatsApp's messages-only handling).
- `telegram.service.test.ts` (NEW, RED first) — mirrors `webhook.service.test.ts` with fake repo + fake `ExpenseService`: composite-key dedupe (`recordProcessed(chatId, messageId, ownerId)`; P2002 → skip), owner filter (`from.id !== ownerUserId` → record but no expense), no-amount → record only, non-text → record only, INCOME/EXPENSE classification persisted, batch processing with partial dedupe, expense-creation failure doesn't fail the batch, non-owner batch isolation.

**Integration (Postgres on 5433, `migrate deploy` on `automatizacionrita_test` — existing pattern):**
- `telegram.service.integration.test.ts` (NEW) — drive `TelegramService.handleUpdate(fixtureUpdate)` against real Prisma; assert `ProcessedMessage` rows (composite key) + `Expense` rows. With long polling there is no HTTP route, so this replaces the role `webhook.route.test.ts` played. Keep grammY glue OUT of DB tests: `bot.init()` calls `getMe` against `api.telegram.org`, which must never run in tests.
- The thin grammY wiring (`bot.on("message:text", handler)`) is glue, not logic; verify manually (dev smoke: send "café 2500" to the bot) — the service holds all testable logic.

**Deleted:** `webhook.route.test.ts`, `webhook.service.test.ts`, `webhook.signature.test.ts` (with the feature), `webhook.parser.test.ts` (moved).

**Delivery forecast:** additions ≈ 700–800 lines, deletions ≈ 600–700 (webhook + tests) → total diff well under the 4000-line review budget; **400-line budget risk: Low**, single PR feasible, or 2 chained slices if the migration is reviewed separately.

## Approaches

1. **Long polling + grammY + clean replacement (recommended)** — F1 schema/parser refactor → F2 telegram feature (unit + integration tests) → F3 delete webhook + env cleanup.
   - Pros: zero infra (no tunnel/HTTPS); deterministic sequential processing; grammY `handleUpdate` makes the pipeline testable offline; composite dedupe is the correct Telegram model; honest cutover matching user intent; webhook remains a cheap future config swap.
   - Cons: adds a dependency (grammY); requires one Prisma migration; dev smoke test needs a real bot token from BotFather (manual step).
   - Effort: Medium
2. **Webhook + grammY + clean replacement** — same change, but transport is a public HTTPS endpoint.
   - Pros: push model; closer to the current architecture.
   - Cons: **blocked for local dev** — requires ngrok/cloudflared or a deployment; more moving parts; secret-token header verification needed now.
   - Effort: Medium+ (tunnel/deploy friction)
3. **Raw fetch long polling + clean replacement** — no dependency.
   - Pros: zero deps.
   - Cons: hand-rolls offset/retry/lifecycle and the `Update` typing surface; more bespoke code to maintain for a single-user bot.
   - Effort: Medium

## Recommendation

**Long polling + grammY + clean replacement, sequenced F1→F2→F3.** Long polling matches the project's reality (no public URL, local Windows dev, `tsx watch`), grammY is the actively maintained ESM/TS-native choice with a transport-free test hook, and a clean cutover (delete the WhatsApp feature) is what "cambiar" means — while the composite `(chatId, messageId)` dedupe key makes the switch safe. Move the 4 pure parser functions to `features/messages/` unchanged; delete the WhatsApp envelope code with the feature. Env: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_USER_ID` replace the three WhatsApp vars; `OWNER_ID` stays.

## Risks

- **Bot token is a real secret** — a leaked `TELEGRAM_BOT_TOKEN` lets anyone read the owner's messages via `getUpdates` or hijack the bot; required-with-no-default env var, never logged (especially not in `api.telegram.org/bot<token>` URLs).
- **No outbound replies** — keeping inbound-only means the user gets no confirmation a message was recorded; unchanged from WhatsApp behavior, but worth confirming the user still wants silence on success (and whether an error reply should be sent later — that WOULD require outbound `sendMessage`).
- **Dedupe rows pruned in migration** — deliberate: the table is a retry guard; verify no business logic ever reads `ProcessedMessage` (confirmed: only `recordProcessed` writes, P2002 handling in the service).
- **`bot.init()`/`getMe` network dependency** — grammY glue must be excluded from DB tests to keep the suite offline/deterministic; verified feasible because all logic lives in `TelegramService`.
- **Manual setup step** — a real bot requires BotFather (token) + knowing the owner's user id (`getMe`/`getUpdates` first run); document in `.env.example` comments.
- **Editing semantics** — `edited_message` is ignored (matches WhatsApp's messages-only behavior); if the user edits a message to fix a typo'd amount, it will NOT re-process. Confirm acceptable.
- **Spec/config drift** — `money-movements` spec and `config.yaml` context reference the WhatsApp webhook; the spec phase must MODIFY those requirements, and config context updates in a later phase.

## Ready for Proposal

**Yes.** The orchestrator should confirm four decisions with the user before sdd-propose:
1. **Clean replacement** — delete the WhatsApp webhook feature (recommended) vs keep both.
2. **Long polling transport** — no public URL needed (recommended) vs webhook (needs a tunnel/deployment).
3. **grammY dependency** — acceptable addition to the minimal API (recommended).
4. **Inbound-only stays** — no reply confirmations, and edited messages are ignored (recommended, matches current behavior).