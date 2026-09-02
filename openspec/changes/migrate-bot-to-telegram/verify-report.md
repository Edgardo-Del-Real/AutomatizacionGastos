```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:f1d44c4b9b25da164647913b60e908f8ca4fe07642d85acbf507e15980c229a8
verdict: pass
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 20/20
test_command: pnpm --filter @rita/api test
test_exit_code: 0
test_output_hash: sha256:46a5ab9be05813354e65f76d3049163481d80801e00a59bdaf9212c58e74c647
build_command: pnpm --filter @rita/contracts build
build_exit_code: 0
build_output_hash: sha256:e06be89e9f814cc6f50623cff9519f13d3dce96cbb55892263013598af8fd967
```

## Verification Report

**Change**: migrate-bot-to-telegram
**Version**: delta specs (telegram-bot v1 + money-movements RENAMED/MODIFIED delta)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 16 |
| Tasks complete | 16 |
| Tasks incomplete | 0 |

All tasks marked `[x]` in `openspec/changes/migrate-bot-to-telegram/tasks.md`. Task 4.2 (manual smoke with a real BotFather token) is a documented user-run step post-delivery; no code work remains.

### Build & Tests Execution

**Build**: ✅ Passed
```text
> pnpm --filter @rita/contracts build
> tsc -p tsconfig.json
Exit code 0 — output hash sha256:e06be89e9f814cc6f50623cff9519f13d3dce96cbb55892263013598af8fd967
```

**Tests**: ✅ 114 passed / 114 (10 files), 0 failed, 0 skipped
```text
> pnpm --filter @rita/api test  (contracts build && vitest run)
Test Files  10 passed (10)
     Tests  114 passed (114)
Exit code 0 — output hash sha256:46a5ab9be05813354e65f76d3049163481d80801e00a59bdaf9212c58e74c647
```
Integration tests ran against real Postgres on port 5433 (`automatizacionrita_test`), including `prisma migrate deploy` in `beforeAll` — proving the composite-key migration applies cleanly.

> **Remediation (focused verify-gap fix)**: a lifecycle test was added (`telegram.bot.test.ts > graceful stop on shutdown > stops the bot when the Fastify app closes via the onClose hook`) that drives `buildApp` → `registerGracefulStop` → `app.close()` → `bot.stop()`, closing the previously PARTIAL **Graceful stop on shutdown** scenario. Remediation re-run: **114/114 passed (10 files), exit 0**, `pnpm --filter @rita/api typecheck` exit 0, `pnpm --filter @rita/api lint` exit 0. The `test_output_hash` above fingerprints the original 113-test verify run; canonical hashes will be refreshed by the next `sdd-verify` run.

**Typecheck**: ✅ `pnpm --filter @rita/api typecheck` exit 0 (hash sha256:095575b40808b9e67c0e64349658cbd6f005dd95d268ce6cbad0ef14054a08f2)
**Lint**: ✅ `pnpm --filter @rita/api lint` exit 0 (hash sha256:25bf01ad776a614516c577fb2d9e7b8813e932d32706f0d77734696f73404730)

**Coverage**: ➖ Not available — no coverage tool configured in `apps/api` (no `vitest --coverage` script, no coverage provider). Informational only, not a failure.

### Spec Compliance Matrix

