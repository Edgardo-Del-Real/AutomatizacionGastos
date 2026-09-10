# Proposal: Learning categories, bot confirmations, dashboard corrections

## Intent

Fixed vocabularies mis-categorize real spending (false reports) — categories must be user-defined and learned; the bot registers silently; the dashboard is read-only, forcing manual DB fixes.

## Scope

### In Scope
- Owner-scoped, user-defined Category entity; auto-created "otro" fallback; learned CategoryKeyword rules; Prisma migration.
- Setup flow: no categories → bot asks; reply creates them; re-runnable via `configurar categorias`.
- Correction loop: unmatched → "otro" + ask; answer reassigns it and learns a note-word rule.
- Commands: `registrar categoria: X`, `renombrar categoria: X a: Y` (renames movements), `asociar palabra: P a categoria: X`, `listar categorias`.
- Persisted per-owner state machine: awaiting_setup / awaiting_category / idle.
- Replies: success = amount + note + category; unparseable = help; non-owner/edited silent; dedupe unchanged.
- `DELETE /movements/:id` + `PATCH /movements/:id` (amount/note/category, both types, owner-scoped).
- Dashboard: edit form, delete confirm, auto-refresh of list/KPIs/categories (App-level refresh token).

### Out of Scope
- ML/NLP; auth; multi-user beyond ownerId; category colors/reorder; bot-side editing; `type` classification/edits; `occurredAt` edits; `/expenses*` behavior.

## Capabilities

### New Capabilities
- `movement-categories`: owner-scoped user-defined categories, "otro" fallback, keyword learning + transport-agnostic matching, rename cascade, management operations.

### Modified Capabilities
- `telegram-bot`: bidirectional — confirm/help replies, setup + correction flows, commands, per-owner state machine; category on create.
- `money-movements`: user-defined movement categories; owner-scoped DELETE/PATCH (both types); `updateMovementSchema` (null clears, absent unchanged).
- `dashboard-web`: delete confirm, edit form, auto-refresh of list/KPIs/categories after mutations.

## Approach
- New `features/categories` slice: entity + keyword persistence, pure matching service (normalized word-boundary lookup) for `TelegramService`.
- Replies via injected `sendReply` port wired to `ctx.reply`; offline middleware throw → record.
- Repository `deleteById`/`updateById` (no EXPENSE-only filter); `x-owner-id` scoping; 404 on missing.
- Dashboard `request()` gains method/body/headers; mutations bump an App-level `refreshKey`.

## Affected Areas

| Area | Impact |
|------|--------|
| `apps/api/prisma/schema.prisma` + migrations | Category, CategoryKeyword, bot state |
| `apps/api/src/features/categories/` | New slice |
| `apps/api/src/features/telegram/`, `messages/`, `movements/` | Modified |
| `packages/contracts/src/index.ts` | Modified |
| `apps/dashboard/src/` — api, hooks, `MovementList.tsx`, `App.tsx` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Offline bot middleware throws on API calls; replies untestable | High | Same TDD cycle as reply code |
| Stale list/KPIs after mutations | High | App-level refresh token |
| Category drift across bot/editor/filter | Medium | One category source; spec pins PATCH |
| State machine misreads replies as registrations | Medium | Spec pins per-state rules |

## Rollback Plan

Single PR (user-accepted budget): revert merge commit; additive migration has a down-migration; existing endpoint/contract shapes unchanged.

## Dependencies

None new.

## Success Criteria

- [ ] Owner without categories triggers setup; categories + "otro" persist.
- [ ] Unmatched → "otro" + question; answer reassigns; future similar notes auto-match.
- [ ] Success replies show amount, note, category; parse failures get help; others silent.
- [ ] Dashboard deletes/edits both movement types with auto-refresh.
- [ ] API + dashboard suites green under strict TDD.

## Open Questions

1. Unknown category in correction answer: re-ask or auto-create?
2. Legacy NULL/seed-category movements: leave as-is or remap?
3. Edit-form category input: dropdown (needs read source) or free text?
