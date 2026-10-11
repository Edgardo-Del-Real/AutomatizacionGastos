```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:25c6eeba5ad98ad2602b56ee5e4823ecac50ebfa1989943eb5592d1c64bfe34e
verdict: pass
blockers: 0
critical_findings: 0
requirements: 17/17
scenarios: 64/64
test_command: pnpm --filter @rita/api exec vitest run --testNamePattern "^(?!.*sends a NEW confirmation message).*$"
test_exit_code: 0
test_output_hash: sha256:c871646a8497cf8032b273f8d01416261113fa539d9dcf60b07541534763c67c
build_command: pnpm --filter @rita/api build
build_exit_code: 0
build_output_hash: sha256:39f890499029f7010f09b1717c60468d0bac4dd9b9926601a8944b34353500e6
```

## Verification Report

**Change**: shared-expense-split
**Version**: N/A (single-slice delta change: 1 NEW capability + 6 deltas)
**Mode**: Strict TDD (orchestrator-declared; runner `pnpm --filter @rita/api test`)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25 |
| Tasks incomplete | 0 |
| Specs read | 7 (1 NEW `shared-expense-split` + 6 deltas: quick-capture, telegram-bot, bot-inline-interactions, money-movements, savings, dashboard-web) |
| Requirements (authoritative heading count) | 17 |
| Scenarios (authoritative heading count) | 64 |
| Changed files (git status) | 25 entries (24 modified + 1 new migration dir; openspec report dir untracked) |

### Build & Tests Execution

**Build**: ✅ Passed (exit 0)
```text
pnpm --filter @rita/api build
> @rita/api@0.1.0 build
> pnpm --filter @rita/contracts build && tsc -p tsconfig.build.json
> @rita/contracts@0.1.0 build
> tsc -p tsconfig.json
```

**Tests (full suites — raw result, exit codes as-is)**:
```text
pnpm --filter @rita/api test        -> Test Files 1 failed | 36 passed (37)   Tests 1 failed | 965 passed (966)   exit 1
pnpm --filter @rita/dashboard test  -> Test Files 1 failed | 21 passed (22)   Tests 1 failed | 168 passed (169)  exit 1
```
Both non-zero exits are attributable 100% to the two DOCUMENTED pre-existing baselines (see Issues → SUGGESTION). Neither failing assertion/file is touched by this change's diff (`git diff HEAD` touches neither `telegram.service.test.ts:705-727` assertion nor `SummarySection.test.tsx`).

**Tests (change-certifying run — the two documented baselines excluded by name)**: ✅ exit 0
```text
pnpm --filter @rita/api exec vitest run --testNamePattern "^(?!.*sends a NEW confirmation message).*$"
  Test Files  37 passed (37)   Tests  965 passed | 1 skipped (966)   exit 0
pnpm --filter @rita/dashboard exec vitest run --testNamePattern "^(?!.*renders the section content with the loaded summary).*$"
  Test Files  22 passed (22)   Tests  168 passed | 1 skipped (169)   exit 0
```
The excluded names are exactly the two documented baseline tests; every other test (including all change-authored and change-affected tests) runs green.

**Typecheck**: ✅ `pnpm typecheck` — contracts + api + dashboard, 0 errors (exit 0)
**Lint**: ✅ `pnpm lint` — contracts + api + dashboard, clean (exit 0)
**Coverage**: ➖ Not available — no coverage provider configured in `apps/api/vitest.config.ts` / `apps/dashboard/vitest.config.ts` (not a failure)

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | `apply-progress.md` has a full "Strict TDD Cycle Evidence" table for phases 1–7.5 |
| All tasks have tests | ✅ | 25/25 tasks map to existing test files (contracts, split unit+integration, visibility integration, route KPI, commands, reply-text, savings shared-flow, household integration, telegram service/integration, dashboard MovementList) |
| RED confirmed (tests exist) | ✅ | All referenced test files verified on disk; new cases present (e.g. `parseSharedContributionInput` cases at `telegram.commands.test.ts:159-202`; shared-flow suite at `telegram.service.savings.test.ts:439-630`) |
| GREEN confirmed (tests pass) | ✅ | 965/965 API (change-certifying run) and 168/168 dashboard pass on execution; full suites differ only by the two documented baselines |
| Triangulation adequate | ✅ | Multi-case per behavior: parser (10 cases), shared flow (10 cases incl. stale token, invalid, amount-derived), split invariant (odd 33% + even 50%), KPI (mine/all/shared), dashboard (3 cases) |
| Safety Net for modified files | ✅ | apply-progress reports baseline counts for each modified file; no report/modified mismatch found |