Source: `specs/telegram-bot/spec.md` (7 requirements, 16 scenarios) + `specs/money-movements/spec.md` (1 requirement, 4 scenarios).

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Long-Polling Lifecycle | Graceful stop on shutdown | `telegram.bot.test.ts > stops the bot when the Fastify app closes via the onClose hook` (drives `buildApp` → `registerGracefulStop` → `app.close()` → `bot.stop()`; spy asserts the close hook invokes `bot.stop()`) + `stops cleanly when the polling loop is not running` | ✅ COMPLIANT |
| Long-Polling Lifecycle | Offline pipeline drive | `telegram.bot.test.ts > processes an owner text update with zero network calls` (throwing API transformer, `botInfo` stub) | ✅ COMPLIANT |
| Update Filtering | Edited message ignored | `telegram.parser.test.ts > returns null for an edited_message update` + `telegram.service.test.ts > ignores an edited_message update without touching the repository` + `telegram.bot.test.ts > does nothing for an edited_message update` | ✅ COMPLIANT |
| Update Filtering | Non-text message | `telegram.parser.test.ts > returns null for a message without text (photo)` + `telegram.service.test.ts > ignores a non-text message without touching the repository` + `telegram.bot.test.ts > does nothing for a non-text message` | ✅ COMPLIANT |
| Update Filtering | Group chat ignored | `telegram.parser.test.ts > returns null for a message in a group/supergroup chat` + `telegram.service.test.ts > ignores a group chat message without touching the repository` | ✅ COMPLIANT |
| Owner Filtering | Owner message proceeds | `telegram.service.test.ts > records the message and creates an expense for a valid text message from the owner` | ✅ COMPLIANT |
| Owner Filtering | Non-owner message skipped | `telegram.service.test.ts > records the message but does not create an expense for a non-owner sender` + `telegram.service.integration.test.ts > records the message but creates no expense for a non-owner sender` | ✅ COMPLIANT |
| Message Deduplication | Duplicate update skipped | `telegram.service.test.ts > skips a message that was already processed (unique violation)` + `telegram.service.integration.test.ts > skips a duplicate update without creating a second expense` (P2002 on real composite key) | ✅ COMPLIANT |
| Message Deduplication | Same id in different chats | `telegram.service.test.ts > records and processes both messages when the same id arrives from different chats` + `telegram.service.integration.test.ts > records two ProcessedMessage rows when the same message id arrives from different chats` + schema `@@unique([chatId, messageId])` | ✅ COMPLIANT |
| Movement Parsing and Classification | Keyword classification | `telegram.service.test.ts > persists the classified INCOME type for a keyword message` ("Recibí $50000 de sueldo" → INCOME) | ✅ COMPLIANT |
| Movement Parsing and Classification | No amount | `telegram.service.test.ts > records the message but does not create an expense when no amount is found` ("hola") | ✅ COMPLIANT |
| Movement Parsing and Classification | Defaults to expense | `telegram.service.test.ts > persists the classified EXPENSE type for a plain expense message` ("$2000 supermercado" → EXPENSE) | ✅ COMPLIANT |
| Movement Persistence and Error Tolerance | Income movement persisted | `telegram.service.test.ts > persists the classified INCOME type for a plus-prefixed amount` (+5000 → INCOME, ARS) + `telegram.service.integration.test.ts > creates an INCOME movement for a plus-prefixed amount` (real DB row, amount 5000) | ✅ COMPLIANT |
| Movement Persistence and Error Tolerance | Persistence failure tolerated | `telegram.service.test.ts > does not fail the batch when creating the expense fails` (resolves; failure logged via injected `logger` — static evidence `telegram.service.ts:60`) | ✅ COMPLIANT |
| Configuration and Token Secrecy | Missing token fails fast | `env.test.ts > requires TELEGRAM_BOT_TOKEN with no default` + `rejects an empty TELEGRAM_BOT_TOKEN`; `env.ts` `z.string().min(1)` with no default, parsed at import | ✅ COMPLIANT |
| Configuration and Token Secrecy | Token never logged | `telegram.bot.test.ts > logs a redacted error ... without leaking the token` + `redactToken` unit tests (`bot<token>` URL stripped); `server.ts:27` and `telegram.bot.ts:14` both route errors through `redactToken` | ✅ COMPLIANT |
| Message Income Detection (money-movements) | Keyword match | `message.parser.test.ts > classifies a message with an income keyword as INCOME` + `telegram.service.test.ts` keyword case | ✅ COMPLIANT |
| Message Income Detection (money-movements) | Plus-prefixed amount | `message.parser.test.ts > classifies a plus-prefixed amount as INCOME even without a keyword` + service/integration `+5000` cases | ✅ COMPLIANT |
| Message Income Detection (money-movements) | No signal defaults to expense | `message.parser.test.ts > defaults a plain expense message to EXPENSE` + service "$2000 supermercado" case | ✅ COMPLIANT |
| Message Income Detection (money-movements) | Ambiguous message is conservative | `message.parser.test.ts > is conservative and defaults a message with money but no income signal to EXPENSE` ("transferencia 800") + `is conservative and does not match a keyword inside another word` | ✅ COMPLIANT |

