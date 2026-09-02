# Proposal: Migrate Inbound Bot from WhatsApp Cloud API to Telegram Bot API

## Intent

Rita's only inbound surface is a WhatsApp Cloud API webhook (`apps/api/src/features/webhook/`) that requires a public HTTPS URL — which this project does not have (local Windows dev, no tunnel, no deployment, no CI), so the "text a message, register a movement" workflow cannot run locally today. **Product why:** the owner texts expenses/income to a bot; WhatsApp's webhook prerequisite blocks that workflow. **Technical why:** Telegram long polling needs only outbound HTTPS, fits the existing `tsx watch src/server.ts` process, and its per-chat message ids require a composite dedupe key the current schema cannot express.

## Scope

### In Scope
- **F1 — foundation:** Prisma migration: `ProcessedMessage` gains `chatId`, `messageId @unique` becomes `@@unique([chatId, messageId])`, legacy WhatsApp rows pruned. Move the 4 pure parser functions (`classifyMovementType`, `parseAmount`, `extractNote`, `parseAmountAndNote`) + tests 1:1 to `src/features/messages/message.parser.ts` (zero logic change).
- **F2 — telegram feature:** new `src/features/telegram/` (parser: `Update` → normalized message; service: owner filter + dedupe + parse/classify + persist; repository: composite-key `recordProcessed`; thin grammY glue) + `bot.start()` long polling in `server.ts` with SIGINT/SIGTERM graceful shutdown. Unit + integration tests drive `bot.handleUpdate()` offline.
- **F3 — cutover:** delete `src/features/webhook/**` (10 files incl. 4 tests); env swap in `env.ts`, `.env.example`, `vitest.config.ts`: `TELEGRAM_BOT_TOKEN` (required, no default) + `TELEGRAM_OWNER_CHAT_ID` (coerced positive int) replace `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` / `WHATSAPP_OWNER_PHONE`; rewire `app.ts` / `server.ts`.
- Spec delta re-scoping `money-movements` ingestion requirements to the Telegram transport.

### Out of Scope (Non-Goals)
- Webhook transport (`setWebhook`) — documented as a future config swap only; mutually exclusive with polling.
- Outbound replies (`sendMessage`), confirmations, error notifications — inbound-only stays.
- `edited_message` processing (edits never re-process), group-chat handling, multi-owner / multi-bot.
- Dashboard, contracts (`MovementType` reused as-is), `openspec/config.yaml` context edit (later phase).

## Capabilities

> Contract with sdd-spec. Existing specs: `money-movements`, `dashboard-web`.

### New Capabilities
- `telegram-bot`: long-polling Telegram ingestion — update handling, owner filter by `from.id`, composite dedupe, text parsing/classification, movement creation, token secrecy, polling lifecycle.

### Modified Capabilities
- `money-movements`: webhook-scoped ingestion requirements (e.g. Webhook Income Detection) re-scoped to the Telegram transport; classification semantics unchanged.

## Approach

Clean replacement in three chained slices (F1→F2→F3), strict TDD throughout — tests first, fully offline. F1 is a pure refactor (suite stays green). F2 builds the new transport with all logic in `TelegramService`; tests use grammY `bot.handleUpdate(fixture)` — `bot.init()` / `getMe` never run in the suite. F3 deletes WhatsApp code and lands the cutover. The service accepts a normalized `Update`, so a future webhook swap stays config-level (`webhookCallback`).

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Clean replacement; no parallel transports | User intent ("cambiar"); a shared `messageId UNIQUE` column silently drops messages on cross-transport id collisions |
| Long polling (`getUpdates`) | No public URL / tunnel needed; offset acks; Telegram queues pending updates (~24h) across restarts; single-user volume |
| grammY (sole new dependency) | TS/ESM-native, actively maintained; `start()` handles offset/retry; `handleUpdate()` = transport-free test hook |
| Owner = `from.id` via `TELEGRAM_OWNER_CHAT_ID` | Sender identity (`chat.id` is negative in groups); coerced number |
| Token required with no default; WhatsApp env vars removed | Token is the sole credential — fail fast; never logged (esp. `api.telegram.org/bot<token>` URLs) |
| Dedupe: composite `(chatId, messageId)`; legacy rows pruned | Telegram ids are per-chat; table is a retry guard with no business readers |
| Parser reused as-is, moved to `features/messages/` | Pure functions, zero transport coupling; never import from the dying webhook feature |
| Inbound-only; `edited_message` ignored | Matches current WhatsApp behavior; confirmed |

## Affected Areas

| Area | Impact | Change |
|------|--------|--------|
| `apps/api/prisma/schema.prisma` + new migration | Modified | Composite dedupe key; prune rows |
| `apps/api/src/features/messages/**` | New | Parser + moved tests |
| `apps/api/src/features/telegram/**` | New | Parser, service, repository, bot glue, tests |
| `apps/api/src/features/webhook/**` | Removed | 10 files deleted (F3) |
| `apps/api/src/config/env.ts`, `.env.example`, `apps/api/vitest.config.ts` | Modified | Telegram env replaces WhatsApp env |
| `apps/api/src/app.ts`, `apps/api/src/server.ts` | Modified | Unwire webhook; start/stop bot |
| `apps/api/package.json` | Modified | Add `grammY` |
| `openspec/specs/money-movements/spec.md` | Modified | Transport re-scope (spec phase) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bot token leak (attacker reads/hijacks via `getUpdates`) | Low | Required env, no default; never log token or URLs |
| `bot.init()` / `getMe` network call inside tests | Medium | All logic in `TelegramService`; glue excluded from tests |
| Pruned dedupe rows | Low | Deliberate; retry-guard data only, verified no business readers |
| Polling lifecycle / graceful shutdown | Low | `bot.start()` + SIGINT/SIGTERM → `bot.stop()`; sequential processing default |
| Manual setup (BotFather token, owner user id) | Medium | Document in `.env.example`; dev smoke "café 2500" |

## Rollback Plan

Slices are independently revertible. F1: revert migration + schema (`prisma migrate resolve`) — expense data untouched; only retry-guard rows lost. F2: delete `features/telegram/` + revert `server.ts`; webhook still works. F3: revert commit restores the webhook feature + env vars.

## Dependencies

grammY (sole new dependency); PostgreSQL on 5433 + `automatizacionrita_test` for integration tests; `@rita/contracts` unchanged; real BotFather token + owner user id for the manual dev smoke (not CI).

## Delivery Strategy

Auto-chain, 4000-line review budget. Forecast ≈ 700–800 additions / ≈ 600–700 deletions — under budget, above the 400-line single-PR guard: deliver as 3 chained PRs (F1, F2, F3), each a work unit with its own tests and rollback; F3 lands the cutover.

## Success Criteria

- [ ] vitest green (api unit + integration on 5433); typecheck + lint clean; zero network calls in tests.
- [ ] Owner text message → movement created with correct type via long polling; non-owner / non-text / edited / duplicate updates → recorded or skipped, no expense.
- [ ] WhatsApp webhook feature, route, and env vars fully removed; composite unique live.
- [ ] Dev smoke: real bot registers "café 2500" as an EXPENSE movement.

## Open Questions

None blocking — all product decisions were confirmed before this proposal. Spec phase decides the exact delta split (MODIFIED vs REMOVED+ADDED) for webhook-scoped `money-movements` requirements.
