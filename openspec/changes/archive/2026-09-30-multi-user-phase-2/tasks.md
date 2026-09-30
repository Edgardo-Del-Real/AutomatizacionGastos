# Tasks: Multi-User Phase 2 — Household Sharing (Edgardo + Rita)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,000–2,400 authored (additions + deletions; goldens excluded from risk count) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 contracts+household → PR 2 migration+predicate+routes+bot → PR 3 dashboard |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |
| Session review budget | 5,000 lines (fits all slices); 400-line guard still reported for ask-on-risk |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Chain strategy rationale: repo convention — features branch from `dev` and merge to `dev`; `main` is releases only. Tracker `feat/multi-user-phase-2` from `dev`; PR 1 base = tracker, PR 2 base = PR 1 branch, PR 3 base = PR 2 branch; only the tracker merges to `dev`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Contracts + household identity (config/service/route/env/app wiring) | PR 1 (base: tracker) | `pnpm --filter @rita/contracts test` && `pnpm --filter @rita/api test household` | `HOUSEHOLD_MEMBERS="rita:Rita:111;edgardo:Edgardo:222" pnpm --filter @rita/api dev`; `GET /household/members` returns 2 members, no chatIds | Revert household + contracts commits; env unset → single-user, today's behavior |
| 2 | Migration + viewer predicate + routes + bot multi-chat | PR 2 (base: PR 1 branch) | `pnpm --filter @rita/api test movements telegram` | `docker compose up -d --wait` (PG :5433); 2-chat `HouseholdService` integration on `automatizacionrita_test` | Revert migration (`DROP COLUMN`/`DROP TYPE`) + predicate/bot commits → owner-scoped reads, single-chat bot |
| 3 | Dashboard viewer (context/api/hooks/components) | PR 3 (base: PR 2 branch) | `pnpm --filter @rita/dashboard test` | `pnpm --filter @rita/dashboard dev` vs API: switch viewer, badge + visibility filter re-query list & summary | Revert dashboard commits → `VITE_OWNER_ID` fallback restores fixed owner |

## Phase 1 — Slice 1: Contracts + Household Identity (PR 1)

- [x] 1.1 RED `packages/contracts/src/index.test.ts`: `movementVisibilitySchema` accepts INDIVIDUAL/SHARED, rejects `foo`; `visibilityFilterSchema` accepts mine/shared/all, rejects `foo`; `movementSchema` carries `visibility`+`registrantId`; household schemas; `expenseSchema` shape unchanged → GREEN `packages/contracts/src/index.ts`: add `movementVisibilitySchema`, `visibilityFilterSchema`, `householdMember(s)Schema`; extend `movementSchema` (+`visibility`, +`registrantId`), `movementFiltersSchema` (+`visibility?`); run `pnpm --filter @rita/contracts build` → commit `feat(contracts): add visibility, registrantId and household schemas`
- [x] 1.2 RED `household.config.test.ts`: 2-member parse; malformed chatId / dup ownerId / dup chatId / 3rd member fail fast (threat: malformed env); unset → `default` → GREEN create `apps/api/src/features/household/household.config.ts` (zod `householdMembersEnvSchema`, `HouseholdMember`, `parseHouseholdMembers`) → `feat(api): household members env config with fail-fast validation`
- [x] 1.3 RED `household.service.test.ts`: resolve known/unknown chatId; `partnerOf`; no partner in degraded mode → GREEN create `household.service.ts` (`resolveOwnerByChatId`, `partnerOf`, `getMembers` without chatIds) → `feat(api): household service for chat resolution and partner lookup`
- [x] 1.4 RED extend `apps/api/src/config/env.test.ts`: `TELEGRAM_OWNER_CHAT_ID` required iff `HOUSEHOLD_MEMBERS` unset; malformed members fail startup → GREEN `env.ts`: optional `HOUSEHOLD_MEMBERS` + superRefine conditional requirement → `feat(api): wire household members into env validation`
- [x] 1.5 RED create `household.route.test.ts`: members returned without chatIds; single-user → `[{ownerId:"default"}]` → GREEN create `household.route.ts` (`GET /household/members`), build + inject `HouseholdService` in `app.ts` → `feat(api): add household members endpoint`

## Phase 2 — Slice 2: Migration + Viewer-Scoped Reads (PR 2)

- [x] 2.1 RED `movements.repository.visibility.integration.test.ts` (part A): create without visibility → `INDIVIDUAL`; pre-existing rows backfilled `INDIVIDUAL` post-migrate → GREEN `apps/api/prisma/schema.prisma` (enum `MovementVisibility`, `@default(INDIVIDUAL)`) + migration `20260921130000_movement_visibility` (`CREATE TYPE` + `ADD COLUMN ... NOT NULL DEFAULT 'INDIVIDUAL'`) → `feat(api): movement visibility enum and backfill migration`
- [x] 2.2 RED leak-guard integration (part B): seed rita/edgardo × INDIVIDUAL/SHARED; each viewer × mine/shared/all exact sets; neither sees other's INDIVIDUAL, both see SHARED (threat: cross-owner leak); partner-null reduction; every summary feed (kpis/mom/daily/categories/top) scoped → GREEN `movements.types.ts` (+`ViewerScope`); `movements.repository.ts`: private `viewerPredicate(scope)` composed via conditions[]+`Prisma.join` in all 6 raw SELECTs, refactor `summaryMonths`/`summaryDaily` to same pattern, `mapMovementRow` += visibility/registrantId → `feat(api): scope all movement reads through central viewer predicate`
- [x] 2.3 RED `movements.service.test.ts`: `listMovements(scope, filters)` / `getSummary(scope, from, to)` visibility semantics; default `all` → GREEN `movements.service.ts` signatures take `scope` → `feat(api): thread viewer scope through movement service`
- [x] 2.4 RED `expenses.service.test.ts`: `createExpense(input, ownerId, {visibility})` persists visibility, default INDIVIDUAL; `expenses.route.test.ts` stays green UNTOUCHED (frozen `/expenses*`) → GREEN `expenses.service.ts`/`expenses.repository.ts` out-of-band visibility option (AD7) → `feat(api): out-of-band visibility on expense creation`