**Compliance summary**: 20/20 scenarios compliant, 0 partial, 0 failing, 0 untested.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Long-Polling Lifecycle | ✅ Implemented | `server.ts`: `bot.start()` after `listen`; `onClose` → `bot.stop()`; SIGINT/SIGTERM → `app.close()`; no inbound HTTP surface (webhook deleted); `handleUpdate` fully offline-drivable |
| Update Filtering | ✅ Implemented | `normalizeTelegramMessage` returns `null` for non-`message`, `edited_message`, channel posts, non-private chats, missing `from`, non-text; service returns before repo touch |
| Owner Filtering | ✅ Implemented | `fromId !== ownerChatId` → recorded, no movement (record-then-filter per design D6) |
| Message Deduplication | ✅ Implemented | `ProcessedMessage` composite `@@unique([chatId, messageId])`; P2002 caught via `isUniqueConstraintViolation` → skip without error; migration prunes legacy rows first |
| Movement Parsing and Classification | ✅ Implemented | Reuses `features/messages` parser: `parseAmountAndNote` + `classifyMovementType` (keyword regex, `+`-prefixed, default EXPENSE); null amount → no movement |
| Movement Persistence and Error Tolerance | ✅ Implemented | `createExpense({ amount, currency: "ARS", note, occurredAt: new Date(), type }, ownerId)`; failure caught, logged via `logger`, batch continues |
| Configuration and Token Secrecy | ✅ Implemented | `TELEGRAM_BOT_TOKEN` required, no default; `TELEGRAM_OWNER_CHAT_ID` positive-int coerced; `WHATSAPP_*` absent from schema/`.env.example`; every bot-level error redacted |
| Message Income Detection (money-movements delta) | ✅ Implemented | RENAMED + MODIFIED delta preserves classification semantics and scenario lineage; transport-neutral wording consumed by archive |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 Dedupe key `@@unique([chatId, messageId])` | ✅ Yes | Schema + migration match design verbatim |
| D2 Legacy rows pruned inline first | ✅ Yes | `DELETE FROM "ProcessedMessage"` is the first statement of the migration |
| D3 Repository home `features/messages/message.repository.ts` | ✅ Yes | Composite signature `recordProcessed(chatId, messageId, ownerId)` |
| D4 Mid-chain WhatsApp chatId = sender phone | ✅ Yes | Applied in F1 (rows pruned in F1 migration) |
| D5 grammy `^1.46.0` | ✅ Yes | `apps/api/package.json` dependency |
| D6 Two-layer filtering (parser null + record-then-skip) | ✅ Yes | `normalizeTelegramMessage` + service owner/no-amount short-circuits |
| D7 Lifecycle in `server.ts` (onClose stop, signal handlers) | ✅ Yes | Matches boot/shutdown sequence exactly |
| D8 Offline tests (`botInfo` stub + throwing transformer) | ✅ Yes | `buildOfflineBot` in `telegram.bot.test.ts`; zero network |
| D9 Token secrecy (`redactToken` everywhere, exit(1) on start failure) | ✅ Yes | `telegram.bot.ts`, `server.ts` |
| Env final shape | ✅ Yes | `env.ts` matches design final shape verbatim (verified by `env.test.ts` 7 cases) |
| drop_pending_updates open question | ✅ Resolved | Default — process queued messages; no `drop_pending_updates` code (confirmed by grep) |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Cumulative apply-progress (Engram #231) includes TDD Cycle Evidence table (F3) plus RED→GREEN notes for F1/F2 |
| All tasks have tests | ✅ | 16/16 — every task's verification is backed by a test file or the documented approval net (4.2 is user-run by constraint) |
| RED confirmed (tests exist) | ⚠️ | 13/16 test files present in the repo; F1's `webhook.route.test.ts` + `webhook.service.test.ts` were deleted with the webhook feature in F3 by design — their scenarios are re-covered by the telegram suite (parser/service/integration) |
| GREEN confirmed (tests pass) | ✅ | 114/114 pass on execution (this run) |
| Triangulation adequate | ✅ | Multi-case per behavior: parser 10, service 12, bot 10, integration 5, env 7 — no single-case behaviors |
| Safety Net for modified files | ✅ | F1 99/99, F2 141/141, F3 112/112→113/113 documented; remediation safety net 113/113→114/114; current suite green |

**TDD Compliance**: 5.5/6 checks passed (RED-confirm caveat is a design-intended deletion, not a protocol breach)

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 57 | 5 | vitest (env, parser, service, bot, message.parser) — bot includes the app-close lifecycle wiring test (real Fastify close machinery, no DB) |
| Integration (DB) | 5 | 1 | vitest + real Prisma/Postgres 5433 (`telegram.service.integration.test.ts`) |
| **Total (changed files)** | **62** | **6** | — |
| Safety-net (pre-existing) | 52 | 4 | expenses/movements route+service tests, contracts |

**Coverage**: Coverage analysis skipped — no coverage tool detected.

### Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| — | — | — | No violations found | — |

Audit covered all 6 changed test files. No tautologies, no ghost loops, no smoke-only tests, no type-only assertions standing alone, no empty-collection-only checks, no mock-heavier-than-assertion tests. All assertions verify real behavior (value equality, DB row counts, redaction absence-of-token checks, call arguments).

**Assertion quality**: ✅ All assertions verify real behavior

### Quality Metrics
**Linter**: ✅ No errors (`pnpm --filter @rita/api lint` exit 0)
**Type Checker**: ✅ No errors (`pnpm --filter @rita/api typecheck` exit 0)

### Security Review (backend-security)

| Check | Result | Evidence |
|-------|--------|----------|
| `TELEGRAM_BOT_TOKEN` required, no default | ✅ | `env.ts:10` `z.string().min(1)`; `env.test.ts` 2 cases |
| `TELEGRAM_OWNER_CHAT_ID` required positive int | ✅ | `env.ts:11` `z.coerce.number().int().positive()`; `env.test.ts` 4 cases |
| No token in any log path | ✅ | `telegram.bot.ts:14` `console.error(redactToken(err.message, token))`; `server.ts:27` `app.log.error(redactToken(..., env.TELEGRAM_BOT_TOKEN))`; `grep` of `TELEGRAM_BOT_TOKEN`/`api.telegram.org/bot` in `src` shows only schema definitions, redaction call sites, and tests |
| `redactToken` covers `bot<token>` URLs | ✅ | `telegram.bot.test.ts > strips the token embedded in an api.telegram.org URL` asserts no `bot<token>` remains |
| WhatsApp env vars absent | ✅ | `env.ts`/`.env.example` have no `WHATSAPP_*`; `env.test.ts` asserts key absence; grep of `whatsapp|webhook|rawBody` in `apps/api/src` → 0 production matches (2 hits, both in `env.test.ts` asserting removal) |

### Issues Found

**CRITICAL**: None

**WARNING**:
1. Openspec contract artifacts are untracked: `specs/`, `design.md`, `proposal.md`, `exploration.md` exist on disk but are not committed on `feat/migrate-bot-to-telegram` (only `tasks.md` is tracked). If not committed before archive, the change contract is not version-controlled and would be lost.

**SUGGESTION**:
1. Persistence-failure logging is proven statically (`telegram.service.ts:60` via injected `logger`), but the unit test does not assert the logger callback fires. Consider asserting the logged failure message.
2. No coverage tool configured; adding vitest coverage would let changed-file coverage be reported for future changes (informational).

### Verdict

**PASS** (canonical — all spec scenarios covered; archive-ready once contract artifacts are version-controlled)

All 8 requirements are implemented and 20/20 spec scenarios are proven by passing tests on real Postgres 5433; no CRITICAL findings and no runtime failure. The single blocker from the previous revision — the **Graceful stop on shutdown** scenario was PARTIAL (only `bot.stop()` semantics tested, no test driving the shutdown chain) — is resolved: `telegram.bot.test.ts > graceful stop on shutdown > stops the bot when the Fastify app closes via the onClose hook` drives `buildApp` → `registerGracefulStop` (the extracted `onClose → bot.stop()` wiring) → `app.close()` and asserts the hook invokes `bot.stop()`. Suite is 114/114 (was 113/113), typecheck and lint green. Remaining non-blocking item: the untracked openspec contract artifacts (WARNING above) should be committed before archive so the change contract is version-controlled.