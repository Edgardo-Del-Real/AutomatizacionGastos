# Design: Multi-User Phase 2 — Household Sharing (Edgardo + Rita)

## Technical Approach

Add a `visibility` flag on `Expense`, an env-configured household registry, and ONE central SQL predicate applied to every movement read. Four vertical slices following the repo's feature-slice pattern: (1) `features/household/` identity, (2) Prisma enum + backfill migration, (3) viewer-scoped reads via `ViewerScope` → `viewerPredicate` in all 6 raw SELECTs of `movements.repository.ts`, (4) bot multi-chat attribution with `compartido:` prefix + brain `shared` flag. Dashboard swaps `VITE_OWNER_ID` for a viewer context. `/expenses*` endpoints frozen (zero code change on their paths).

## Architecture Decisions

| # | Decision | Alternatives | Rationale |
|---|---|---|---|
| AD1 | `HOUSEHOLD_MEMBERS="ownerId:Name:chatId;ownerId:Name:chatId"` (1–2 entries, zod-validated at startup; unset/blank → single-user `default`) | JSON env var; User table | Proposal's own format; .env-friendly; chatIds are already env secrets; fixed duo needs no table |
| AD2 | Prisma enum `MovementVisibility { INDIVIDUAL, SHARED }`, `@default(INDIVIDUAL)`; backfill via `ADD COLUMN ... NOT NULL DEFAULT` | join-table grants; boolean column | One flag covers "partner also sees it"; per-person grants only pay off for N>2 (out of scope) |
| AD3 | Single private `viewerPredicate(scope): Prisma.Sql` in `movements.repository.ts`; all 6 raw SELECTs compose it through the existing `conditions[] + Prisma.join` pattern; `summaryMonths`/`summaryDaily` refactored from inline WHERE to that same pattern | per-query handwritten WHERE; query builder | One fragment = one leak-guard surface; Prisma flattens nested `Prisma.Sql` fragments so positional parameter order stays safe |
| AD4 | Mutations unchanged: `where: { id, ownerId }` is already registrant-only (`ownerId` IS the registrant) | new `registrantId` column | No schema duplication; partner PATCH/DELETE on a SHARED row matches no row → 404 (spec) |
| AD5 | `movementSchema` += `visibility` + `registrantId` (derived alias of `ownerId`; both kept) | rename `ownerId` | Additive contract; dashboard read-only check uses `registrantId`; no consumer breaks |
| AD6 | Prefix parsed ONCE at arrival: `parseSharedPrefix` in `telegram.parser.ts`; stripped text flows to brain + parser; visibility = `prefixShared OR envelope.shared` | parse inside registration; brain-only signal | Deterministic, works brain-less (spec); prefix wins by construction; dialog payloads persist the bit |
| AD7 | Create-visibility passed out-of-band: `ExpenseService.createExpense(input, ownerId, options?: { visibility })` | add `visibility` to `createMovementSchema` | `POST /expenses` shares that schema; accepting the field there would let the frozen endpoint persist visibility (drift) |
| AD8 | Dashboard: `ViewerContext` + `useViewer()`; visibility filter state hoisted to `App` (drives list AND summary); chart components untouched | prop drilling; client-side chart filtering | Cross-cutting identity removes 5 hardcoded `OWNER_ID` imports; server-side filtering keeps pie/KPIs/top consistent for free |
| AD9 | `ownerId` threaded explicitly through `TelegramService` private methods; `deps.ownerChatId`/`deps.ownerId` replaced by `deps.household: HouseholdService` | per-update bound controller instance | Matches the repo's explicit-DI style; `BotState` is already keyed by `ownerId`, so per-owner dialogs isolate for free |

## Data Model Changes

```prisma
enum MovementVisibility { INDIVIDUAL  SHARED }
// Expense model: visibility MovementVisibility @default(INDIVIDUAL)
```

Migration `apps/api/prisma/migrations/20260921130000_movement_visibility/migration.sql`:

```sql
CREATE TYPE "MovementVisibility" AS ENUM ('INDIVIDUAL', 'SHARED');
ALTER TABLE "Expense" ADD COLUMN "visibility" "MovementVisibility" NOT NULL DEFAULT 'INDIVIDUAL';
```

Postgres backfills existing rows atomically via `DEFAULT` (spec: backfill → `INDIVIDUAL`). Indexes: keep `@@index([ownerId, occurredAt])` / `@@index([ownerId])` — the predicate is ownerId-leading; no new index (2-member household, no selectivity gain).

