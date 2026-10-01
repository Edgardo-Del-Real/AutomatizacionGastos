# Proposal: Savings Configuration — Rule Management + Manual Per-Income Choice

## Intent

The savings rule (`registrar ahorro:`) works but is undiscoverable — no button, no Ayuda mention, not in `setMyCommands`, no list, no delete — and per-income choice is impossible (`registerCapture` hardcodes `{kind:"none"}`, telegram.service.ts:1176). Owner-confirmed decisions (exploration.md): savings sub-menu; delete; manual [5%][10%][Otro][No apartar] buttons in the INGRESO confirmation; net INCOME keeps the picked category (only SAVINGS → "ahorro"); manual wins, "No apartar" disables for that income only.

## Scope

### In Scope
- Savings sub-menu (create/list/delete rules with buttons) entered from Ayuda — main menu verified full: 8 rows `m:new/m:prev/m:inc/m:shr/m:cats/m:adm/m:rep/m:help`.
- `borrar ahorro: <palabra>` + `listar ahorros` commands; savings commands in `setMyCommands`; Ayuda mentions savings.
- INGRESO confirmation savings row [5%][10%][Otro][No apartar] + optional payload `savings` field (backward-compatible); matched rules show suggested %.
- Net INCOME keeps the preview-picked category; only SAVINGS → "ahorro"; repository `delete` + `deleteRule` wrapper; `resolveSplit` unchanged.

### Out of Scope
- Dashboard/API savings-rule config (bot-only).
- New main-menu button (Telegram 8-row cap); per-message text overrides (legacy prefixes stay redirects).
- Percent-edit UI (re-create upserts); LLM paths (deterministic).

## Capabilities

### New Capabilities
- `bot-manage-savings`: rule-management UI — Ayuda-entered sub-menu (create/list/delete), savings commands, setMyCommands registration (mirrors `bot-manage-categories`).

### Modified Capabilities
- `savings`: delete/list semantics; manual-override precedence; net-income category.
- `quick-capture`: payload savings field; confirmation row + "Otro" input.
- `telegram-bot`: command list; new states; split requirement.
- `bot-inline-interactions`: `sv:*` + savings-admin callback families; budgets.
- `bot-main-menu`: help text; setMyCommands list.

## Approach

Extend the v2 button flow; reuse `resolveSplit` overrides. Manual choice: optional `savings?: SavingsOverride` payload field; `sv:*` callbacks dispatched in `handlePreviewCallback` (edit-in-place like category re-picks); `savePreview` passes `payload.savings ?? {kind:"none"}` to `registerCapture`, replacing the hardcoded override; "Otro" reuses the `awaiting_category_name` text-input precedent. Rule management mirrors `m:cats`→`ac:*`: Ayuda gains a 💰 Ahorro keyboard entry; delete follows the `dk:`/`dc:` pick+confirm precedent; repository adds `delete(ownerId, keyword)`. `createIncomeWithSavings` takes separate net/savings categories.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/features/telegram/telegram.service.ts` | Modified | `sv:*` callbacks, savings field, `registerCapture`/`registerIncomeSplit`, sub-menu, new states |
| `apps/api/src/features/telegram/telegram.commands.ts` | Modified | borrar/listar ahorro parse |
| `apps/api/src/features/telegram/telegram.bot.ts` | Modified | `BOT_COMMANDS` |
| `apps/api/src/features/telegram/reply-text.ts` | Modified | sub-menu, manual-choice, ayuda texts |
| `apps/api/src/features/savings/savings.repository.ts` / `savings.service.ts` | Modified | `delete` / `deleteRule` |
| `apps/api/src/features/expenses/expenses.repository.ts` | Modified | split categories |
| savings/telegram/expenses tests | Modified | new + updated assertions |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Test blast radius — `{kind:"none"}` assertions + payload-parse call sites (telegram.service.savings.test.ts:177,198; telegram.service.test.ts:809) | High | Strict-TDD updates in same slice |
| Persisted previews must keep decoding; corrupt-payload recovery regression | Medium | Field stays optional; recovery untouched |
| Category change shifts split confirmations and dashboard rows (both movements "ahorro" today) | Medium | Explicit spec contract; integration tests |
| Keyboard budgets (≤8 rows / 64 bytes); bare `/registrar_ahorro` taps | Low | id-based tokens; usage reply |

## Rollback Plan

Revert the commits: no DB migration exists, the payload field is optional (persisted previews still decode), and reverting restores the hardcoded `{kind:"none"}` + both-"ahorro" behavior.

## Dependencies

None — existing `SavingsRule` model and Telegram API limits.

## Success Criteria

- [ ] Rules managed via Ayuda sub-menu buttons (create/list/delete)
- [ ] `borrar ahorro:` / `listar ahorros` work; savings commands in setMyCommands; Ayuda mentions savings
- [ ] INGRESO confirmation offers [5%][10%][Otro][No apartar]; matched rule % shown; manual wins; "No apartar" registers whole
- [ ] Net INCOME keeps the picked category; net + savings = gross exactly
- [ ] `pnpm --filter @rita/api test` green
