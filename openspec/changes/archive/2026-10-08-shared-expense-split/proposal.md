# Proposal: Shared Expense Split

## Intent

A 👥 COMPARTIDO capture registers one full-amount SHARED row under the sender, so `visibility=mine` KPIs credit every shared expense to whoever typed it. The bot must ask the sender's percent and register sender + partner rows.

## Scope

### In Scope
- COMPARTIDO confirmation (partner present) asks the percent: `[50%][25%][75%][Otro]` (`sp:*` callbacks, token-only, state+token gate); `[Otro]` → state `awaiting_shared_percent`, `parseSharedContributionInput(input, total)` — `%`/≤100 → percent, else amount → `pct = amount/total*100`; `1..99` only, invalid → re-prompt
- Save gate: `[✅ Guardar]` without a chosen percent registers nothing for COMPARTIDO — asks to pick first
- Split with exact-sum invariant (`senderPart = round2(total*pct/100)`, `partnerPart = total − senderPart`); both rows SHARED, same `category`/`note`/`occurredAt`/ARS/PAID, `sharedTotal=total`; partner row under `partnerOf(sender)`
- No partner → unchanged legacy single SHARED row; no question, no `sp:*` row
- Nullable `sharedTotal Decimal(12,2)` on `Expense` (plain-SQL migration, no backfill); additive DTO/SELECT/map
- Annotation "parte de {total} compartido" on dashboard amount cell/card and bot reply

### Out of Scope
- Shared PENDING capture — `📅 Gasto previsto` stays INDIVIDUAL-only
- Pair linking (`sharedGroupId`) — orphaned halves documented as follow-up
- `sharedTotal` backfill; KPI changes beyond the accepted viewer shift

## Capabilities

### New Capabilities
- `shared-expense-split`: end-to-end COMPARTIDO split — question, parser, gate, invariant, two-row registration, `sharedTotal`, annotation

### Modified Capabilities
- `quick-capture`: `sharedPercent?` payload; Guardar gate; two-row save
- `telegram-bot`: `awaiting_shared_percent` state; annotated reply
- `bot-inline-interactions`: `sp:*` family; keyboard budgets
- `money-movements`: `movementSchema` gains `sharedTotal`
- `savings`: COMPARTIDO scenario updated (no SAVINGS)
- `dashboard-web`: amount annotation

## Approach

Mirror the savings `sv:*` / `awaiting_savings_percent` flow (state+token gate, edit-in-place, re-prompt); split in `registerCapture` via a Decimal helper modeled on `computeSplit`, es-AR parsing local (`45.000` = thousands).

## Affected Areas

- `apps/api/prisma/schema.prisma` + new migration — nullable `sharedTotal`
- `apps/api/src/features/telegram/` (service, state, commands, reply-text) + `expenses/` — `sp:*` row, new state, parser, replies, split, 2-row create
- `packages/contracts/src/index.ts`, `movements.repository.ts`, `MovementList.tsx` — additive DTO/SELECT/map + annotation

## Risks

- `visibility=mine` KPI shift (accepted): High — per-viewer sum assertions
- Orphaned half on edit/delete: Med — documented follow-up
- es-AR ambiguity (`45.000`, `<=100`, `=total`): Med — own parser, edge tests
- Keyboard budgets: Low — extend tests

## Rollback Plan

Revert commits; ship `DROP COLUMN "sharedTotal"` (or leave the inert column). No backfill; other captures untouched.

## Dependencies

- PostgreSQL 16 (localhost:5433) + `automatizacionrita_test`; build contracts first

## Success Criteria

- [ ] Partner-present COMPARTIDO asks the percent; save → two SHARED rows summing exactly to the total, both with `sharedTotal`
- [ ] No partner / invalid / stale `sp:*` / ungated saves keep current disciplines (legacy row, re-prompt, "ya procesado")
- [ ] Dashboard and bot annotate; `pnpm --filter @rita/api test` green