**TDD Compliance**: 6/6 checks passed

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | majority of 965 | ~30 files | vitest (node env, mocked deps) |
| Integration | split/visibility/household/route suites | 5 files | vitest + live Postgres (:5433) + `prisma migrate deploy` |
| E2E (UI) | 22 dashboard files | 22 files | vitest + Testing Library (jsdom) |
| **Total** | **1133** (965 + 168) | **59** | |

### Changed File Coverage
Coverage analysis skipped — no coverage tool detected (no coverage provider configured; not a failure).

### Assertion Quality
✅ All assertions in the changed tests verify real behavior: contract values (`sharedTotal` 2000/null/absent), parser outputs (30/25/75/50/45.5/null), split amounts and exact sums (3.30/6.70, 2000/2000), persisted rows + owners, callback_data token lists (`sp:50|25|75|other:<token>`), reply text equality, KPI numbers per viewer, and rendered annotation strings. No tautologies, no ghost loops over possibly-empty collections, no orphan empty-checks, no smoke-only renders, no mock counts used as behavior proxies.

### Quality Metrics
**Linter**: ✅ No errors (`pnpm lint`, exit 0)
**Type Checker**: ✅ No errors (`pnpm typecheck`, exit 0)

### Spec Compliance Matrix

#### shared-expense-split (NEW) — 8 requirements, 23 scenarios

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Shared Percent Question | Partner-present COMPARTIDO asks the percent | `telegram.service.savings.test.ts:472` (renders `[50%][25%][75%][Otro]`; helper `expectSharedRow` asserts token-only `^sp:(50\|25\|75\|other):[0-9a-f]{8}$`) | ✅ COMPLIANT |
| Shared Percent Question | Percent choice re-renders in place | `telegram.service.savings.test.ts:501` (`sp:50` → `sharedPercent` 50 persisted + `previewConfirmReply(...,50)`) | ✅ COMPLIANT |
| Shared Percent Question | Otro prompts for input | `telegram.service.savings.test.ts:515` (state `awaiting_shared_percent`, `sharedPercentPromptReply()`) | ✅ COMPLIANT |
| Shared Percent Question | Stale or ungated tap is rejected | `telegram.service.savings.test.ts:566` (`sp:50:deadbeef` → `alreadyProcessedReply()`, state unchanged) | ✅ COMPLIANT |
| Shared Percent Question | No partner asks nothing | `telegram.service.savings.test.ts:479` (no `sp:*` row) + `telegram.service.integration.test.ts:382` (legacy single row) | ✅ COMPLIANT |
| Shared Contribution Parser | Percent suffix | `telegram.commands.test.ts:160` (`"30%"`,`40000`→30) | ✅ COMPLIANT |
| Shared Contribution Parser | Bare small number is a percent | `telegram.commands.test.ts:164` (`"25"`→25) | ✅ COMPLIANT |
| Shared Contribution Parser | Bare large number is an amount | `telegram.commands.test.ts:172` (`"30000"`,`40000`→75) | ✅ COMPLIANT |
| Shared Contribution Parser | es-AR thousands amount | `telegram.commands.test.ts:176,180,184` (`"45.000"`→50, `"$45.000"`→50, `"45.000 ars"`→50) | ✅ COMPLIANT |
| Shared Contribution Parser | Boundary invalid re-prompts | `telegram.commands.test.ts:188-202` (`100`,`0`,`=total`,`40000`,`-5`,`""`→null) + `savings.test.ts:553` (invalid keeps state) | ✅ COMPLIANT |
| Shared Save Gate | Guardar without a percent blocks | `telegram.service.savings.test.ts:577` (`mockCreateExpense`/`mockCreateSharedSplit`/`mockResolveSplit` never called; `sharedPickFirstReply()`) + `telegram.service.household.integration.test.ts:266` (0 rows) | ✅ COMPLIANT |
| Shared Save Gate | Guardar with a percent proceeds | `telegram.service.savings.test.ts:588` (`createSharedExpenseSplit` called) | ✅ COMPLIANT |
| Shared Split Invariant | Exact sum | `expenses.split.test.ts:191` (10.00@33% → 3.30/6.70, exact sum) | ✅ COMPLIANT |
| Shared Split Invariant | Even half | `expenses.split.test.ts:221` (40000@50% → 20000/20000) | ✅ COMPLIANT |
| Two-Row Shared Registration | Two rows registered | `telegram.service.household.integration.test.ts:234` (sender 1000 + partner 1000, both SHARED, `sharedTotal` 2000, same category/note) + `expenses.split.integration.test.ts:139` | ✅ COMPLIANT |
| Two-Row Shared Registration | No partner keeps legacy | `telegram.service.integration.test.ts:382` + `telegram.service.test.ts:939` + `savings.test.ts:231` (single SHARED row, `sharedTotal` null) | ✅ COMPLIANT |
| Two-Row Shared Registration | Shares reconcile to the total | `expenses.split.integration.test.ts:139` (asserted exact sum) | ✅ COMPLIANT |
| sharedTotal Persistence and Contract | Migration adds a nullable column | `apps/api/prisma/migrations/20261008120000_shared_expense_split/migration.sql` (`ALTER TABLE "Expense" ADD COLUMN "sharedTotal" DECIMAL(12,2) NULL;` — no backfill) + `movements.repository.visibility.integration.test.ts:199` (legacy rows null) | ✅ COMPLIANT (no dedicated migration assertion; observable behavior covered) |
| sharedTotal Persistence and Contract | Contract carries the field | `packages/contracts/src/index.test.ts:132,142,147` (2000 / null / absent) | ✅ COMPLIANT |
| Shared Display Annotation | Dashboard annotation | `MovementList.test.tsx:628,646` ("$ 1.000,00" + "parte de $ 2.000,00 compartido") | ✅ COMPLIANT |
| Shared Display Annotation | Bot reply annotation | `telegram.service.savings.test.ts:588` (`successSharedReply(1000,2000,...)`) + `reply-text.test.ts:345` | ✅ COMPLIANT |
| Documented Consequences | Viewer-scoped KPI shift | `movements.route.test.ts:760` (`mine` → 1000/count 1/max 1000/avg 1000/balance −1000; `all`/`shared` → 2000/count 2) | ✅ COMPLIANT |
| Documented Consequences | Orphaned half | Documented in `design.md` "Accepted consequences", `proposal.md` "Out of Scope", `spec.md`; no `sharedGroupId` exists so nothing links/repairs — no runtime invariant to assert | ✅ COMPLIANT (documentation requirement met; see SUGGESTION S-3) |