## Data Flow / Sequence (bot update)

```
Telegram update
  → normalizeTelegramMessage
  → household.resolveOwnerByChatId(fromId)      null → log (NO chatId) → return: no record, no reply
  → recordProcessed(chatId, messageId, ownerId)  unique-violation → skip
  → parseSharedPrefix(text) → { strippedText, sharedByPrefix }
  → commands / dialogs(ownerId) / registration(ownerId, strippedText)
       registration: brain.interpret(strippedText) → envelope.shared
       visibility = sharedByPrefix || envelope.shared === true
  → expenseService.createExpense(payload, ownerId, { visibility })
  → Expense row { ownerId = registrant, visibility }
```

```
Dashboard → GET /household/members → ViewerContext(viewerId)
          → GET /movements?ownerId&visibility ─┐
          → GET /movements/summary?ownerId&visibility ─→ route builds ViewerScope
             (partnerId = household.partnerOf(ownerId)) → viewerPredicate → list + 6 summary feeds
```

## File Changes

| File | Action | Responsibility |
|---|---|---|
| `apps/api/src/features/household/household.config.ts` | Create | `HOUSEHOLD_MEMBERS` parse + zod (`householdMembersEnvSchema`), `HouseholdMember` type, fail-fast rules (dup ownerId/chatId, >2 entries, non-int chatId), degraded-mode fallback |
| `apps/api/src/features/household/household.service.ts` | Create | `HouseholdService`: `resolveOwnerByChatId(chatId)`, `partnerOf(ownerId)`, `getMembers()` (no chatIds) |
| `apps/api/src/features/household/household.route.ts` | Create | `GET /household/members` → `householdMembersSchema` |
| `apps/api/prisma/schema.prisma` | Modify | enum + `visibility` field |
| `apps/api/prisma/migrations/20260921130000_movement_visibility/` | Create | migration SQL above |
| `apps/api/src/config/env.ts` | Modify | `HOUSEHOLD_MEMBERS` optional; `TELEGRAM_OWNER_CHAT_ID` conditionally required (superRefine: required iff household unset) |
| `apps/api/src/app.ts` | Modify | build `HouseholdService`, inject into `telegramService` deps, `movementsRoute`, new `householdRoute` |
| `apps/api/src/features/movements/movements.types.ts` | Modify | add `ViewerScope` |
| `apps/api/src/features/movements/movements.repository.ts` | Modify | `viewerPredicate(scope)`; 6 read methods take `scope`; months/daily refactored to conditions-array pattern; `mapMovementRow` += `visibility`, `registrantId` |
| `apps/api/src/features/movements/movements.service.ts` | Modify | `listMovements(scope, filters)`, `getSummary(scope, from, to)` |
| `apps/api/src/features/movements/movements.route.ts` | Modify | `visibility` query param (list + summary) → `ViewerScope` via `household.partnerOf` |
| `apps/api/src/features/telegram/telegram.parser.ts` | Modify | export `parseSharedPrefix(text): { text; shared }` (`/^compartido\s*:\s*/i`, strip + trim) |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | gate/dedup reorder (resolve → gate → record); `deps.household`; thread `ownerId` + `shared` through registration chain; `createMovement(..., visibility)`; `amountConfirmationPayloadSchema` += `shared`; unknown-chat log without chatId |
| `apps/api/src/features/telegram/bot-brain.ts` | Modify | `conversationEnvelopeSchema` += `shared: z.boolean().default(false)`; `ConversationEnvelope` += `shared?`; prompt key list += `"shared": boolean` + one rule line; +1 few-shot |
| `apps/api/src/features/expenses/expenses.service.ts` / `expenses.repository.ts` | Modify | `createExpense(input, ownerId, options?: { visibility })`; `create` writes `visibility ?? "INDIVIDUAL"` (out-of-band, AD7) |
| `packages/contracts/src/index.ts` | Modify | `movementVisibilitySchema`, `visibilityFilterSchema` (`mine|shared|all`), `movementSchema` += `visibility`/`registrantId`, `movementFiltersSchema` += `visibility?`, `householdMember(s)Schema`; `expenseSchema` family unchanged |
| `apps/dashboard/src/features/household/ViewerContext.tsx` | Create | `ViewerProvider` + `useViewer(): { viewerId, members, setViewerId, selectorVisible }`; localStorage `rita.viewer`, validated against members; fallback `VITE_OWNER_ID`/`"default"` |
| `apps/dashboard/src/features/household/useHousehold.ts` | Create | fetch members, async state |
| `apps/dashboard/src/features/household/ViewerSelector.tsx` | Create | a11y select (ownerId + name) |
| `apps/dashboard/src/infra/api.ts` | Modify | `fetchHouseholdMembers()` (`/api/household/members` via existing `/api` proxy); `visibility` param on `fetchMovements`/`fetchMovementSummary` |
| `apps/dashboard/src/App.tsx` | Modify | `ViewerProvider`; visibility state (default `all`) hoisted here; feeds `useMovementSummary(viewerId, visibility, refreshKey)` and `MovementList` |
| `apps/dashboard/src/features/movements/MovementList.tsx` | Modify | `useViewer()` replaces `OWNER_ID`; SHARED badge `Compartido · {registrantName}` (members map); actions only when `registrantId === viewerId` |
| `apps/dashboard/src/features/movements/MovementFilters.tsx` | Modify | visibility select (Todos/Míos/Compartidos) combined with existing filters; reset → `all` |
| `apps/dashboard/src/features/movements/useMovementSummary.ts` | Modify | accepts `visibility` |
| `apps/dashboard/src/features/movements/{useMovementMutations,MovementEditForm,CategoryCards}.ts(x)` | Modify | `useViewer().viewerId` replaces `OWNER_ID` |
| `apps/dashboard/src/infra/env.ts` | Modify | doc-only: `OWNER_ID` becomes fallback constant |

