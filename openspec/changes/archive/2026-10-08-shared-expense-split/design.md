# Design: Shared Expense Split

## Technical Approach

Mirror the shipped savings `sv:*` / `awaiting_savings_percent` flow (exploration Approach 1): partner-gated `sp:*` row on the COMPARTIDO confirmation, new `awaiting_shared_percent` state carrying the open preview, es-AR percent-or-amount parser, save gate on the missing percent, two-row `$transaction` modeled on `createIncomeWithSavings`. `sharedTotal` rides `Expense` → movement DTO → dashboard/bot annotation.

## Bot Interaction Sequence

```
Owner          TelegramService                            ExpenseService / DB
 │ m:shr ────────► startCapture("COMPARTIDO") → awaiting_capture
 │ "2000 super" ─► captureParse → enterPreview (awaiting_preview + saveToken)
 │ cat:<id> ──────► renderPreviewConfirmation
 │                 partner? → row [50%][25%][75%][Otro] = sp:<pct|other>:<token> (token-only)
 │ sp:50:<tk> ────► state==awaiting_preview && token==saveToken? else "ya procesado"
 │                 persist sharedPercent=50 → re-render in place (confirmMessageId)
 │ sp:other:<tk> ─► persist {preview} → awaiting_shared_percent → value prompt
 │ "30000" ──────► parseSharedContributionInput("30000", 40000) → 75
 │                 invalid → re-prompt, state stays · valid → awaiting_preview + re-render
 │ pv:save:<tk> ─► gates: category? partner? sharedPercent?
 │                 missing percent → pick-first reply, nothing registers
 │                 else IDLE first → registerCapture COMPARTIDO branch
 │                   └► createSharedSplit → $transaction: sender row + partner row
 ◄─────────────── successSharedReply(senderShare, "parte de $ total compartido") + menu
```

## Architecture Decisions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| D1 | New `awaiting_shared_percent` in `BOT_STATES` + `handleUpdate` case | reuse `awaiting_savings_percent` | Different domain (1..99 percent-or-amount vs 0..100 percent-only); states are spec-enumerated; `normalizeState` keeps rollback recovery. |
| D2 | Split branch in `registerCapture`; arithmetic+writes in repository `createSharedSplit` (service delegates) | bot-side arithmetic or a split service | `registerCapture` is the single registration decision point (INGRESO precedent); the `$transaction` belongs beside `createIncomeWithSavings`. |
| D3 | Partner resolved per surface via in-memory `partnerOf` (keyboard, save gate, registerCapture) | persist the partner | Cheap pure lookup; row/gate/split each independently gated; nothing stale persisted. |
| D4 | Own parser `parseSharedContributionInput(input, total)` | reuse `parseSavingsPercentInput` | Locale conflict: savings reads `.`/`,` as decimals; shared needs es-AR thousands (`45.000`=45000), `$`/`ars`, percent-vs-amount against the total. |
| D5 | `sp:*` row on `previewConfirmKeyboard` (gains `hasPartner` param); `[50%][25%][75%][Otro]`, 50% first; callback data token-only | percent in callback data | Mirrors `sv:*`; spec forbids the percent in callback data; ≤ 64 bytes. Two-message discipline unchanged: preview keyboard (categories+➕) and confirmation keyboard (shared row+Guardar/Corregir) each ≤ 8 rows. |
| D6 | Confirmation text appends a share line when `sharedPercent` is set (mirrors `savingsLine`) | plain re-render | Makes the persisted percent visible. |
| D7 | Save gate in `handlePreviewCallback` `save`: partner + no percent → `sharedPickFirstReply`, nothing registers | default percent | Same discipline as the category gate; no surprising default. |
| D8 | `createSharedSplit` returns `{sender, partner}` amounts | return rows / extend `expenseSchema` | Reply needs only the sender share; `expenseSchema`/expenses reads stay untouched — `sharedTotal` exposed only via `movementSchema`. |
| D9 | `sharedPercent` fractional (`z.number().min(1).max(99)`) | integer-only | Amount-derived percents are fractional; Decimal handles them exactly. |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` | Modify | `sharedTotal Decimal? @db.Decimal(12, 2)` on `Expense` |
| `apps/api/prisma/migrations/20261008120000_shared_expense_split/migration.sql` | Create | `ALTER TABLE "Expense" ADD COLUMN "sharedTotal" DECIMAL(12,2) NULL;` |
| `packages/contracts/src/index.ts` | Modify | `movementSchema` += `sharedTotal: z.number().nullable().optional()` |
| `apps/api/src/features/movements/movements.repository.ts` | Modify | `MovementRow`, SELECTs (`listByOwner`, `topByType`), `mapMovementRow` carry `sharedTotal` |
| `apps/api/src/features/expenses/expenses.repository.ts` | Modify | `createSharedSplit` — 2-row `$transaction` |
| `apps/api/src/features/expenses/expenses.service.ts` | Modify | delegate `createSharedSplit` |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | `sharedPercent` + `sharedPercentPayloadSchema`; `AWAITING_SHARED_PERCENT` state/routing; `handleSharedChoiceCallback`; `handleAwaitingSharedPercent`; share row + line; save gate; `registerCapture` split; `savePreview` pass-through |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | `BOT_STATES` += `awaiting_shared_percent` |
| `apps/api/src/features/telegram/telegram.commands.ts` | Modify | `parseSharedContributionInput` |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | `sharedPercentPromptReply`, `sharedPercentInvalidReply`, `sharedPickFirstReply`, `successSharedReply` |
| `apps/dashboard/src/features/movements/MovementList.tsx` | Modify | annotate "Monto" cell + card when `sharedTotal` present |

## Interfaces

```ts
// telegram.service.ts (additive)
previewPayloadSchema += sharedPercent: z.number().min(1).max(99).optional()
export const sharedPercentPayloadSchema = z.object({ preview: previewPayloadSchema });