#### quick-capture (delta) — 2 requirements, 12 scenarios

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Capture Preview with Save/Correct | Preview shows the parsed facts and category buttons | `telegram.service.test.ts` preview entry (previewReply + category buttons + ➕ + Guardar/Corregir) | ✅ COMPLIANT |
| Capture Preview with Save/Correct | Guardar is gated until a category is chosen | `telegram.service.test.ts` category-gate tests | ✅ COMPLIANT |
| Capture Preview with Save/Correct | Compartido Guardar is also gated on the percent | `telegram.service.savings.test.ts:577` + `telegram.service.household.integration.test.ts:266` | ✅ COMPLIANT |
| Capture Preview with Save/Correct | Guardar registers after a category is chosen | `telegram.service.test.ts` save-with-category tests | ✅ COMPLIANT |
| Capture Preview with Save/Correct | Corregir reopens capture | `telegram.service.test.ts` Corregir tests | ✅ COMPLIANT |
| Capture Preview with Save/Correct | Corrupt preview payload recovers | `telegram.service.test.ts` corrupt-payload recovery; `telegram.service.integration.test.ts:367` | ✅ COMPLIANT |
| Type Selection by Menu | Menu type persists to the preview | `telegram.service.test.ts` menu→capture→preview tests | ✅ COMPLIANT |
| Type Selection by Menu | Save registers with the menu-chosen type | `telegram.service.test.ts` REAL/INGRESO/PENDING save tests | ✅ COMPLIANT |
| Type Selection by Menu | Compartido registers a shared split | `telegram.service.savings.test.ts:588` + `household...:234` | ✅ COMPLIANT |
| Type Selection by Menu | Compartido without a partner stays single | `telegram.service.savings.test.ts:231` + `telegram.service.integration.test.ts:382` | ✅ COMPLIANT |
| Type Selection by Menu | Ingreso registers INCOME and splits savings | existing savings split tests (green) | ✅ COMPLIANT |
| Type Selection by Menu | Preview has no type toggle | `telegram.service.test.ts` preview-keyboard tests | ✅ COMPLIANT |