## Interfaces / Contracts

```ts
// household.config.ts
type HouseholdMember = { ownerId: string; name: string; chatId: number };
parseHouseholdMembers(raw: string | undefined, fallback: { ownerId: string; chatId: number }): HouseholdMember[];
// household.service.ts
class HouseholdService {
  resolveOwnerByChatId(chatId: number): string | null;
  partnerOf(ownerId: string): string | null;          // null in single-user mode
  getMembers(): Array<{ ownerId: string; name: string }>; // chatIds never leave
}
// movements.types.ts
type ViewerScope = { viewerId: string; partnerId: string | null; visibility: "mine" | "shared" | "all" };
```

Central predicate (exact fragment; injected as `conditions[0]` of every raw SELECT):

```ts
own        = Prisma.sql`"ownerId" = ${scope.viewerId}`;
partnerSH  = scope.partnerId === null
  ? Prisma.sql`FALSE`
  : Prisma.sql`("visibility" = 'SHARED'::"MovementVisibility" AND "ownerId" = ${scope.partnerId})`;
// mine   → own
// shared → Prisma.sql`"visibility" = 'SHARED'::"MovementVisibility" AND (${own} OR ${partnerSH})`
// all    → Prisma.sql`(${own} OR ${partnerSH})`   // partner null ⇒ reduces to own
```

## API Changes

- `GET /household/members` — new; returns `{ownerId, name}[]`, no chatIds; single-user → `[{ ownerId: "default", ... }]`.
- `GET /movements`, `GET /movements/summary` — accept `visibility` (`mine|shared|all`, default `all`; invalid → `422 ValidationFailedError`, same convention as existing filter validation).
- `PATCH`/`DELETE /movements/:id` — unchanged (AD4 already yields registrant-only 404s).
- `/expenses*` — frozen; `expenses.route.test.ts` stays green untouched.

## Bot Changes

Covered in Data Flow + File Changes. Key ordering: resolve → gate → `recordProcessed` (resolved ownerId) → dedup → prefix → states/registration. `compartido:` prefix is authoritative; brain `shared` flag is an additional signal; dialog-created registrations (amount confirmation) read the `shared` bit persisted in `amountConfirmationPayloadSchema`. Brain goldens `__goldens__/interpret-system-prompt.txt` + `interpret-few-shots.json` regenerate via `vitest -u` in-cycle; reply-prompt goldens untouched.

## Dashboard Changes

Covered in File Changes. Charts (`KpiCards`, `CategoryPieChart`, `BalanceTrendChart`, `TopMovements`) need NO changes — the summary response is already filtered server-side, so the pie/trend/KPIs reflect the filter by construction. Read-only partner rows are enforced twice: UI hides Editar/Eliminar when `registrantId !== viewerId`; server returns 404 regardless (defense in depth).

## Testing Strategy (strict TDD — RED first per layer)

