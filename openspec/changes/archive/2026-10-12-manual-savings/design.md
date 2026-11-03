# Design: Manual Savings Registration

Status: design (sdd-design) · Change: `manual-savings` · Date: 2026-10-12
Inputs: `proposal.md` (Option A locked), 5 spec deltas. All file:line anchors re-verified against the working tree.

## Technical Approach

Option A discriminator: a nullable `savingsOrigin` enum column on `Expense` (`AUTO_SPLIT | MANUAL`, NULL = legacy/inert), one plain-SQL migration (no backfill, `sharedTotal` precedent). A new period-scoped repository aggregate `summaryManualSavings` filters `savingsOrigin = 'MANUAL'`; the service composes `balance = income − expenses − manualSavings` and exposes `kpis.manualSavings` (required, additive). Creation is guarded at two layers: the shared contract refine rejects `AUTO_SPLIT` (and any origin on non-SAVINGS creates); `ExpenseService.createExpense` enforces the "ahorro" category on SAVINGS creates and stamps MANUAL. The bot gains two deterministic entries: `sa:manual` (4th sub-menu action → `AWAITING_MANUAL_SAVINGS` state → `captureParse`) and the text command `registrar ahorro manual: <monto> [nota]` (matched before `SAVINGS_RULE_RE`, disjoint by construction).