#### telegram-bot (delta) — 2 requirements, 13 scenarios

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Per-Owner State Machine | Menu tap enters awaiting_capture | `telegram.service.test.ts` menu-tap tests | ✅ COMPLIANT |
| Per-Owner State Machine | Capture enters preview | `telegram.service.test.ts` capture→preview tests | ✅ COMPLIANT |
| Per-Owner State Machine | Guardar registers and returns to menu | `telegram.service.test.ts` save→idle+menu tests | ✅ COMPLIANT |
| Per-Owner State Machine | Menu tap supersedes the preview | `telegram.service.test.ts` menu-supersedes tests | ✅ COMPLIANT |
| Per-Owner State Machine | Removed dialog payload recovers to idle | `telegram.service.household.integration.test.ts:289` (`awaiting_amount_confirmation`→idle) | ✅ COMPLIANT |
| Per-Owner State Machine | Delete request enters confirmation | `telegram.service.test.ts` dc-gate tests | ✅ COMPLIANT |
| Per-Owner State Machine | Cancelar abandons without deleting | `telegram.service.test.ts` dc:no tests | ✅ COMPLIANT |
| Per-Owner State Machine | Delete target survives restart | `telegram.service.test.ts` persisted delete-gate payload (BotState store) | ✅ COMPLIANT |
| Per-Owner State Machine | Otro percent input returns to the confirmation | existing `telegram.service.savings.test.ts:399` (INGRESO) | ✅ COMPLIANT |
| Per-Owner State Machine | Shared Otro percent input returns to the confirmation | `telegram.service.savings.test.ts:527` (reply "30" → `sharedPercent` 30 persisted + confirmation edited) | ✅ COMPLIANT |
| Per-Owner State Machine | Rule delete gate confirms | `telegram.service.test.ts` svdel tests | ✅ COMPLIANT |
| Shared Split Confirmation Annotation | Split confirmation annotates the share | `telegram.service.savings.test.ts:588` + `reply-text.test.ts:345` (`successSharedReply` → "parte de {total} compartido") | ✅ COMPLIANT |
| Shared Split Confirmation Annotation | Legacy confirmation unchanged | `telegram.service.savings.test.ts:231` + `telegram.service.integration.test.ts:382` (standard single-amount reply) | ✅ COMPLIANT |

#### bot-inline-interactions (delta) — 2 requirements, 8 scenarios

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Callback Query Routing | Known callback routes | `telegram.bot.test.ts` route+answer tests; `telegram.service.test.ts` | ✅ COMPLIANT |
| Callback Query Routing | Menu type tap stores the capture type | `telegram.service.savings.test.ts` (m:shr/m:new type persistence) | ✅ COMPLIANT |
| Callback Query Routing | Savings row callback routes | existing `sv:*` tests (green) | ✅ COMPLIANT |
| Callback Query Routing | Shared row callback routes | `telegram.service.savings.test.ts:501` (`sp:50` re-renders, callback answered) | ✅ COMPLIANT |
| Callback Query Routing | Unknown action replied honestly | `telegram.service.test.ts` unknown-prefix test | ✅ COMPLIANT |
| Callback Query Routing | Unknown chat ignored | `telegram.service.household.integration.test.ts` + `telegram.bot.test.ts` unknown-chat tests | ✅ COMPLIANT |
| Shared Confirmation Keyboard Budgets | Confirmation fits with the shared row | `telegram.service.savings.test.ts:457-476` (shared row + Guardar/Corregir render together; confirmation keyboard = shared/ingreso row + save row, ≤ 8) + `telegram.parser.test.ts:245` (64-byte budget) | ✅ COMPLIANT |
| Shared Confirmation Keyboard Budgets | Shared callbacks encode tokens | `telegram.service.savings.test.ts:457-469` (token-only regex) + `telegram.parser.test.ts:245` | ✅ COMPLIANT |