// telegram.commands.ts — resolves the percent 1..99, or null (invalid)
export function parseSharedContributionInput(input: string, total: number): number | null
// "%"→percent · bare ≤100→percent · >100 | "$" | "ars" | "45.000" thousands→amount→pct=amount/total*100

// expenses.repository.ts — mirror createIncomeWithSavings
createSharedSplit(data: { ownerId: string; partnerId: string; total: number;
  percent: number; note: string | null; occurredAt: Date; category: string }):
  Promise<{ sender: number; partner: number } | null>
// senderPart = round2(total*pct/100); partnerPart = total − senderPart; exact sum.
// Both rows SHARED·EXPENSE·PAID·ARS, same category/note/occurredAt, sharedTotal=total
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | Parser edges | `telegram.commands.test.ts`: "30%"→30; "25"→25; "30000"/40000→75; "45.000"/90000→50; "$45.000", "45.000 ars"; "100", "0", "=total" → null; "45,5"→45.5 (vs `45.000` amount) |
| Unit | Replies + contract + invariant | `reply-text.test.ts` (4 replies, share line); contracts `index.test.ts` (split row carries `sharedTotal`; legacy omits); repository/service split unit: 10.00@33% → 3.30/6.70; 40000@50% → 20000/20000 |
| Service | Question, gate, stale taps | savings-harness pattern: partner-present asks percent; `sp:50` re-renders in place; `sp:other` → prompt; valid 30 → back to preview; invalid → re-prompt, state stays; stale `sp:*` → "ya procesado"; Guardar without percent → pick-first reply, nothing registered; no-partner harness → no row, legacy single row; COMPARTIDO creates no SAVINGS |
| Integration | Two-row transaction | household test (2 members): two SHARED rows, exact sum, same facts, sender/partner owners; split integration mirrors `expenses.split.integration.test.ts`; visibility integration: SELECT carries `sharedTotal` (null legacy) |
| KPI | Per-viewer shift | route/repository tests: `visibility=mine` → own share only; `all`/`shared` → total; `count`, `maxAmount`, `avgPerMovement` asserted per viewer |
| Dashboard | Annotation | `MovementList.test.tsx`: "$ 1.000" + "parte de $ 2.000 compartido" (cell + card); no annotation without `sharedTotal` |

**Existing tests updated:** savings test "COMPARTIDO NEVER splits..." reworded + partner-present split added; household integration (~line 234) expects two rows; `openPreview` helper; `telegram.service.test.ts` ~936.

**Accepted consequences:** `mine` shows only the viewer's share (count 2, maxAmount = share); `all`/`shared` still sum to total; per-category gross correct (identical category). Each half is independent — editing/deleting one orphans the other; `sharedGroupId` out of scope.

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/PR/executable-classification boundary; `sp:` extends in-application Telegram callback dispatch only.

## Migration / Rollout

Plain-SQL nullable column, no backfill; NULL behaves as before. No feature flag (no partner → legacy). Rollback: revert commits; column inert (or `DROP COLUMN`).

## Open Questions

- [ ] Card view is disabled behind `{false && ...}`; annotate both surfaces, confirm card-path testing.
- [ ] Share-line label wording (apply locks via reply-text tests).
