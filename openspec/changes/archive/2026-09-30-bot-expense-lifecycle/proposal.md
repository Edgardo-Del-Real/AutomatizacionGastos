# Proposal: Bot Expense Lifecycle

## Intent

The bot registers expenses but cannot manage their lifecycle: "ya lo pagué" and "borralo" degrade into wrong intents or help replies. A 2026-09-30 test verified nine root causes (CR-1..CR-9, `exploration.md`): missing mark-paid/delete intents, punctuation breaking guard words ("no." created a phantom category), a category-blind prompt with exact-only resolve, a reserved-alias gap, fixed-text setup, a contradictory double reply, and contaminated data.

## Context

`MovementService.markMovementPaid` (POST /movements/:id/paid) and `ExpenseService.deleteExpense` (DELETE /expenses/:id) exist unreferenced by the telegram feature — reused as-is. `awaiting_movement_selection` already exists for ambiguity asks.

## Scope

### In Scope
- Intents `mark_paid` + `delete_expense` in `BOT_INTENTS`, routed by a deterministic `MovementLifecycleExecutor` calling those services — zero duplicated business logic.
- Movement-reference resolution: corrector-style scoring (delete), PENDING-scoped window (mark-paid); ambiguity reuses the movement-selection ask.
- New `normalizeForMatchGuard` (punctuation stripping) for guard sets and single-token cascades; `normalizeForMatch` untouched (length-preserving, load-bearing).
- `RESERVED_ALIASES` += `provisorio → previsto`.
- Folded `resolveSuggestion` ("Otros"→"otro") + one prompt hint (B2, justified below).
- Dynamic setup listing; batch commands (`borrar categoría: X`) execute, never create literals.
- Single merged reply for register-during-dialog (CR-5).
- Owner-scoped one-off cleanup script with pre/post assertions.

### Out of Scope
Dashboard changes (REST already exposes both); per-message dynamic category lists in prompts (B1); REST/schema changes; `normalizeForMatch` mutation; new bot states.

## Capabilities

### New Capabilities
- `bot-expense-lifecycle`: conversational mark-paid (PENDING→PAID) and delete-expense, incl. reference resolution and ambiguity.

### Modified Capabilities
- `bot-brain`: two new intents in taxonomy/schema; prompt hint; folded suggestion resolution.
- `telegram-bot`: setup lists real categories + batch commands; punctuation-stripped guards; merged reply; new-intent routing.
- `conversational-categories`: guard words never auto-create categories.
- `movement-categories`: reserved alias `provisorio`.
- `planned-fixed-expenses`: bot as a mark-paid trigger channel.

## Approach

Follows exploration recommendations (A1, B2+hint, C, D1, E1, F1).

- **Intents**: mirror the CategoryExecutor/QueryExecutor pattern; fixed fallback templates; brain reply grounded in executed facts.
- **Category resolution — B2 + prompt hint, not B1**: folding `resolveSuggestion` fixes "Otros"→"otro" on every envelope path with one matching authority (matcher.ts), and the prompt sentence ("suggestions resolve against the owner's categories; 'otro' is the fallback") steers the LLM off redirectable intents without per-message `listCategories` calls or category names in prompts. B1 can layer later if suggestion quality demands it.
- **Guards**: `normalizeForMatchGuard` = `normalizeForMatch` + punctuation strip + whitespace collapse; early reject before single-token auto-create.
- **Setup**: `setupQuestionReply(existing)`; `extractCategoryNames` stays a pure parser (command patterns added); execution in `handleSetupReply` via CategoryService.
- **Double reply**: the `routeEnvelopeIntent` abandon block merges into one Sender call (extend `ExecutionResult` or fixed-only merged text — design decision).
- **Cleanup**: tsx script over Prisma — pre-assert the exact phantom rows; delete the junk expense (30000 PAID "No.") and phantom categories via CategoryService (guards for free); verify no "otro" duplicate; post-assert the valid PENDING 30000 "gastos hormiga" untouched. Runs post-apply against the real DB (runbook: confirmed owner id).

## Affected Areas

| Area | Impact |
|------|--------|
| `telegram/bot-brain.ts`, `telegram/telegram.service.ts` | Modified — intents, schema, prompts, routing, guards, setup, CR-5 |
| `telegram/movement-corrector.ts`, `telegram/reply-text.ts` | Modified — scoring-window extraction; templates |
| `categories/matcher.ts`, `categories/reserved.ts` | Modified — guard normalization (new fn); alias |
| `telegram/` (executor + tests), `scripts/` (cleanup) | New |
| Test suites + `__goldens__` | Modified — regenerate 8 prompt goldens |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Golden churn (8 snapshots, ~40 prompt assertions) | High | `vitest -u` in-change; review goldens |
| Intent misclassification ("marcá pagado" → register) | Medium | Prompt wording, few-shots, deterministic fallback |
| Cleanup touches real DB | Medium | Owner-scoped pre-assertions; row backup |
| Merged reply changes `ExecutionResult` | Medium | Fixed-only merged text alternative |

## Rollback Plan

Code: revert commits on `dev`; regenerate goldens (`vitest -u`). No Prisma schema or migration changes — no DB rollback. Data: the cleanup script backs up every deleted row (timestamped) before deletion; restore by re-insertion. The valid PENDING expense is asserted untouched.

## Dependencies

- PostgreSQL 16 on localhost:5433 (per `openspec/config.yaml`).
- Confirmed owner id for the cleanup runbook step.

## Success Criteria

- [ ] "ya lo pagué" → PENDING→PAID via `markMovementPaid`; one reply.
- [ ] "borralo" → deleted via `deleteExpense`; one reply.
- [ ] "no."/"si."/"no," never create categories or expenses in any dialog.
- [ ] "gasto provisorio" rejected as reserved.
- [ ] "Otros" resolves to "otro" (idle + dialog paths).
- [ ] `configurar categorías` lists real categories; batch commands execute.
- [ ] Register-during-dialog → exactly one reply.
- [ ] Cleanup post-assertions pass; valid PENDING "gastos hormiga" untouched.
- [ ] `pnpm --filter @rita/api test` + typecheck green.
