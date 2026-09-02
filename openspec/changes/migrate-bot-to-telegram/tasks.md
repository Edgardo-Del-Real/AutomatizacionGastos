# Tasks: Migrate Inbound Bot from WhatsApp Cloud API to Telegram Bot API

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,400–1,500 total (F1 ~450, F2 ~600, F3 ~450) |
| 400-line budget risk | High (per-PR guard; Low vs 4000-line budget) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (F1) → PR 2 (F2) → PR 3 (F3), stacked to main |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Composite dedupe + parser/repo move | PR 1 | `pnpm --filter @rita/api test src/features/webhook/webhook.route.test.ts` | app.inject + Postgres 5433: same id, diff from → 2 rows | `prisma migrate resolve` + revert schema/parser move (expense data untouched) |
| 2 | Telegram feature, offline-testable | PR 2 | `pnpm --filter @rita/api test src/features/telegram` | N/A — offline by design (zero-network transformer); manual smoke: real token, "café 2500" | Delete `features/telegram/`, revert server/app/env adds (webhook still works) |
| 3 | Delete webhook + env cutover | PR 3 | `pnpm --filter @rita/api test` + typecheck | Suite green proves default JSON parser restored | Revert commit restores webhook + WhatsApp env |

## Phase 1: Foundation — Dedupe Key + Shared Messages Module (F1)

| ID | PR | TDD steps (RED→GREEN) | Verify | Rollback |
|----|----|------------------------|--------|----------|
| [x] 1.1 | F1 | RED `webhook.route.test.ts`: same `messageId`, diff `from` → 2 rows (fails on old unique) | route test red | revert test |
| [x] 1.2 | F1 | GREEN (dep 1.1): `schema.prisma` `chatId` + `@@unique([chatId, messageId])`; migration `processed_message_composite_key` (prune-first SQL) | `migrate deploy` test DB; 1.1 green | `migrate resolve` + revert schema |
| [x] 1.3 | F1 | GREEN refactor: move 4 parser fns + tests 1:1 → `messages/message.parser.ts`; `webhook.parser.ts` keeps `extractMessages`/`isRecord` | moved tests green | revert move |
| [x] 1.4 | F1 | GREEN: `messages/message.repository.ts` (`recordProcessed(chatId, messageId, ownerId)`); delete `webhook.repository.ts`; rewire `app.ts` | typecheck + suite green | revert repo move |
| [x] 1.5 | F1 | GREEN: `webhook.service.ts` imports `../messages`, records `(from, id, ownerId)`; service test composite assertions | suite green | revert service edit |

> **Apply note (F1):** All code landed and unit surface is green (63 passing, no regression). DB-backed verification for 1.1/1.2 is **PENDING** — Postgres on 5433 was down at apply time (P1001 on `prisma migrate deploy` in `webhook.route.test.ts`); the migration itself is hand-written per design (prune-first SQL) and will be applied by the existing `migrate deploy` `beforeAll` when the DB is up.

## Phase 2: Telegram Feature (F2)

| ID | PR | TDD steps (RED→GREEN) | Verify | Rollback |
|----|----|------------------------|--------|----------|
| [x] 2.1 | F2 | RED `telegram.parser.test.ts`: text→`TelegramMessage`; photo/edited/group/non-message/missing-`from`→`null`; GREEN `telegram.parser.ts` `normalizeTelegramMessage` | parser test green | revert parser files |
| [x] 2.2 | F2 | RED `telegram.service.test.ts`: P2002 skip, owner filter, no-amount, keyword/`+`/EXPENSE, failure tolerated, ignores skip repo, same-id-diff-chat; GREEN `telegram.service.ts` | service test green | revert service files |
| [x] 2.3 | F2 | RED `telegram.bot.test.ts`: `handleUpdate` offline (stub `botInfo`, throwing transformer), `redactToken` strips `bot<token>`; GREEN `telegram.bot.ts` + `telegram.types.ts`; add `grammy ^1.46.0` | bot test green | revert bot + dep |
| [x] 2.4 | F2 | RED `telegram.service.integration.test.ts`: composite rows + dup skip on 5433; GREEN via 2.2 | integration green | revert test |
| [x] 2.5 | F2 | RED `env.test.ts`: token required/no default, owner id positive-int; GREEN `env.ts` `TELEGRAM_*` + export `envSchema`; `vitest.config.ts`; `.env.example` block | env test green | revert env adds |
| [x] 2.6 | F2 | GREEN (dep 2.2–2.5): `app.ts` decorate `telegramService`; `server.ts` `bot.start()` + `onClose` stop + SIGINT/SIGTERM | suite + typecheck green | revert server/app |

> **Apply note (F2):** All F2 code landed with Strict TDD (RED → GREEN per task). Suite: 141/141 passing (99 F1 baseline + 42 new: parser 10, service 12, bot 9, integration 5 on real Postgres 5433, env 6). Typecheck and lint clean. Offline guarantee per design D8: `bot.botInfo` stub + throwing API transformer, `bot.init()` never runs in tests. Token secrecy per D9: `redactToken` covers `bot<token>` URLs; `bot.start()` rejection exits with redacted log. 4 commits: `normalize telegram updates` · `process owner messages into movements` · `offline bot glue with token redaction` · `wire long polling into server lifecycle`. F1's PENDING note is resolved — F1 verified 99/99 with Postgres up (Engram #231).

## Phase 3: Cutover — Delete Webhook + Env Swap (F3)

| ID | PR | TDD steps (RED→GREEN) | Verify | Rollback |
|----|----|------------------------|--------|----------|
| 3.1 | F3 | GREEN: delete `src/features/webhook/**` (10 files) | typecheck green; `rg -i whatsapp src` empty | revert deletion |
| 3.2 | F3 | RED `env.test.ts`: no `WHATSAPP_*` keys; GREEN `env.ts`/`vitest.config.ts`/`.env.example` drop WhatsApp | env test green | revert env |
| 3.3 | F3 | GREEN: unwire webhook from `app.ts`/`server.ts` | full suite green (default JSON parser restored) | revert commit |

## Phase 4: Verification (final gate)

| ID | PR | TDD steps (RED→GREEN) | Verify | Rollback |
|----|----|------------------------|--------|----------|
| 4.1 | F3 | Full suite + typecheck + lint on PR 3 head; `money-movements` delta (RENAMED+MODIFIED) ready for archive | all green | — |
| 4.2 | F3 | Manual smoke: real BotFather token + owner id, text "café 2500" | EXPENSE movement created (success criteria) | — |