## Architecture Decisions

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|---|
| D1 | Origin storage | `enum MovementSavingsOrigin` + nullable `savingsOrigin` on `Expense`, no index | Separate table; inferring origin from category | Locked by proposal; nullable-additive precedent is `sharedTotal` (schema.prisma:46-48); existing `@@index([ownerId, occurredAt])` serves the MANUAL subset |
| D2 | MANUAL aggregate | New `summaryManualSavings(scope, period)` mirroring `summarySavings` (movements.repository.ts:351-365) + origin filter | Flag param on `summarySavings`; folding the sum into `summaryKpis` SQL | `summarySavings` is month-pinned (D3), the deduction is period-scoped — a separate method plus D3-style comments at both call sites is the guard against conflation (proposal risk #2). `summaryKpis` composes `SAVINGS_EXCLUDED` (D1 one-exclusion-surface) — a MANUAL CASE sum there would break that discipline |
| D3 | manualSavings acquisition | 10th `Promise.all` entry with the REQUESTED `period` (movements.service.ts:76-92) | Compute inside `summaryKpis` | Keeps each repository query single-purpose; the requested period ≠ `thisMonthPeriod` used by `summarySavings` — both call sites carry a comment stating which scope they use |
| D4 | Contract shape | `kpis.manualSavings: z.number()` REQUIRED; `movementSchema.savingsOrigin` optional-nullable | Optional `manualSavings` | Repo precedent `countThisMonth`/`planned` (contracts index.ts:165, 199-205); monorepo lockstep; exposes `balance` as a consumer-verifiable invariant. Optional would hide the invariant and force a second contract change |
| D5 | Creation guard layering | Contract refine rejects bad origins; service branch enforces category + stamps MANUAL | Guard only in the route; guard only in the contract | The contract is shared by API and any future caller; the category check needs owner state (`ensureAhorro`) so it lives in `ExpenseService` |
| D6 | `ExpenseService` category access | Inject `CategoryService` as a required 2nd constructor param (mirror `MovementService`, movements.service.ts:12-16) | Route-level guard; optional dependency | The SAVINGS-create guard needs `ensureAhorro`; MovementService already sets the two-dep precedent. 5 construction sites update (app.ts:33 — requires moving category wiring above it —, cleanup-phantom-data.ts:94, expenses.service.test.ts:45, two telegram integration tests pass stubs). Optional deps hide wiring bugs |
| D7 | `ensureAhorro` ownership | Inside `ExpenseService` creation paths (SAVINGS branch of `createExpense` AND `createManualSavings`) | Caller-owned (registerIncomeSplit mirror, telegram.service.ts:1871) | One owner of the invariant "a SAVINGS row always lands in an existing ahorro category"; both entry points (API + bot) get it for free; idempotent upsert makes the bot's pre-call unnecessary — deviation from the proposal's mirror sketch, documented here |
| D8 | Origin refine totality | `savingsOrigin` present ⇒ `type === "SAVINGS" ∧ savingsOrigin === "MANUAL"`; absent ⇒ server stamps MANUAL on SAVINGS creates | Allow MANUAL on non-SAVINGS creates | Spec mandates AUTO_SPLIT failure and absent-or-MANUAL on SAVINGS; a discriminator on a non-SAVINGS row is meaningless — rejecting it is the minimal total rule that satisfies the mandate |
| D9 | Command recognition | Prefix regex + `parseManualSavingsPayload` first-token validation | Structured capture regex (`(-?\d+…)?(?:\s+(.+?))?`) | A structured regex fails to match `registrar ahorro manual: abc` (amount group can't match, note group needs leading whitespace) → the text would fall through to free-text routing, violating the "recognized invalid command" scenario. The prefix regex matches whenever `registrar ahorro manual:` is present; the payload parser decides valid/invalid |
| D10 | Sub-menu amount guard | `handleAwaitingManualSavings` re-prompts when `captureParse` yields `amount <= 0` | Rely on `captureParse` positivity | Verified: `parseNumberToken` accepts `0` (message.parser.ts:56-60 matches `^\d+$` → returns 0, not null), so `captureParse("0")` = `{amount: 0}` — the ≤0 re-prompt must be explicit |

## Data Flow

    Expense rows ──┬─ summaryKpis(period) ──────────── income, expenses (SAVINGS_EXCLUDED, D1)
                   ├─ summarySavings(thisMonth) ────── kpis.savings (ALL SAVINGS, current BA month, D3)
                   ├─ summaryManualSavings(period) ── kpis.manualSavings (MANUAL only, REQUESTED period)   [NEW]
                   └─ summaryMonths/Daily/Categories ─ unchanged (manual savings never in trend buckets)
    Service: balance = income − expenses − manualSavings;  avgPerMonth = balance / monthsWithData (follows)
    mom.months[].balance keeps income − expenses (documented limitation, proposal Out of Scope)

## Bot Sequence — Path 1: `sa:manual` sub-menu action

    Owner                     TelegramService                BotStateRepo        ExpenseService
      │ tap "Ahorro manual"        │                              │                   │
      │ callback sa:manual ───────→│ handleCallback → dispatchCallback("sa")           │
      │                            │ handleSavingsAdminCallback case "manual"          │
      │                            │ set awaiting_manual_savings, payload {} ─────────→│
      │ ← manualSavingsPromptReply │                              │                   │
      │ "500 fondo vacaciones" ───→│ handleUpdate: parseCommand → null (not a command)│
      │                            │ state switch → handleAwaitingManualSavings        │
      │                            │   captureParse → {amount:500, note:"fondo…"} ✓ >0 │
      │                            │ registerManualSavings                            │
      │                            │   createManualSavings({ownerId,500,note,now}) ───→│
      │                            │     → ensureAhorro → repo.create(SAVINGS·MANUAL·  │
      │                            │       "ahorro"·INDIVIDUAL·PAID·ARS)               │
      │ ← manualSavingsSavedReply  │                              │                   │
      │ ← sendMenu                 │                              │                   │

    Branches: captureParse null → re-prompt manualSavingsPromptReply, state KEPT (mirror :690-692).
              amount ≤ 0 → re-prompt, state KEPT (D10).
              corrupt payload/state → idle + questionDroppedReply (mirror :683-687).
              any recognized command arrives → globally intercepted (handleUpdate :382) → supersedes
              (closeSavingsInputState extended) → command executes (+ menu).

## Bot Sequence — Path 2: text command

    Owner "registrar ahorro manual: 500 fondo vacaciones"
      → handleUpdate → parseCommand:
          normalizeCommandSyntax ("/registrar_ahorro_manual" → "registrar ahorro manual", :68-70)
          MANUAL_SAVINGS_RE = /^\s*registrar\s+ahorro\s+manual\s*:\s*(.*?)\s*$/   ← checked BEFORE SAVINGS_RULE_RE (:23)
          payload "500 fondo vacaciones" → parseManualSavingsPayload → {amount:500, note:"fondo vacaciones"}
             (note sliced from syntaxNormalized text, mirror sliceFromOriginal :134-137)
          → { type:"manual-savings", amount:500, note:"fondo vacaciones" }
      → handleCommand case "manual-savings":
          closeSavingsInputState(ownerId)   // extended: also closes awaiting_manual_savings
          registerManualSavings(500, "fondo vacaciones") → createManualSavings → MANUAL row
          manualSavingsSavedReply(500, note) + sendMenu

    Invalid: "registrar ahorro manual: 0 | abc | (empty)" → prefix matches, parseManualSavingsPayload
      returns null → { type:"manual-savings-invalid" } → closeSavingsInputState →
      manualSavingsInvalidReply (+ sendMenu iff a state was closed, mirror :2575-2582). Nothing stored.
    Disjointness: MANUAL requires "manual" BETWEEN "ahorro" and ":"; RULE requires ":" directly after
      "ahorro" (`registrar\s+ahorro\s*:`). "registrar ahorro: manual al 10%" → RULE, keyword "manual".

## File Changes

Slices support delivery_strategy=auto-chain (stacked 1→2→3; each slice green and dashboard-safe alone).

| File | Action | Slice | Description |
|---|---|---|---|
| `apps/api/prisma/schema.prisma` | Modify | 1 | `enum MovementSavingsOrigin { AUTO_SPLIT MANUAL }` + `savingsOrigin MovementSavingsOrigin?` on `Expense` (beside `sharedTotal`, with the same inert-NULL comment duty) |
| `apps/api/prisma/migrations/20261012HHMMSS_manual_savings_origin/migration.sql` | Create | 1 | Hand-written plain SQL (sketch below); naming follows the existing convention |
| `packages/contracts/src/index.ts` | Modify | 1+2 | Slice 1: `movementSavingsOriginSchema` export; `movementSchema.savingsOrigin` optional-nullable; `createMovementSchema.savingsOrigin` + refine (D8). Slice 2: `movementSummarySchema.kpis.manualSavings: z.number()` REQUIRED — ships with the API emitting it (dashboard lockstep) |
| `apps/api/src/features/expenses/expenses.types.ts` | Modify | 1 | `NewExpense` gains `savingsOrigin?: MovementSavingsOrigin` (mirror `sharedTotal` ride-along, :5-11) |
| `apps/api/src/features/expenses/expenses.repository.ts` | Modify | 1 | `create` persists `savingsOrigin` via conditional spread (mirror :94); `createIncomeWithSavings` SAVINGS create stamps `savingsOrigin: "AUTO_SPLIT"` (:180-194); INCOME row stays origin-less |
| `apps/api/src/features/movements/movements.repository.ts` | Modify | 2 | `summaryManualSavings` (SQL sketch below); `MovementRow` + `mapMovementRow` carry `savingsOrigin`; SELECT lists at `listByOwner` (:181) and `topByType` (:342) add the column (`findById`/`updateById`/`markPaidById` use `findFirst` + spread — typed via `MovementRow`, no SQL change) |
| `apps/api/src/features/movements/movements.service.ts` | Modify | 2 | `getSummary`: 10th `Promise.all` entry `summaryManualSavings(scope, period)` + D3 comments at BOTH savings call sites; `balance = kpis.income − kpis.expenses − manualSavings` (:94); `kpis.manualSavings` in the return (:123-133). `updateMovement` PATCH pin (below) |
| `apps/api/src/features/expenses/expenses.service.ts` | Modify | 2 | `CategoryService` injected (D6); SAVINGS-create guard branch; `createManualSavings` (signatures below) |
| `apps/api/src/app.ts` | Modify | 2 | Move category wiring above `new ExpenseService` (:32-36) and pass `categoryService` |
| `apps/api/src/scripts/cleanup-phantom-data.ts` | Modify | 2 | Build `CategoryService` for the new constructor signature |
| `apps/api/src/features/telegram/telegram.commands.ts` | Modify | 3 | `TelegramCommand` variants + `MANUAL_SAVINGS_RE` + `parseManualSavingsPayload`; manual check placed BEFORE `SAVINGS_RULE_RE` in `parseCommand` (:102) |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | 3 | `AWAITING_MANUAL_SAVINGS` constant (beside :142-148); `sa:manual` case + 4-action keyboard in `handleSavingsAdminCallback` (:1085-1097); `manualSavingsPayloadSchema = z.object({})` (mirror :239); state-switch case → `handleAwaitingManualSavings`; `handleCommand` cases `manual-savings` / `manual-savings-invalid`; `closeSavingsInputState` membership extended (:2621); `registerManualSavings` helper (mirror `registerIncomeSplit` :1863-1891, without the pre-`ensureAhorro` per D7) |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | 3 | `BOT_STATES` + `"awaiting_manual_savings"` (keeps `normalizeState` :2724 recovery honest) |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | 3 | `manualSavingsPromptReply`, `manualSavingsSavedReply(amount, note)` (formatARS + truncateNote), `manualSavingsInvalidReply` (es-AR); `ayudaReply` 💰 line + command list mention `registrar ahorro manual:` / `registrar_ahorro_manual` (:529-544) |
| `apps/api/src/features/telegram/telegram.bot.ts` | Modify | 3 | `BOT_COMMANDS` + `{ command: "registrar_ahorro_manual", description: … }` (after :43) |
| Dashboard | Unchanged | — | Read-only; renders additive KPIs and existing SAVINGS badges |

## Interfaces / Contracts

```prisma
// schema.prisma (beside MovementStatus)
enum MovementSavingsOrigin {
  AUTO_SPLIT
  MANUAL
}
// model Expense, after sharedTotal:
  // manual-savings: origin of a SAVINGS row; null (inert) on every legacy row.
  savingsOrigin MovementSavingsOrigin?
```

```sql
-- migrations/20261012HHMMSS_manual_savings_origin/migration.sql
-- manual-savings: origin discriminator on SAVINGS movements. Plain-SQL, no
-- backfill: legacy SAVINGS rows keep NULL and are inert (only 'MANUAL' is
-- ever deducted); AUTO_SPLIT rows are produced exclusively by
-- createIncomeWithSavings going forward (sharedTotal migration precedent).
CREATE TYPE "MovementSavingsOrigin" AS ENUM ('AUTO_SPLIT', 'MANUAL');
ALTER TABLE "Expense" ADD COLUMN "savingsOrigin" "MovementSavingsOrigin" NULL;
```

```ts
// movements.repository.ts — interface addition
/** manual-savings: REQUESTED-period MANUAL SAVINGS sum (ARS, viewer-scoped).
 *  Mirror of summarySavings + the origin filter; deducts nothing by itself. */
summaryManualSavings(scope: ViewerScope, period: SummaryPeriod): Promise<number>;
```

```sql
-- summaryManualSavings — EXACT shape of summarySavings + one predicate
SELECT COALESCE(SUM("amount"), 0) AS "manualSavings"
FROM "Expense"
WHERE ${viewerPredicate}                                  -- AD3 leak-guard
  AND "currency" = 'ARS'
  AND "type" = 'SAVINGS'::"MovementType"
  AND "savingsOrigin" = 'MANUAL'::"MovementSavingsOrigin" -- NULL/AUTO_SPLIT inert
  AND ...periodConditions(period)                         -- requested from/to, BA day bounds
```

```ts
// expenses.service.ts
constructor(repository: ExpenseRepository, categoryService: CategoryService)

// createExpense — SAVINGS branch (after createMovementSchema.safeParse, which
// already rejected AUTO_SPLIT and non-SAVINGS origins per D8):
if (parsed.data.type === "SAVINGS") {
  await this.categoryService.ensureAhorro(ownerId);
  if (parsed.data.category !== undefined && parsed.data.category !== "ahorro") {
    throw new ValidationFailedError("SAVINGS movements require the ahorro category", [...]);
  }
  return this.repository.create({
    ownerId, ...parsed.data, category: "ahorro",       // absent → defaulted, explicit ✓
    savingsOrigin: "MANUAL",                            // server stamp (input value ignored)
    status: "PAID", visibility: options?.visibility ?? "INDIVIDUAL",
  });
}

// bot-internal path — same semantics, pre-validated domain args:
createManualSavings(data: {
  ownerId: string; amount: number; note?: string | null; occurredAt: Date;
}): Promise<Expense>   // → ensureAhorro → repo.create(SAVINGS·MANUAL·"ahorro"·INDIVIDUAL·PAID·ARS)
```

```ts
// movements.service.ts — updateMovement PATCH pin (widens :34-40 to category !== undefined, null included)
if (parsed.data.category !== undefined) {
  const movement = await this.repository.findById(id, ownerId);
  if (movement === null) throw new NotFoundError(`Movement ${id} not found`);
  if (movement.type === "SAVINGS" && movement.savingsOrigin === "MANUAL"
      && parsed.data.category !== "ahorro") {
    throw new ValidationFailedError("Manual savings are pinned to the ahorro category", [...]);
  }
  if (parsed.data.category !== null) {
    await this.categoryService.assertOwnerCategory(ownerId, parsed.data.category, movement.type);
  }
}
// AUTO_SPLIT / legacy (NULL) rows: no pin — existing D9 freedom unchanged.
// DELETE /movements/:id: unchanged — deduction disappears with the row.
```

```ts
// packages/contracts/src/index.ts
export const movementSavingsOriginSchema = z.enum(["AUTO_SPLIT", "MANUAL"]);
export type MovementSavingsOrigin = z.infer<typeof movementSavingsOriginSchema>;
// movementSchema (after sharedTotal):
  savingsOrigin: movementSavingsOriginSchema.nullable().optional(),
// createMovementSchema: extend + refine (D8) —
  savingsOrigin: movementSavingsOriginSchema.optional(),
  .refine((d) => d.savingsOrigin === undefined
      || (d.type === "SAVINGS" && d.savingsOrigin === "MANUAL"),
    { message: "savingsOrigin is only valid as MANUAL on SAVINGS movements", path: ["savingsOrigin"] })
// movementSummarySchema.kpis (after savings):
  manualSavings: z.number(),
```

```ts
// telegram.commands.ts
| { type: "manual-savings"; amount: number; note: string | null }
| { type: "manual-savings-invalid" }
const MANUAL_SAVINGS_RE = /^\s*registrar\s+ahorro\s+manual\s*:\s*(.*?)\s*$/;
/** First payload token must be a positive es-AR amount (parseNumberToken rules:
 *  dotted/comma thousands or plain digits — decimals invalid, uniform with
 *  captureParse); remainder is the note (null when empty). Returns null for
 *  non-numeric / non-positive / empty payloads (recognized-invalid). */
export function parseManualSavingsPayload(payload: string): { amount: number; note: string | null } | null;
```

## Testing Strategy

Strict TDD, `pnpm --filter @rita/api test` (integration files run `prisma migrate deploy` against `<db>_test` in `beforeAll` — PostgreSQL 16 on localhost:5433 must be up first).

| File | Key cases (→ spec scenario) |
|---|---|
| `savings/savings.migration.integration.test.ts` (extend) | Static pins: migration dir `_manual_savings_origin` contains `CREATE TYPE "MovementSavingsOrigin"`, `ADD COLUMN "savingsOrigin" … NULL`, no UPDATE/DELETE on `"Expense"` (→ Migration preserves legacy rows); DB pins: enum values AUTO_SPLIT+MANUAL; raw insert without origin persists NULL |
| `movements/movements.savings.integration.test.ts` (extend; `SeedMovement` + `savingsOrigin?`) | 900/300/MANUAL-50 → balance 550, manualSavings 50 (→ Manual savings deduct); mixed month → 900/300/550, savings 150, manualSavings 50 (→ Mixed month); manualSavings period scope 50 vs prior-month 30 with from/to (→ deduct within the period); seeded NULL-origin rows → manualSavings 0 and existing :210-224 guard stays green byte-identical (→ history identical); delete manual → balance back to 600 (→ Deleting returns the money); `createIncomeWithSavings` row reads back AUTO_SPLIT (→ Auto-split stamps) |
| `movements/movements.service.test.ts` | Mock `summaryManualSavings`: called with the REQUESTED period (≠ thisMonthPeriod); `balance` formula; `kpis.manualSavings` present |
| `movements/movements.repository.visibility.integration.test.ts` | Partner INDIVIDUAL MANUAL excluded from `summaryManualSavings` + balance under the viewer predicate (→ follow the viewer predicate) |
| `movements/movements.patch-guard.integration.test.ts` | MANUAL: category "bolsillo" → 422 row unchanged; `null` → 422 (→ drift/null rejected); amount 80 → allowed, balance recomputes (→ amount edit allowed); AUTO_SPLIT + NULL-origin rows keep category freedom (→ AUTO_SPLIT freedom kept) |
| `expenses/expenses.route.test.ts` + new `expenses/expenses.manual-savings.integration.test.ts` | POST `{type:"SAVINGS", amount:50, note}` → 201, row MANUAL·ahorro·PAID·INDIVIDUAL (→ created via API; observability via GET /movements `savingsOrigin`); category "bolsillo" → 422 nothing stored; absent category → "ahorro"; `savingsOrigin:"AUTO_SPLIT"` → 422; `amount:0` → 422; origin on non-SAVINGS create → 422 (D8) |
| `telegram/telegram.commands.test.ts` | Amount-only; amount+note (spelling preserved); `0`/`abc`/empty → `manual-savings-invalid`; `/registrar_ahorro_manual` normalizes; `registrar ahorro: manual al 10%` → `savings-rule` keyword "manual" (disjointness, → Rule stays a rule); manual checked before rule (order pin) |
| `telegram/telegram.service.savings.test.ts` (extend) | `sa:menu` renders FOUR actions incl. `sa:manual` (9-byte payload ≤ 64, buildCallbackData enforced); `sa:manual` → state + prompt (→ starts capture); "500 fondo vacaciones" → `createManualSavings` called with {ownerId, 500, note, occurredAt} → saved reply + menu (→ valid capture); "abc" → re-prompt, state kept, nothing stored (→ unparseable re-prompts); "0" → re-prompt (D10); text command from idle → create + confirm + menu; invalid command → invalid reply, nothing stored; command during `AWAITING_MANUAL_SAVINGS` → supersedes (+ menu) |
| `telegram/reply-text.test.ts` | Three new replies: es-AR, prompt mentions monto + optional nota; saved mentions the amount; invalid states nothing was stored |
| `telegram/telegram.bot.test.ts` (extend :447 pin) | `registrar_ahorro_manual` present in `setMyCommands` list (→ savings commands registered) |
| `packages/contracts/src/index.test.ts` | `movementSchema` parses AUTO_SPLIT row + legacy row without the field (→ carried/omitted); `createMovementSchema`: SAVINGS+absent ✓, SAVINGS+MANUAL ✓, SAVINGS+AUTO_SPLIT ✗, EXPENSE+MANUAL ✗ (→ create scenarios); `movementSummarySchema` requires `kpis.manualSavings` |

## Threat Matrix

N/A — no shell-command, subprocess, git/VCS, PR-automation, executable-file-classification, or process-integration boundary is introduced. The `sa:manual` callback addition follows the existing in-process prefix dispatch (`dispatchCallback` :478-533): `buildCallbackData` enforces ASCII + 64 bytes, unknown actions already reply honestly with no state change.

## Migration / Rollout

1. `pnpm --filter @rita/contracts build` (contracts-first, apply guideline).
2. Edit `schema.prisma`; hand-write the migration directory per the repo convention (plain SQL above); `npx prisma migrate dev` applies it to the dev DB and regenerates the client (alternatively `migrate deploy` + `npx prisma generate`).
3. Integration tests apply it automatically to `<db>_test` via their `beforeAll` `prisma migrate deploy` — docker compose PostgreSQL (localhost:5433) must be running BEFORE apply-phase RED tests.
4. Chained PR slices (stacked, each independently green): **PR 1** data model + additive read/create contracts + repository stamps + migration pins (dashboard unaffected — summary contract untouched). **PR 2** `summaryManualSavings` + service balance/PATCH pin + `ExpenseService` guard & `createManualSavings` + wiring + `kpis.manualSavings` contract (emitter and contract land together — dashboard safe). **PR 3** bot surface (command, sub-menu, state, replies, registration, help).
5. Rollback: revert PRs; migration down = `ALTER TABLE "Expense" DROP COLUMN "savingsOrigin"; DROP TYPE "MovementSavingsOrigin";` — no data loss (nothing backfilled; NULL inert ⇒ pre-change summaries identical). Owners mid-`AWAITING_MANUAL_SAVINGS` recover via the removed-state → idle discipline (`normalizeState`) once `BOT_STATES` reverts.

## Open Questions

- None blocking. Cosmetic es-AR reply wording and the 4th button label (proposed: "➕ Ahorro manual") are finalized at implementation with `reply-text.test.ts` pinning the shipped strings.
