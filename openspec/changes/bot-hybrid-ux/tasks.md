# Tasks: Bot Hybrid UX

## Review Workload Forecast

Estimated changed lines: 1500–2200 · Risk: High · Chained: Yes · Delivery: single-pr (size:exception)

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Test prefix: `pnpm --filter @rita/api exec vitest run`

### Suggested Work Units

| Unit | Goal | Focused test (after prefix) | Harness | Rollback |
|---|---|---|---|---|
| 1 | Parser+payloads+planned (a) | `telegram.parser bot-brain` | N/A pure | Revert 3 files |
| 2 | Port+callbacks+preview (b,c) | `telegram.service telegram.bot telegram.commands reply-text` | `recordApiCalls` offline | Revert service/bot/server/commands/reply-text |
| 3 | Gate+menu (d,e) | `movement-lifecycle-executor telegram.service` | Fastify inject + test DB | Revert executor+service |
| 4 | Dialog+cleanup+goldens (f,g,h) | `telegram.service` + full suite | cleanup `--dry-run` | Revert tails+script; DB backup |

## Phase 1: Foundation — parser, payloads, planned

- [ ] 1.1 RED `telegram.parser.test.ts`: `quickCaptureParse` match/miss; `normalizeTelegramCallback` private/edited/group; `buildCallbackData` ≤64B ASCII
- [ ] 1.2 GREEN `telegram.parser.ts`: DTO types, `quickCaptureParse`, `normalizeTelegramCallback`, `buildCallbackData` (D4)
- [ ] 1.3 RED `telegram.service.test.ts`: payload schemas decode; corrupt → null; `BOT_STATES` new states
- [ ] 1.4 GREEN `telegram.service.ts`+`bot-state.repository.ts`: schemas + decode helpers; states added
- [ ] 1.5 RED `bot-brain.test.ts`: `planned` → null; prompt `toContain` updates
- [ ] 1.6 GREEN `bot-brain.ts`: `planned: z.never().optional()` (D7); prompt/few-shots

## Phase 2: Reply port + callbacks + wiring

- [ ] 2.1 RED harness: 3-arg stub; `keyboards`/`edits` arrays; `recordApiCalls` asserts
- [ ] 2.2 GREEN `telegram.service.ts`: `ReplyPort` + `safeReply`
- [ ] 2.3 RED `telegram.service.test.ts`+`telegram.commands.test.ts`: `handleCallback` dispatch; unknown honest; chat ignored; `parseCommand` `/`+`_`
- [ ] 2.4 GREEN `telegram.service.ts`+`telegram.commands.ts`: `handleCallback`; normalization
- [ ] 2.5 RED `telegram.bot.test.ts`: callback wiring; edit-fail → new message; `setMyCommands` tolerated
- [ ] 2.6 GREEN `telegram.bot.ts`: `callback_query` wiring; `startTelegramBot`; `server.ts` swap

## Phase 3: Preview + type by button

- [ ] 3.1 RED `telegram.service.test.ts`+`reply-text.test.ts`: preview flows (match, interpret 0, prefix PENDING, toggle, save once, retry, Corregir, abandon)
- [ ] 3.2 GREEN `telegram.service.ts`+`reply-text.ts`: `quickCaptureParse` insert; preview state machine; templates

## Phase 4: Delete gate

- [ ] 4.1 RED `movement-lifecycle-executor.test.ts`+`telegram.service.test.ts`+`reply-text.test.ts`: `gated` resolve-only; `deleteWindow`; gate flows (unique/ask/none, ok/404/no, retry, abandon)
- [ ] 4.2 GREEN `movement-lifecycle-executor.ts`: resolve-only + `deleteWindow`
- [ ] 4.3 GREEN `telegram.service.ts`+`reply-text.ts`: gate wiring + `deleteConfirmPayloadSchema`; templates

## Phase 5: Menu + help

- [ ] 5.1 RED `telegram.service.test.ts`+`reply-text.test.ts`: `/menu` 5 buttons; `m:new`; `m:prev` teach no state; `m:del`→dk→gate; `m:rep`; `m:help` offline
- [ ] 5.2 GREEN `telegram.service.ts`+`reply-text.ts`: `m:*` dispatch; menu/ayuda templates

## Phase 6: Dialog buttons + auto-create removal

- [ ] 6.1 RED `telegram.service.test.ts`+`reply-text.test.ts`: non-match buttons (3 sites), no Category row; guards; exact/folded resolve; `cat:` apply/deleted/closed; `cp:` pages
- [ ] 6.2 GREEN `telegram.service.ts`+`reply-text.ts`: `applyCategoryCorrection`/`applyCollectCategory`; `categoryButtons`; templates

## Phase 7: Ghost cleanup

- [ ] 7.1 Modify `cleanup-phantom-data.ts`: `--dry-run` default + `--write`; backup/asserts kept
- [ ] 7.2 Runbook (post-apply): dry-run real DB → extend `PHANTOM_CATEGORY_NAMES` → backup → `--write` → verify "otro"

## Phase 8: Integration + goldens

- [ ] 8.1 RED `telegram.service.integration.test.ts`: preview→REAL/PENDING rows; gate→🗑 gone / Cancelar stays; retry once; dialog unknown no row
- [ ] 8.2 `vitest run -u` regen `__goldens__`; review diff accept intended; full suite green + build + typecheck