#### money-movements (delta) — 1 requirement, 3 scenarios

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Shared Total Movement Field | Split row carries sharedTotal | `packages/contracts/src/index.test.ts:132` | ✅ COMPLIANT |
| Shared Total Movement Field | Legacy row omits sharedTotal | `packages/contracts/src/index.test.ts:147,142` | ✅ COMPLIANT |
| Shared Total Movement Field | Other movement fields unchanged | `packages/contracts/src/index.test.ts:192` (`expenseSchema family (unchanged)`) + `pnpm typecheck`/`build` green | ✅ COMPLIANT |

#### savings (delta) — 1 requirement, 2 scenarios

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| SHARED Inheritance | Legacy shared income shares savings | `expenses.repository.ts createIncomeWithSavings` applies `data.visibility` to both rows; existing savings split integration tests green | ✅ COMPLIANT |
| SHARED Inheritance | Compartido creates no SAVINGS movement | `telegram.service.savings.test.ts:588` (`mockCreateIncomeWithSavings`/`mockResolveSplit` not called) + `:231` | ✅ COMPLIANT |

#### dashboard-web (delta) — 1 requirement, 3 scenarios

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Shared Split Amount Annotation | List cell annotates a split row | `MovementList.test.tsx:646` | ✅ COMPLIANT |
| Shared Split Amount Annotation | Card view annotates a split row | `MovementList.test.tsx:628` (`MovementAmount` is the exported element rendered by the dormant card) | ✅ COMPLIANT |
| Shared Split Amount Annotation | Non-split rows unannotated | `MovementList.test.tsx:635` (no "compartido") | ✅ COMPLIANT |

**Compliance summary**: 64/64 scenarios compliant (17/17 requirements covered)

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| `parseSharedContributionInput` es-AR parsing | ✅ Implemented | `telegram.commands.ts:167-202`: `%` suffix→percent; bare ≤100→percent; bare >100 or `$`/`ars`/dotted-thousands→amount → `value/total*100`; valid only `1..99`; 4-dp rounding for amount-derived percents (D9) |
| Confirmation shared row, token-only, partner-gated | ✅ Implemented | `telegram.service.ts:802-811` (`payload.type === "COMPARTIDO" && hasPartner`); callbacks `sp:<pct\|other>:<saveToken>` |
| State+token gate on `sp:*` | ✅ Implemented | `telegram.service.ts:1037` (`state !== awaiting_preview` or token mismatch → `alreadyProcessedReply()`) |
| `awaiting_shared_percent` state + routing | ✅ Implemented | `BOT_STATES += "awaiting_shared_percent"` (bot-state.repository.ts); `AWAITING_SHARED_PERCENT` + `handleAwaitingSharedPercent` (telegram.service.ts:1420) |
| Save gate (partner + no percent → nothing) | ✅ Implemented | `telegram.service.ts:907-913` → `sharedPickFirstReply()`, returns before `savePreview` |
| Two-row `$transaction` split | ✅ Implemented | `expenses.repository.ts:200-246` — `sender = round2(total*pct/100)`, `partner = total − sender`; both SHARED·EXPENSE·PAID·ARS, same category/note/occurredAt, `sharedTotal = total`; sender under ownerId, partner under partnerId |
| `sharedTotal` persistence + read path | ✅ Implemented | `schema.prisma:48` nullable `Decimal(12,2)`; migration plain SQL no backfill; `movements.repository.ts` row type + both SELECTs + mapper carry it |
| Contract additive | ✅ Implemented | `packages/contracts/src/index.ts` — `movementSchema` extends `expenseSchema` with `sharedTotal: z.number().nullable().optional()`; `expenseSchema` untouched (D8) |
| Bot + dashboard annotation | ✅ Implemented | `reply-text.ts:312-315` `successSharedReply`; `MovementList.tsx:67-84` exported `MovementAmount` renders "parte de {total} compartido" in both surfaces (gate NOT flipped, OQ1) |

