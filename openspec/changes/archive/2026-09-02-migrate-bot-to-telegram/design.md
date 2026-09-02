# Design: Migrate Inbound Bot from WhatsApp Cloud API to Telegram Bot API

## Technical Approach

Clean replacement in three chained, each-green slices: **F1** — composite dedupe key + shared `features/messages/` module (pure refactor); **F2** — `features/telegram/` with grammY long polling, all ingestion logic in `TelegramService` (offline-testable); **F3** — webhook deletion + env cutover. Implements `specs/telegram-bot/spec.md` and the `money-movements` transport re-scope. Vertical-slice conventions (service/repository/tests per feature, manual DI in `app.ts`) are preserved; `@rita/contracts` and `ExpenseService` are unchanged.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| D1 | Dedupe key | `@@unique([chatId, messageId])` on `ProcessedMessage` | prefixed ids (opaque); drop table | Telegram ids are per-chat; honest model; retry guard still needed |
| D2 | Legacy rows | Pruned inline as first statement of the migration | sentinel backfill; separate prune script | Zero business readers; atomic with DDL; scripts can be skipped/forgotten |
| D3 | Repository home | `ProcessedMessageRepository` moves to `features/messages/message.repository.ts` in F1 with composite signature | keep in webhook until F3 | Telegram (F2) must not import the dying feature; F3 becomes pure deletion |
| D4 | Mid-chain WhatsApp chatId | Webhook service records with `chatId = message.from` (sender phone) | constant sentinel | wamids are globally unique, so dedupe semantics are unchanged; per-sender is honest |
| D5 | Library | `grammy@^1.46.0` in `apps/api/package.json` dependencies | telegraf (v4 API drift); raw fetch (hand-rolled offset loop + Update typing) | ESM/TS-native; `start()` handles offset/retry; `handleUpdate()` is the offline test hook |
| D6 | Two-layer filtering | Parser returns `null` for envelope ignores; service record-then-skips | filtering only in grammY middleware | Every spec scenario stays drivable via `service.handleUpdate(fixture)` without grammY |
| D7 | Lifecycle | `app.ts` composes + decorates `telegramService`; `server.ts` builds the bot, stops it in a Fastify `onClose` hook; SIGINT/SIGTERM → `app.close()` | auto-start in `onReady` hook | `onReady` fires in route tests and would start polling; process concerns belong to `server.ts` |
| D8 | Offline tests | `bot.botInfo` stub (skips `getMe`) + API transformer that throws; service tests bypass grammY entirely | `bot.init()`; HTTP mocking | Hard zero-network guarantee; `init()`/`getMe` never runs in the suite |
| D9 | Token secrecy | Pure `redactToken(value, token)` wraps every bot-level log; `bot.start()` rejection logs redacted + `exit(1)`; service never sees the token | logging raw grammY errors | grammY errors can embed `api.telegram.org/bot<token>` URLs; spec forbids token in logs |

## Data Flow

```
api.telegram.org ──getUpdates (long poll)──▶ grammY bot.start()  [server.ts]
                                                │ update
                                                ▼
              bot.on("message") → TelegramService.handleUpdate(ctx.update)
                                                │ normalizeTelegramMessage → TelegramMessage | null
                                                │   null ⟸ non-text | edited_message | group chat | non-message
                                                ▼
              recordProcessed(chatId, messageId, ownerId) ──P2002──▶ skip (duplicate)
                                                │
                                                ▼
              owner filter: from.id === TELEGRAM_OWNER_CHAT_ID ──else──▶ recorded, no movement
                                                │
                                                ▼
              parseAmountAndNote + classifyMovementType  [features/messages] ──null──▶ recorded, no movement
                                                │
                                                ▼
              ExpenseService.createExpense({ amount, "ARS", note, now, type }, ownerId) ──error──▶ logged, batch continues
```

Boot/shutdown sequence:

```
server.ts → buildApp()            (app.ts composes TelegramService, decorates it on the app)
server.ts → createTelegramBot(env.TELEGRAM_BOT_TOKEN, app.telegramService)
server.ts → app.addHook("onClose", async () => bot.stop())   [registered before listen]
server.ts → app.listen() ; void bot.start()                  [rejection → redacted log + process.exit(1)]
SIGINT/SIGTERM → app.close() → onClose hook → bot.stop() → polling loop exits → event loop drains
```

## File Changes

