# Design: Savings Configuration — Rule Management + Manual Per-Income Choice

## Technical Approach

Deterministic slice (no LLM, no DB migration) extending the v2 button flow. Three surfaces: (1) savings-rule admin sub-menu `sa:*` entered from Ayuda, plus `listar ahorros` / `borrar ahorro:` commands and setMyCommands registration; (2) manual savings choice `sv:*` on the INGRESO confirmation — edit-in-place, persisted as an optional `savings` payload field, passed `savePreview → registerCapture → resolveSplit` replacing the hardcoded `{kind:"none"}` (telegram.service.ts:1176); (3) split categories — net INCOME keeps the preview-picked category, SAVINGS → "ahorro" (today both land in "ahorro", telegram.service.ts:1216 → expenses.repository.ts:144,160).

## Architecture Decisions

| # | Decision | Alternatives | Rationale |
|---|---|---|---|
| D1 | Ayuda renders with an inline keyboard `[💰 Ahorro]` → `sa:menu`; sub-menu = 3 rows Crear/Listar/Borrar (`sa:new`/`sa:list`/`sa:del`) | ninth main-menu button | Menu is full at 8 rows (m:new…m:help, telegram.service.ts:502-509); `sa:*` family named by spec bot-inline-interactions |
| D2 | `sa:new` → `awaiting_savings_rule` prompt; the reply is parsed by the EXISTING `parseCommand` (commands run before state consumption, telegram.service.ts:289-294); `savings-rule`/`savings-rule-invalid` command cases become state-aware: close `awaiting_savings_rule`/`awaiting_savings_percent` → idle + append menu; non-command text re-prompts (stays, awaiting_capture precedent) | parse inside the state handler (unreachable: global interception); always append menu | Zero new parse surface; existing idle-command assertions (telegram.service.test.ts:1262-1274, `replies.at(-1)`) stay green; passive commands leaving a prompt open matches the ayuda-during-preview precedent |
| D3 | Delete: stateless pick `sa:dl:<ruleId>` (resolve at callback; stale → gone reply, `ac:dl` precedent) → persisted gate `awaiting_savings_delete` `{rule:{id,keyword,percent}}` → `svdel:ok/no:<ruleId>` with state+id gate | stateless confirm like `ac:ok:<id>` | Spec telegram-bot persists "the rule id" in the gate; dk/dc pick+confirm precedent |
| D4 | `sv:5:<token>`/`sv:10:<token>` → `{kind:"percent"}`; `sv:off:<token>` → `{kind:"disabled"}`; `sv:other:<token>` → `awaiting_savings_percent` | `sv:none` for "No apartar" | "none" collides with `SavingsOverride {kind:"none"}` (rule decides) — `off` avoids the footgun; user-entered percents never ride a callback (ids/tokens only, spec budget) |
| D5 | `previewPayloadSchema` gains `savings?: z.discriminatedUnion("kind", [disabled, percent(positive ≤100)])`; absent = `{kind:"none"}`; never persist kind:"none" | include a "none" literal | Optional field keeps persisted previews decoding; corrupt-payload recovery (telegram.service.ts:652-662) untouched |
| D6 | Matched-rule suggestion computed at confirmation render via `matchNote`; manual `payload.savings` wins; consolidated private `renderPreviewConfirmation(ownerId, payload, category, editId, reply)` replaces all `previewConfirmReply` call sites (first pick / edit / fallback / create-category return / sv re-render) | compute once at preview entry | Rules can change mid-preview; one render path for the savings row + labels |
| D7 | Confirmation keyboard = ≤5 NORMAL category rows + `➕ Crear categoría` + savings row `[5%][10%][Otro][No apartar]` (INGRESO only) + `[✅ Guardar][✏️ Corregir]` = ≤8 rows; no nav row on the confirmation (preview message keeps pagination) | savings-only confirmation | Spec bot-inline "Savings Keyboard Budgets" lists exactly this composition; 5+1+1+1=8 |
| D8 | `createIncomeWithSavings`: `category: string` → `netCategory: string` + `savingsCategory: string` (repo + service wrapper); `registerIncomeSplit` passes the preview-picked category + `"ahorro"`; `successSplitReply(gross, net, savings, netCategory)` | optional `savingsCategory` defaulting to category | Explicit contract forces every call site and test to acknowledge; no silent both-"ahorro" drift |
| D9 | `SavingsRuleService.listRules(ownerId)` + `deleteRule(ownerId, keyword)` (normalize keyword like `defineRule`, null when missing); repo `delete(ownerId, keyword)` via compound-unique delete, P2025 → null | service-level filtering | Owner-scoping comes free from the `[ownerId, keyword]` unique; listByOwner already oldest-first |
| D10 | Commands `listar ahorros` → `{type:"savings-rule-list"}`; `borrar ahorro: <palabra>` → `{type:"savings-rule-delete", keyword}` (regexes after `SAVINGS_RULE_RE`; `sliceFromOriginal` preserves spelling; no collision with `borrar categoria:`); BOT_COMMANDS += `registrar_ahorro`, `listar_ahorros`, `borrar_ahorro`; ayuda text mentions savings; `parseSavingsPercentInput` (optional `%`, comma decimal) + range check 0<p≤100 in the state handler | — | Same parser conventions (D12 normalization); spec bot-main-menu setMyCommands list |
| D11 | BOT_STATES 8+3 = 11 (exact spec enumeration). Payloads: `awaiting_savings_rule` none; `awaiting_savings_percent` `{preview}` (savingsPercentPayloadSchema); `awaiting_savings_delete` `{rule}`. `sa:menu` sets idle (m:cats supersession precedent); `awaiting_savings_delete` + any message → idle + idle-route (dc precedent); corrupt payload → idle + dropped (existing discipline); rollback-safe: post-revert payloads in the 3 new states fail the old enum → old recovery → idle | a 12th selection state for rule picks | Stateless picks avoid selection payloads; spec enumerates exactly 11 |