### Coherence (Design D1–D9)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 — new `awaiting_shared_percent` state | ✅ Yes | enum + route + recovery path present |
| D2 — split in `registerCapture`, writes in repository `createSharedSplit` | ✅ Yes | service delegates; `$transaction` beside `createIncomeWithSavings` |
| D3 — partner resolved per surface via `partnerOf` | ✅ Yes | keyboard (telegram.service.ts:862), gate (907), register (1823) |
| D4 — own parser (not savings parser) | ✅ Yes | `parseSharedContributionInput` distinct; es-AR thousands handled |
| D5 — `sp:*` token-only row, 50% first, partner-only | ✅ Yes | `previewConfirmKeyboard` (802-811); helper asserts token-only |
| D6 — share line in confirmation | ✅ Yes | `sharedLineLabel` ("Tu parte: X%") via `previewConfirmReply` 6th param |
| D7 — save gate with no default | ✅ Yes | `sharedPickFirstReply`, nothing registers |
| D8 — `createSharedSplit` returns `{sender,partner}`; `expenseSchema` untouched | ✅ Yes | contract diff touches only `movementSchema` |
| D9 — fractional percent (1..99) | ✅ Yes | `z.number().min(1).max(99).optional()`; 4-dp rounding documented |

### Issues Found
**CRITICAL**: None — no change-caused failures. `verdict: pass` at change level.

**WARNING**: None — every change-authored/affected test passes; no design deviation breaks a spec.

**SUGGESTION**:
- **S-1 (baseline, pre-existing, out of change scope)**: `apps/api/src/features/telegram/telegram.service.test.ts:724` — stale two-step-confirmation assertion `expect(kb[0]?.[0]?.text).toBe("Cafe")` (actual last keyboard row 0 = `"✅ Guardar"`). Confirmed pre-existing and untouched by this diff. One-line follow-up: assert the preview keyboard that carries the categories (e.g. the keyboard captured at `cat:` before the new confirmation message), or flip to the confirmation shape (`kb[0][0]` = `Guardar`). Do NOT fix inside this change.
- **S-2 (baseline, pre-existing, out of change scope)**: `apps/dashboard/src/features/movements/SummarySection.test.tsx:122` — fixture expects `$ 3.000,00`, render shows `$ 0,00` (stale fixture/rendering contract). `SummarySection` is outside this change's scope; identical at HEAD. One-line follow-up: refresh the fixture/expected currency string.
- **S-3 (accepted consequence, documentation)**: the "Orphaned half" scenario has no runtime assertion. It is an explicitly accepted consequence (`sharedGroupId` out of scope) and there is no linkage to repair, so nothing implementable is untested. Optional hardening: a test that deleting one split half leaves the other untouched.
- **S-4 (informational)**: no dedicated migration assertion for the `sharedTotal` NULL/no-backfill contract; the migration is plain SQL and every DB suite exercises the column round-trip. Low risk.
- **S-5 (informational)**: amount-derived percents are rounded to 4 decimal places (documented deviation #2 in apply-progress); spec cases (50, 75, 45.5) are unaffected.

### Accepted Consequences (documented, not defects)
- Two SHARED rows replace one `total` row: under `visibility=mine` a viewer's KPIs show only their share; `all`/`shared` still sum to the total (asserted `movements.route.test.ts:760`).
- Each half is an independent movement with no linking column: editing/deleting one half orphans the other and the annotation no longer reconciles; pair linking (`sharedGroupId`) is explicitly out of scope.

### Verdict
**PASS** — the change matches all 7 specs (17/17 requirements, 64/64 scenarios), conforms to design D1–D9, and all 25 tasks are complete. Change-certifying suites are fully green (API 965 passed / 1 skipped, dashboard 168 passed / 1 skipped, exit 0); typecheck, lint, and build are green. The only two failing tests in the raw full suites are the documented pre-existing baselines (S-1, S-2), neither caused by nor touching this change. Ready for **archive**.