## Phase 3 — Slice 2 (cont.): Routes + Bot Multi-Chat (PR 2)

- [x] 3.1 RED `movements.route.test.ts`: `visibility=foo` → 422; `visibility=mine`/`shared` filter; default `all`; summary scoped → GREEN `movements.route.ts`: parse `visibility` → `ViewerScope` via `household.partnerOf`, inject household in `app.ts` → `feat(api): visibility filter on movement list and summary routes`
- [x] 3.2 RED `telegram.parser.test.ts`: `parseSharedPrefix` case-insensitive `/^compartido\s*:\s*/i`, strips + trims, no prefix → false → GREEN `telegram.parser.ts` export `parseSharedPrefix(text): { text, shared }` → `feat(api): parse compartido: prefix at arrival`
- [x] 3.3 RED `bot-brain.test.ts`: envelope carries `shared:true`; absent → false; `shared:"yes"` → null degrade (threat: malformed signal) → GREEN `bot-brain.ts`: `conversationEnvelopeSchema` += `shared` default false; prompt key list += `"shared": boolean` + 1 few-shot; `ConversationEnvelope` += `shared?` → `feat(api): shared flag in brain envelope and prompt`
- [x] 3.4 RED new `telegram.service.household.integration.test.ts`: per-chat attribution both directions; unknown chat silent + NOT recorded + log line contains no chatId (threat: chatId secrecy); same messageId in two chats both processed; `compartido: $2000 super` → SHARED under sender with stripped note; dedup after gate; prefix wins over `shared:false` → GREEN `telegram.service.ts`: `deps.household` replaces ownerChatId/ownerId; order resolve → gate → `recordProcessed(ownerId)` → dedup → prefix → states/registration threading ownerId + shared; `amountConfirmationPayloadSchema` += `shared`; visibility = prefix || envelope.shared; unknown-chat log without chatId → `feat(api): attribute bot per household chat and honor shared flag`

## Phase 4 — Slice 3: Dashboard (PR 3)

- [x] 4.1 RED `useHousehold.test.tsx`: fetch members; error/single-member → fallback `VITE_OWNER_ID`/`default` → GREEN create `features/household/useHousehold.ts` → `feat(dashboard): household members hook`
- [x] 4.2 RED `ViewerContext.test.tsx`: exposes viewerId/members/setViewerId; persists `rita.viewer` validated against members; invalid → fallback → GREEN create `ViewerContext.tsx` (`ViewerProvider`, `useViewer`) + `ViewerSelector.tsx` (a11y select ownerId+name, hidden when single-member, RED `ViewerSelector.test.tsx`) → `feat(dashboard): viewer context and selector with persisted selection`
- [x] 4.3 RED `api.test.ts`: `fetchHouseholdMembers()`; `visibility` param on `fetchMovements`/`fetchMovementSummary` → GREEN `apps/dashboard/src/infra/api.ts` → `feat(dashboard): household and visibility API calls`
- [x] 4.4 RED `useMovementSummary.test.tsx`/`useMovements.test.tsx`: visibility param re-queries list AND summary → GREEN `useMovementSummary.ts`/`useMovements.ts` accept visibility → `feat(dashboard): thread visibility into movement hooks`
- [x] 4.5 RED `MovementList.test.tsx`: SHARED badge `Compartido · {registrantName}`; no badge on INDIVIDUAL; partner rows (`registrantId !== viewerId`) read-only, no edit/delete → GREEN `MovementList.tsx`: `useViewer()` replaces OWNER_ID, badge via members map, actions only when registrant → `feat(dashboard): shared badge and read-only partner rows`
- [x] 4.6 RED `MovementFilters.test.tsx`: visibility select combines with type/date/q; reset → `all` → GREEN `MovementFilters.tsx` visibility select (Todos/Míos/Compartidos) → `feat(dashboard): visibility filter`
- [x] 4.7 RED `App.test.tsx`: viewer switch re-queries list AND summary; visibility state (default `all`) hoisted drives both; `useMovementMutations`/`MovementEditForm`/`CategoryCards` use `useViewer().viewerId` → GREEN `App.tsx`: `ViewerProvider` + hoisted visibility feeding summary + list, remaining OWNER_ID imports replaced → `feat(dashboard): hoist viewer and visibility state in App`

## Phase 5 — Goldens, Full Suite, Cleanup

- [x] 5.1 Regenerate brain goldens `__goldens__/interpret-system-prompt.txt` + `interpret-few-shots.json` via `vitest -u`; review diff as a work unit → `test(api): regenerate brain goldens for shared flag`
- [x] 5.2 Full suite green: `pnpm --filter @rita/api test`, `pnpm --filter @rita/dashboard test`, `pnpm typecheck`, `pnpm lint`; `/expenses*` tests green and untouched; verify rollback story (unset `HOUSEHOLD_MEMBERS` → single-user)
- [x] 5.3 `apps/dashboard/src/infra/env.ts` doc-only: `OWNER_ID` becomes fallback constant comment → `docs(dashboard): mark OWNER_ID as fallback constant`