## Data Flow

```
Owner              TelegramService                     SavingsRuleService
  │ m:inc ────────▶ startCapture → awaiting_capture{INGRESO}
  │ "…entrenuts 1000" ▶ enterPreview → awaiting_preview{amount,note,saveToken,category:null}
  │ cat:<id> ─────▶ renderPreviewConfirmation ──matchNote──▶ 10 (rule)
  │                ◀─ "Confirmá: $1.000 — Categoría: Sueldo — Ahorro: 10% (regla)"
  │                ◀─ [Sueldo][➕ Crear][5%][10%][Otro][No apartar][✅ Guardar][✏️ Corregir]
  │ sv:other ─────▶ awaiting_savings_percent{preview} → percent prompt
  │ "15" ─────────▶ awaiting_preview{savings:{percent:15}} → EDIT confirmation
  │ pv:save ──────▶ resolveSplit(owner, note, {percent:15}) → {split,15}
  │                ── createIncomeWithSavings(netCategory:"Sueldo", savingsCategory:"ahorro") ─▶
  │                ◀─ successSplitReply(1000, 850, 150, "Sueldo") + menu
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/features/telegram/telegram.commands.ts` | Modify | +savings-rule-list/savings-rule-delete types + regexes; +`parseSavingsPercentInput` |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | savings payload field + 2 new schemas; dispatch `sa`/`sv`/`svdel`; `handleSavingsAdminCallback`, `handleSavingsChoiceCallback`, `handleSavingsDeleteGateCallback`, `handleAwaitingSavingsPercent`; `renderPreviewConfirmation`; confirmation keyboard (cats+crear+savings); `registerCapture(amount,note,type,category,ownerId,savings,reply)`, `registerIncomeSplit(+netCategory)`, `savePreview` passes `payload.savings ?? {kind:"none"}`; state-aware savings command cases; 3 new state cases; help keyboard |
| `apps/api/src/features/telegram/telegram.bot.ts` | Modify | BOT_COMMANDS + 3 savings commands |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | `SavingsChoice` type; `previewConfirmReply(+savings line, INGRESO only)`, `successSplitReply(+netCategory)`, `ayudaReply` updated; +savingsAdminReply, savingsRulePromptReply, savingsRulesListReply (empty → "no tenés ahorros configurados"), savingsRuleDeletePickReply, savingsRuleDeleteConfirmReply, savingsRuleDeletedReply, savingsRuleMissingReply, savingsRuleGoneReply, savingsPercentPromptReply, savingsPercentInvalidReply |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | BOT_STATES += awaiting_savings_rule/percent/delete |
| `apps/api/src/features/savings/savings.repository.ts` | Modify | +`delete(ownerId, keyword)` |
| `apps/api/src/features/savings/savings.service.ts` | Modify | +`listRules`, +`deleteRule` |
| `apps/api/src/features/expenses/expenses.repository.ts`, `expenses.service.ts` | Modify | `createIncomeWithSavings` netCategory+savingsCategory |
| telegram/savings/expenses tests | Modify | per Testing Strategy |