| File | Action | Slice |
|------|--------|-------|
| `apps/api/prisma/schema.prisma` | Modify — model per D1 | F1 |
| `apps/api/prisma/migrations/<ts>_processed_message_composite_key/migration.sql` | Create — prune + DDL | F1 |
| `apps/api/src/features/messages/message.parser.ts` (+ `message.parser.test.ts`) | Create — 4 pure functions + tests moved 1:1 | F1 |
| `apps/api/src/features/messages/message.repository.ts` | Create — moved repo, composite signature, `isUniqueConstraintViolation` | F1 |
| `apps/api/src/features/webhook/webhook.repository.ts` | Delete — moved | F1 |
| `apps/api/src/features/webhook/webhook.parser.ts` | Modify — reduced to `extractMessages` + `isRecord` | F1 |
| `apps/api/src/features/webhook/webhook.service.ts` | Modify — imports from `../messages`; records `(from, id, ownerId)` | F1 |
| `apps/api/src/features/webhook/webhook.service.test.ts` / `webhook.route.test.ts` | Modify — composite-key assertions; route test gains RED same-id/different-chat case | F1 |
| `apps/api/src/app.ts` | Modify — repo import path (F1); add + decorate `TelegramService` (F2); remove webhook wiring (F3) | F1–F3 |
| `apps/api/src/features/telegram/telegram.types.ts` | Create — `TelegramMessage`, Fastify `telegramService` augmentation | F2 |
| `apps/api/src/features/telegram/telegram.parser.ts` (+ test) | Create — envelope normalization | F2 |
| `apps/api/src/features/telegram/telegram.service.ts` (+ test) | Create — all ingestion logic | F2 |
| `apps/api/src/features/telegram/telegram.bot.ts` (+ test) | Create — `createTelegramBot`, `redactToken` | F2 |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Create — real Prisma on 5433 | F2 |
| `apps/api/package.json` | Modify — `grammy: ^1.46.0` | F2 |
| `apps/api/src/config/env.ts` | Modify — F2 adds `TELEGRAM_*`, exports `envSchema`; F3 removes `WHATSAPP_*` (final shape below) | F2/F3 |
| `apps/api/src/config/env.test.ts` | Create — schema assertions | F2/F3 |
| `apps/api/vitest.config.ts` | Modify — F2 injects `TELEGRAM_BOT_TOKEN`/`TELEGRAM_OWNER_CHAT_ID`; F3 drops `WHATSAPP_OWNER_PHONE` | F2/F3 |
| `.env.example` | Modify — F2 adds Telegram block (BotFather + user-id instructions); F3 removes WhatsApp block | F2/F3 |
| `apps/api/src/server.ts` | Modify — bot lifecycle + signal handling (final shape below) | F2 |
| `apps/api/src/features/webhook/**` (8 remaining files: route, service, parser, signature, types + 3 tests) | Delete — clean replacement | F3 |

## Interfaces / Contracts

`ProcessedMessage` model (F1):

```prisma
model ProcessedMessage {
  id          String   @id @default(cuid())
  chatId      String
  messageId   String
  ownerId     String
  processedAt DateTime @default(now())

  @@unique([chatId, messageId])
  @@index([ownerId])
}
```

New/reshaped TypeScript surface (F1–F2):

```ts
// features/messages/message.repository.ts
export interface ProcessedMessageRepository {
  recordProcessed(chatId: string, messageId: string, ownerId: string): Promise<void>;
}
// features/messages/message.parser.ts — classifyMovementType, parseAmount,
// extractNote, parseAmountAndNote, ParsedAmount: moved 1:1, zero logic change.

// features/telegram/telegram.types.ts
export type TelegramMessage = { chatId: string; messageId: string; fromId: number; text: string };
declare module "fastify" { interface FastifyInstance { telegramService: TelegramService } }

// features/telegram/telegram.parser.ts
export function normalizeTelegramMessage(update: unknown): TelegramMessage | null;

// features/telegram/telegram.service.ts
export type TelegramServiceDeps = {
  messageRepository: ProcessedMessageRepository; expenseService: ExpenseService;
  ownerChatId: number; /* compared against message.from.id — env TELEGRAM_OWNER_CHAT_ID */
  ownerId: string; logger?: (message: string) => void;
};
export class TelegramService { async handleUpdate(update: unknown): Promise<void> }

// features/telegram/telegram.bot.ts
export function redactToken(value: string, token: string): string;
export function createTelegramBot(token: string, service: TelegramService): Bot; // bot.on("message") → service.handleUpdate(ctx.update); bot.catch(redacted)
```