| Layer | File(s) | Key cases |
|---|---|---|
| Contracts | `apps/api/src/contracts/movement-visibility-schemas.test.ts` (+ household schemas) | enums accept valid/reject invalid; `movementSchema` carries `visibility`+`registrantId`; filter `foo` rejected; `expenseSchema` unchanged |
| Household unit | `features/household/household.config.test.ts`, `household.service.test.ts` | 2-member parse; malformed chatId / dup ids / 3rd member fail fast; unset → default member; resolve known/unknown; `partnerOf`; no partner in degraded mode |
| Migration + predicate | `features/movements/movements.repository.visibility.integration.test.ts` | seed rita-INDIVIDUAL, rita-SHARED, edgardo-INDIVIDUAL, edgardo-SHARED; **bidirectional leak guard**: each viewer × `mine/shared/all` exact sets, neither sees the other's INDIVIDUAL, both see SHARED; every summary feed (kpis/months/daily/categories/top) scoped; partner-null reduction; default INDIVIDUAL on create |
| Routes | extend `movements.route.test.ts`; new `household.route.test.ts`; `expenses.route.test.ts` UNTOUCHED | `visibility=foo` → 422; members without chatIds; single-user member; frozen endpoints green |
| Bot unit | extend `telegram.parser.test.ts`, `telegram.service.test.ts`, `bot-brain.test.ts` | prefix case-insensitive + stripped note; unknown chat NOT recorded + log line contains no chatId; dedup after gate; prefix wins over `shared:false`; brain flag alone → SHARED; `shared:"yes"` → null degrade; goldens updated |
| Bot integration | new `telegram.service.household.integration.test.ts` (2-member `HouseholdService`, real test DB) | per-chat attribution both directions; unknown chat silent; same `messageId` in two chats both processed; `compartido: $2000 super` → SHARED under sender with note `super` |
| Dashboard | `ViewerContext.test.tsx`, `useHousehold.test.tsx`, `ViewerSelector.test.tsx`, extend `App.test.tsx`, `MovementList.test.tsx`, `MovementFilters.test.tsx`, `useMovementSummary.test.tsx`, `api.test.ts` | selector lists both members + persists selection; switching re-queries list AND summary; single-member/error → no selector, `VITE_OWNER_ID` fallback; SHARED badge + partner rows read-only; visibility combines with type/date/q filters; reset restores `all` |

Implementation order: contracts → household config/service → migration + predicate (leak guard first) → routes → bot (parser → brain → service reorder) → dashboard (context → api → hooks → components) → goldens → full suite.

## Threat Matrix

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | no executable/document classification in this change |
| Git repository selection | N/A | no VCS operations |
| Commit state | N/A | no commit automation |
| Push state | N/A | no push automation |
| PR commands | N/A | no PR automation |

Genuine adversarial boundaries in this change (design response + RED tests): (1) cross-owner data leak via raw SQL → single `viewerPredicate` + bidirectional two-owner integration guard; (2) chatId secrecy → the unknown-chat gate log must never contain chatId digits (pinned by a unit test); (3) malformed `HOUSEHOLD_MEMBERS` → fail-fast startup validation.

## Migration / Rollout

Additive migration. Unset `HOUSEHOLD_MEMBERS` → single-user mode, behavior identical to today. Rollback (proposal): revert code, `ALTER TABLE "Expense" DROP COLUMN "visibility"; DROP TYPE "MovementVisibility";`, dashboard falls back to `VITE_OWNER_ID`.

## Risks and Mitigations

| Risk | L | Mitigation |
|---|---|---|
| Cross-owner leak via raw query | Med | AD3 single predicate + bidirectional leak-guard tests |
| Golden prompt tests break | High | regenerate in-cycle (`vitest -u`), review diff as a work unit |
| Gate/dedup reorder regression | Med | new two-chat integration tests pin resolve→gate→record order |
| ownerId threading churn in `telegram.service.ts` (1.3k lines) | Med | mechanical, typecheck-enforced; existing tests keep semantics (degraded mode = same behavior) |
| `movementSchema` new required fields break dashboard validation | Low | monorepo deploys together; contracts built first (repo convention) |

## Ready for Tasks

Scope closed, no blocking questions. Non-blocking (task-level): exact badge copy styling; whether the visibility select also renders a compact control in the header (design: filters bar only). Forecast for sdd-tasks: authored additions likely exceed the 400-line review budget → chained PRs recommended (contracts+household / api predicate+bot / dashboard slices).