## Interfaces / Contracts

Callback map (all ASCII, ≤64 bytes — `sa:dl:<cuid>`≈31B, `svdel:ok:<cuid>`≈34B, `sv:*:<8hex>`≤16B; `buildCallbackData` enforces):

| Callback | Effect |
|---|---|
| `sa:menu` | idle (abandon) + 3-action sub-menu |
| `sa:new` | → awaiting_savings_rule + syntax prompt |
| `sa:list` | rules list reply + menu |
| `sa:del` | no rules → empty reply + menu; else rule pick buttons `sa:dl:<id>` |
| `sa:dl:<ruleId>` | stale → gone reply; found → awaiting_savings_delete + `[❌ Cancelar][🗑 Borrar]` gate |
| `svdel:ok/no:<ruleId>` | state+id gate; ok → idle first, `deleteRule`, deleted/missing reply + menu; no → idle + cancel + menu |
| `sv:5/sv:10:<token>` | state+token gate → payload.savings={percent}; edit confirmation |
| `sv:off:<token>` | payload.savings={disabled}; edit confirmation |
| `sv:other:<token>` | → awaiting_savings_percent{preview} + prompt |

Savings line labels (`SavingsChoice = {kind:"auto", percent|null} | {kind:"percent"} | {kind:"disabled"}`): auto+rule → "Ahorro: X% (regla)"; auto+null → "Ahorro: sin regla"; percent → "Ahorro: X%"; disabled → "Ahorro: no apartar nada". Manual wins over suggestion in both label and `resolveSplit`.

## Testing Strategy

Strict TDD (RED → GREEN per behavior), dependency-ordered work sequence:

| Order | Layer | What | How |
|---|---|---|---|
| 1 | Unit | parse commands, percent input, new/updated reply texts, `deleteRule`/`listRules` (fake repo) | telegram.commands.test.ts, reply-text.test.ts, savings.service.test.ts |
| 2 | Integration | repo `delete` owner-scoped/missing/P2025; split net+savings categories | savings/expenses split integration tests |
| 3 | Unit | schema: legacy payload (no savings) decodes; percent/rule payloads | telegram.service tests |
| 4 | Unit | sv flows (5/10/off/other), suggestion label, manual-wins `resolveSplit` calls, INGRESO-only row, edit-in-place, `savePreview` default `{kind:"none"}` | telegram.service.savings.test.ts (default-path assertions :177/:198 stay; :179-187 gains netCategory/savingsCategory) |
| 5 | Unit | sa sub-menu, svdel gate, stale pick, state-aware command close, awaiting_savings_delete abandon | telegram.service.test.ts + savings tests |
| 6 | Unit | BOT_COMMANDS (telegram.bot.test.ts:428 "exactly four" → seven), help keyboard | telegram.bot.test.ts |
| 7 | Integration | e2e chains: confirmation row renders, Otro 15 → split 150/850, No apartar whole, net keeps picked category, corrupt-payload recovery, `{kind:"none"}` sites (telegram.service.test.ts:809 unchanged), household pv:save sites (:148/:210/:244) | telegram.service.integration.test.ts, household integration |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. All threat-matrix rows (documentation-like paths, git repo selection, commit state, push state, PR commands) are inapplicable: the changed dispatch is Telegram callback/command routing inside one process.

## Migration / Rollout

No migration required. The `savings` payload field is optional (persisted previews keep decoding); reverting the commits restores the hardcoded `{kind:"none"}` and both-"ahorro" behavior; post-revert payloads in the 3 new states recover to idle via the old enum.

## Open Questions

- [ ] Confirmation category rows show the first 5 alphabetically without nav (preview message keeps full pagination) — confirm acceptable.
- [ ] A `sv:*` tap while `awaiting_savings_percent` is open replies "ya procesado" (existing state+token gate, pv:save-during-category-name precedent) — the input prompt stays the active channel; future UX pass could treat it as a choice.
- [ ] `sa:del` pick list renders up to 7 rules without pagination (mirrors the `ac:del` cap); `listar ahorros` text shows all — confirm the cap is acceptable.