Env schema final shape (F3):

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_OWNER_CHAT_ID: z.coerce.number().int().positive(),
  OWNER_ID: z.string().min(1).default("default"),
});
```

Offline bot test helper + fixture shape (F2, non-obvious patterns):

```ts
function buildOfflineBot(service: TelegramService) {
  const bot = createTelegramBot("123456:TEST_TOKEN", service);
  bot.botInfo = { /* full getMe stub */ } as Bot["botInfo"]; // skips getMe
  bot.api.config.use(() => { throw new Error("network call in offline test"); }); // zero-network guard
  return bot;
}
function textUpdate(o?: { fromId?: number; chatId?: number; messageId?: number; text?: string }) {
  const fromId = o?.fromId ?? 123456789; // equals vitest TELEGRAM_OWNER_CHAT_ID
  return { update_id: 8000, message: { message_id: o?.messageId ?? 42,
    from: { id: fromId, is_bot: false, first_name: "Rita" },
    chat: { id: o?.chatId ?? fromId, type: "private", first_name: "Rita" },
    date: 1712803046, text: o?.text ?? "café 2500" } };
}
// variants built inline per test file (repo convention): photo (no text), edited_message,
// chat.type "group" with negative chat id, non-owner fromId, callback_query / my_chat_member.
```

## Testing Strategy

Strict TDD; commands: `pnpm --filter @rita/api test` (Postgres on 5433 + `automatizacionrita_test`, existing `migrate deploy` pattern), `pnpm --filter @rita/api typecheck`, `pnpm --filter @rita/api lint`.

| Slice | File (RED order) | Asserts |
|-------|------------------|---------|
| F1 | `messages/message.parser.test.ts` (moved 1:1) | unchanged parser behavior — green move |
| F1 | `webhook.route.test.ts` new case (RED) | same `messageId`, different `from` → 2 `ProcessedMessage` rows (fails on old unique, green after migration) |
| F1 | `webhook.service.test.ts` (adapted) | `recordProcessed(from, id, ownerId)` composite args; `findUnique({ where: { chatId_messageId } })` |
| F2 | `telegram.parser.test.ts` (RED) | text → `TelegramMessage`; non-text / edited / group / non-message / missing `from` → `null` |
| F2 | `telegram.service.test.ts` (RED) | mirrors `webhook.service.test.ts` with fakes: P2002 skip, owner filter, no-amount, INCOME keyword / `+` / EXPENSE default, expense failure tolerated, envelope-ignores never touch the repo, same id different chats both processed |
| F2 | `telegram.bot.test.ts` (RED) | `bot.handleUpdate(textUpdate())` creates expense; edited/non-text do nothing; transformer proves zero API calls; `redactToken` strips `bot<token>` URLs |
| F2 | `telegram.service.integration.test.ts` (RED) | real Prisma: composite rows + expense rows; duplicate skipped; replaces `webhook.route.test.ts`'s DB role |
| F2/F3 | `config/env.test.ts` (RED) | token required (no default); owner id positive-int coercion; F3: no `WHATSAPP_*` keys in schema shape |
| F3 | full suite after deletion | webhook tests gone; typecheck proves `rawBody` augmentation removed; existing expenses/movements route tests keep passing — they POST JSON via Fastify's default parser, proving the custom buffer parser removal restores default JSON parsing |

## Threat Matrix

| Boundary | Applicability | Design response |
|---|---|---|
| Documentation-like paths | N/A — no executable/file-classification surface introduced | — |
| Git repository selection | N/A — no git CLI in product code | — |
| Commit state | N/A — no VCS automation in product code | — |
| Push state | N/A — no push automation in product code | — |
| PR commands | N/A — no PR automation in product code | — |

No shell/subprocess/VCS boundary exists. The applicable security boundary is credential secrecy and transport trust — covered by spec requirements (Configuration and Token Secrecy) and RED tests: `env.test.ts` (fail fast), `redactToken` + throwing transformer (never logged, zero network).

## Migration / Rollout

Single Prisma migration (`prisma migrate dev --name processed_message_composite_key`), hand-ordered — prune first so the `NOT NULL` add lands on an empty table:

```sql
-- Prune legacy WhatsApp rows (retry guard only; no business readers)
DELETE FROM "ProcessedMessage";
-- AlterTable
ALTER TABLE "ProcessedMessage" ADD COLUMN "chatId" TEXT NOT NULL DEFAULT '';
-- DropIndex
DROP INDEX "ProcessedMessage_messageId_key";
-- CreateIndex
CREATE UNIQUE INDEX "ProcessedMessage_chatId_messageId_key" ON "ProcessedMessage"("chatId", "messageId");
```

Rollout: merge PRs F1 → F2 → F3 in order; `prisma migrate deploy` on test DB is already automated in integration `beforeAll`. Rollback per slice: F1 `prisma migrate resolve` + revert (expense data untouched); F2 delete `features/telegram/` + revert `server.ts`/env additions (webhook still works); F3 revert restores webhook + env vars.

Chained PR boundaries (auto-chain, sequential stacked PRs to `main`, retarget after parent merges; each ≤ ~400 lines):

| PR | Commits (work units, tests included with each) |
|----|------------------------------------------------|
| F1 | `refactor(messages): extract pure parser to features/messages` · `feat(db): dedupe processed messages on (chatId, messageId)` |
| F2 | `feat(telegram): normalize telegram updates` · `feat(telegram): process owner messages into movements` · `feat(telegram): offline bot glue with token redaction` · `feat(telegram): wire long polling into server lifecycle` (grammY dep, env additions, vitest env, app decoration, integration test) |
| F3 | `refactor(api): remove whatsapp webhook feature` · `feat(config): cutover env to telegram-only` |

Env cutover splits across slices so every PR compiles and stays green: F2 **adds** `TELEGRAM_*` (service/bot need them; WhatsApp vars coexist), F3 **removes** `WHATSAPP_*`.

## Open Questions

- [ ] First poll after cutover: process Telegram's queued (~24h) pre-cutover messages normally (default — they are genuine owner texts, deletable in the dashboard), or start once with `bot.start({ drop_pending_updates: true })`? Non-blocking; default is process.
