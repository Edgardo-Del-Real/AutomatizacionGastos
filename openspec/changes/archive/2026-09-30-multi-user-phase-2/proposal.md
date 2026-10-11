# Proposal: Multi-User Phase 2 — Household Sharing (Edgardo + Rita)

## Intent

Single-user today: one owner (`default`), one chat, one dashboard. Phase 2: two members share the app — same bot, one panel, per-viewer identity, shared-expense visibility, no login.

## Scope

### In Scope
- Household identity: two members (`ownerId`, name, chatId) in env; `GET /household/members`; bot resolves `chatId → ownerId`.
- `Expense.visibility` (`INDIVIDUAL | SHARED`, default `INDIVIDUAL`); existing rows backfill to `INDIVIDUAL`.
- Viewer-scoped `GET /movements` + `/movements/summary` (own + partner's SHARED) with `visibility` filter (`mine | shared | all`) incl. charts.
- Multi-chat bot: per-chat attribution; `recordProcessed` after chat gate; shared via `compartido:` prefix or brain `shared` flag.
- Dashboard: viewer selector (replaces `VITE_OWNER_ID`), SHARED badge, visibility filter, read-only partner rows.
- Strict TDD (vitest): two-owner integration tests for attribution and leak safety.

### Out of Scope
- Real login/auth (manual selector, migrable)
- N>2 households; group chats
- Partner editing/deleting registrant's movements (registrant-only mutation)
- Shared category vocabularies
- Household aggregates, "who owes whom"
- `/expenses*` legacy endpoints (frozen, owner-scoped)

## Capabilities

### New Capabilities
- `household-identity`: member registry, chat resolution, partner lookup, endpoint.

### Modified Capabilities
- `money-movements`: visibility model, viewer-scoped reads, filter param, contract fields.
- `telegram-bot`: Owner Filtering → household chats; dedup after gate; shared registration.
- `bot-brain`: optional `shared` boolean on `register_expense` envelopes.
- `dashboard-web`: viewer selector replaces Fixed Owner; badge, filter, read-only rows.

## Approach

Decisions:
1. **Flag, not join table**: `SHARED` = "other member also sees it"; one predicate (`ownerId = viewer OR (visibility = SHARED AND ownerId = partner)`) covers all queries; join tables only pay off for per-person grants (N>2).
2. **Env-configured members, no User table**: fixed duo; chatIds already env secrets; unset degrades to single-member mode.
3. **Registrant-only mutation**: shared rows keep registrant's categories; partner edits need cross-owner validation — deferred.
4. **Central SQL predicate**: one visibility fragment for all 8 raw queries; two-owner tests guard leaks.
5. **`compartido:` prefix is authoritative** (deterministic, works brain-less); brain `shared` flag adds a signal.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` | Modified | `visibility` field + backfill migration |
| `apps/api/src/features/household/` | New | Config, chat resolution, members route |
| `apps/api/src/features/telegram/telegram.service.ts` | Modified | Gate, dedup order, shared prefix |
| `apps/api/src/features/movements/` | Modified | Predicate + filter in 8 raw queries |
| `packages/contracts/src/` | Modified | `visibility`, registrant, filter schemas |
| `apps/dashboard/src/` | Modified | `env.ts`, `App.tsx`, components, hooks |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-owner leak via raw query | Med | Central predicate + two-owner tests |
| Golden prompt tests break | High | Goldens updated in-cycle |
| Gate/dedup reorder regressions | Med | Two-chat integration tests |
| `/expenses*` drift | Low | Frozen; existing tests untouched |

## Rollback Plan

Additive migration; unset `HOUSEHOLD_MEMBERS` restores single-member mode. Revert: drop `visibility` column, revert code, dashboard falls back to `VITE_OWNER_ID`.

## Dependencies

None external; both members' Telegram chatIds required.

## Success Criteria

- [ ] Rita's private-chat message registers under her ownerId; unknown chats ignored
- [ ] SHARED movements visible to both; filter works on list + summary
- [ ] Dashboard shows selector, badge, chart filter; zero cross-owner leaks
- [ ] Full suite green (strict TDD, vitest); `/expenses*` unchanged

## Ready for Spec

Scope closed. Next: sdd-spec.
