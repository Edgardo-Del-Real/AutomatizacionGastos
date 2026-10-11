```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a615ba2076d842e259b298936af488562ea1ce1edb6d5eddaf656f60aac539c8
verdict: pass
blockers: 0
critical_findings: 0
requirements: 15/15
scenarios: 58/58
test_command: pnpm --filter @rita/api test && pnpm --filter @rita/dashboard test
test_exit_code: 0
test_output_hash: sha256:326e10faec999c79260eebe2171799beedd79a362f36fe9f006617d037e9745d
build_command: pnpm --filter @rita/api typecheck && pnpm --filter @rita/dashboard typecheck && pnpm --filter @rita/api lint && pnpm --filter @rita/dashboard lint
build_exit_code: 0
build_output_hash: sha256:f7deb85da073f24c393c062366528b3fc4599f1abbd06a554c92c97fe85afcaf
```

# Verification Report — conversational-categories

**Change**: conversational-categories
**Version**: N/A (delta specs)
**Mode**: Strict TDD (runner: vitest via pnpm workspaces)
**Date**: 2026-09-28
**Verifier**: sdd-verify sub-agent (independent requirements/runtime final verification)
**Repo**: AutomatizacionRita (C:\Users\user\Desktop\AutomatizacionRita), HEAD `4c88c42`, change = 5 work-unit commits (68a085a, c5d50b5, 62ba724, 1a78e4c, 4c88c42); NOT pushed, no PR.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 17 |
| Tasks complete | 17 |
| Tasks incomplete | 0 |
| Specs (deltas) | 5 |
| Requirements (actual, counted from specs) | 15 |
| Scenarios (actual, counted from specs) | 58 |

## Build & Tests Execution

**Tests**: ✅ 886/886 API (37 files) + 161/161 dashboard (23 files) = 1047/1047 passed; 0 failed; 0 skipped (two independent runs, both green).

```text
pnpm --filter @rita/api test
  Test Files  37 passed (37)
  Tests       886 passed (886)
  Duration    50.85s
pnpm --filter @rita/dashboard test
  Test Files  23 passed (23)
  Tests       161 passed (161)
  Duration    35.38s
exit codes: 0 / 0
```

**Build gates**: ✅ typecheck + lint clean on both apps (exit 0 for all four commands).

```text
pnpm --filter @rita/api typecheck      → exit 0
pnpm --filter @rita/dashboard typecheck → exit 0
pnpm --filter @rita/api lint           → exit 0
pnpm --filter @rita/dashboard lint     → exit 0
```

**Coverage**: ➖ Not available (no coverage tool configured for these workspaces; not a failure).

## Spec Compliance Matrix

Spec scenario counts verified by source inspection against the actual specs (15 requirements, 58 scenarios total). Every scenario maps to at least one covering test that passed at runtime.

### conversational-categories (5 requirements, 14 scenarios)

| Requirement | Scenario | Covering test (all passed) | Result |
|-------------|----------|------|--------|
| Reserved Concept Guard | Reserved create rejected on any path | `categories.service.integration.test.ts` "rejects creating the reserved concept gastos fijos with the gasto fijo concept and creates nothing" + `telegram.service.test.ts` "rejects a reserved single-token answer with a redirect and keeps the correction open" | ✅ COMPLIANT |
| Reserved Concept Guard | Guard-only alias | `categories.service.integration.test.ts` it.each `["provisto", "previsto"]` (alias inside guard only) | ✅ COMPLIANT |
| Reserved Concept Guard | ahorros redirects to SAVINGS | `categories.service.savings.integration.test.ts` "rejects ahorros with a reserved error: no category, no SAVINGS upsert, no NORMAL" + "keeps exact ahorro routed to the SAVINGS upsert" | ✅ COMPLIANT |
| Reserved Concept Guard | Rename to reserved rejected | `categories.service.integration.test.ts` "rejects renaming a category TO a reserved concept and leaves the name unchanged" | ✅ COMPLIANT |
| Tolerant Plural Matching | Plural phrase matches both ways | `matcher.test.ts` "matches a plural note against a singular keyword (gastos fijos ↔ gasto fijo)" + "matches a singular note against a plural keyword" | ✅ COMPLIANT |
| Tolerant Plural Matching | Ordered rules fold correctly | `matcher.test.ts` "folds -ses plurals onto their short singular (meses→mes)", "folds vowel+s plurals by stripping the s, never -es (cafes→cafe)", "folds single-token plurals: cafes matches the cafe keyword (never caf)" | ✅ COMPLIANT |
| Tolerant Plural Matching | Excluded words unchanged | `matcher.test.ts` "leaves excluded words unchanged (lunes, crisis, frances, pais, dios)" | ✅ COMPLIANT |
| Tolerant Plural Matching | Short singulars preserved | `matcher.test.ts` "folds pies to pie and never folds the 3-letter singular mes" | ✅ COMPLIANT |
| Duplicate-Variant Rejection | Variant create rejected | `categories.service.integration.test.ts` "rejects a duplicate-variant create naming the existing category" (transporte/transportes; gastos-fijos pair shadowed by reserved guard — see deviations) | ✅ COMPLIANT |
| Duplicate-Variant Rejection | Variant rename rejected | `categories.service.integration.test.ts` "rejects a duplicate-variant rename when the folded target already exists" (cafe/cafes) | ✅ COMPLIANT |
| Gated Dialog Auto-Create | Passing token auto-creates | `telegram.service.integration.test.ts` "correction: an unknown single-word answer auto-creates the category and applies it" | ✅ COMPLIANT |
| Gated Dialog Auto-Create | Reserved token rejected | `telegram.service.test.ts` "rejects a reserved single-token answer with a redirect and keeps the correction open" (state untouched, movement stays "otro") | ✅ COMPLIANT |
| Suggester Ceiling | Suggestion never creates | `telegram.service.test.ts` "falls to otro and offers correction when the brain category is unknown, never auto-creating it" + "keeps resolveSuggestion EXACT: a plural brain suggestion never matches its singular category" | ✅ COMPLIANT |
| Suggester Ceiling | Planned flag is a suggestion only | `telegram.service.test.ts` "materializes a brain planned:true flag as a PENDING EXPENSE without any prefix" (deterministic guarded path; brain never writes) | ✅ COMPLIANT |

### movement-categories (3 requirements, 15 scenarios)

| Requirement | Scenario | Covering test (all passed) | Result |
|-------------|----------|------|--------|
| Keyword Learning and Matching | Word-boundary match | `matcher.test.ts` "does NOT match inside a larger word (cafe2go)" | ✅ COMPLIANT |
| Keyword Learning and Matching | Diacritic-insensitive match | `matcher.test.ts` "is diacritic-insensitive: accented note matches plain keyword" | ✅ COMPLIANT |
| Keyword Learning and Matching | First rule wins | `matcher.test.ts` "oldest-learned rule wins when a note contains both keywords (D4)" | ✅ COMPLIANT |
| Keyword Learning and Matching | No rule falls back | `matcher.test.ts` "returns null when no rule matches" | ✅ COMPLIANT |
| Keyword Learning and Matching | Plural variant matches both ways | `matcher.test.ts` "matches a plural note against a singular keyword (gastos fijos ↔ gasto fijo)" + "matches a singular note against a plural keyword" | ✅ COMPLIANT |
| Keyword Learning and Matching | Single-token plural folds | `matcher.test.ts` "folds single-token plurals: cafes matches the cafe keyword (never caf)" | ✅ COMPLIANT |
| Category Type | ahorro is always SAVINGS | `categories.service.savings.integration.test.ts` "creates 'ahorro' as a SAVINGS category, never NORMAL" | ✅ COMPLIANT |
| Category Type | Normal categories stay NORMAL | `categories.service.savings.integration.test.ts` "keeps normal categories NORMAL" | ✅ COMPLIANT |
| Category Type | Legacy ahorro converts, movements untouched | `savings.migration.integration.test.ts` "converts the legacy ahorro category to SAVINGS" + "preserves existing movements as EXPENSE" | ✅ COMPLIANT |
| Category Type | Delete and rename guards | `categories.service.savings.integration.test.ts` "rejects deleting the SAVINGS ahorro category" + "rejects renaming the SAVINGS ahorro category" + "rejects renaming a normal category TO ahorro" | ✅ COMPLIANT |
| Category Type | Plural ahorros rejected, never SAVINGS | `categories.service.savings.integration.test.ts` "rejects ahorros with a reserved error: no category, no SAVINGS upsert, no NORMAL" | ✅ COMPLIANT |
| Reserved and Duplicate-Variant Guards | Reserved create rejected | `categories.service.integration.test.ts` it.each over gastos fijos/previsto/provisto/compartido/compartida/otro + folded plurals (previstos, otros, compartidos, compartidas) | ✅ COMPLIANT |
| Reserved and Duplicate-Variant Guards | Reserved rename rejected | `categories.service.integration.test.ts` "rejects renaming a category TO a reserved concept and leaves the name unchanged" | ✅ COMPLIANT |
| Reserved and Duplicate-Variant Guards | Duplicate-variant create rejected | `categories.service.integration.test.ts` "rejects a duplicate-variant create naming the existing category" | ✅ COMPLIANT |
| Reserved and Duplicate-Variant Guards | Phantoms stay deletable | `categories.service.integration.test.ts` "phantoms stay deletable: a pre-change reserved-name category can be deleted" | ✅ COMPLIANT |

### savings (1 requirement, 4 scenarios)

| Requirement | Scenario | Covering test (all passed) | Result |
|-------------|----------|------|--------|
| Tolerant Rule Matching | Plural variant matches | `savings.service.test.ts` "matches a plural note against a singular rule keyword (sueldos ↔ sueldo)" — note text exactly `cobré sueldos 1000` as the spec states; plus `telegram.service.savings.test.ts` "money pin: 'cobro sueldos' splits against a stored sueldo rule through the REAL savings service" (INCOME 900 / SAVINGS 100 on gross 1000) | ✅ COMPLIANT |
| Tolerant Rule Matching | Brand stays self-consistent | `savings.service.test.ts` "matches a word-boundary keyword... (entrenuts)" + "does not match a keyword inside another word (boundary)" — entrenut singular now matches, `entrenutsa` never matches | ✅ COMPLIANT |
| Tolerant Rule Matching | Stored keyword unchanged | `savings.service.test.ts` "stores the keyword literal-normalized through defineRule and matches both variants later" (stored `sueldos`, notes `sueldo`/`sueldos` both match) | ✅ COMPLIANT |
| Tolerant Rule Matching | Split arithmetic unchanged | `savings.service.test.ts` "splits 10 at 33% into 3.30 savings and 6.70 net, preserving the invariant exactly" | ✅ COMPLIANT |

### telegram-bot (2 requirements, 9 scenarios)

| Requirement | Scenario | Covering test (all passed) | Result |
|-------------|----------|------|--------|
| Guarded Category Creation Funnel | registrar command redirected | `telegram.service.test.ts` "redirects a reserved 'registrar categoria: previsto' with the previsto teaching and creates nothing" | ✅ COMPLIANT |
| Guarded Category Creation Funnel | Dialog auto-create gated | `telegram.service.test.ts` "rejects a reserved single-token answer with a redirect and keeps the correction open" | ✅ COMPLIANT |
| Guarded Category Creation Funnel | then_reassign gated | `telegram.service.test.ts` "gates then_reassign on a reserved create: redirect reply, no category, no reassignment, dialog stays open" (state `awaiting_category`, mov-9 preserved) | ✅ COMPLIANT |
| Guarded Category Creation Funnel | Setup entry gated | `telegram.service.test.ts` "gates setup entries: 'Cafe, gastos fijos' creates Cafe and redirects the reserved gastos fijos" (setupDoneWithRedirectsReply) | ✅ COMPLIANT |
| Planned Expense Registration | previsto registers a planned expense | `telegram.service.test.ts` "registers 'previsto: 2500 alquiler' as a PENDING EXPENSE deterministically (brain-absent)" + `telegram.service.integration.test.ts` "planned e2e: previsto: registers PENDING EXPENSE rows..." | ✅ COMPLIANT |
| Planned Expense Registration | previsto composes with compartido | `telegram.service.test.ts` "composes previsto: with compartido: in any order" (both orders) | ✅ COMPLIANT |
| Planned Expense Registration | brain-absent path | `telegram.service.test.ts` "registers 'previsto: 2500 alquiler' as a PENDING EXPENSE deterministically (brain-absent)" + "brain-absent path: a planned phrasing WITHOUT the prefix never becomes PENDING (prefix is the only producer)" | ✅ COMPLIANT |
| Planned Expense Registration | Prefix wins over the flag | `telegram.service.test.ts` "lets the previsto: prefix beat a brain planned:false flag" + `telegram.service.integration.test.ts` "planned e2e: the previsto: prefix beats a brain planned:false flag" (DB-verified PENDING) | ✅ COMPLIANT |
| Planned Expense Registration | Flag alone registers PENDING with the brain | `telegram.service.test.ts` "materializes a brain planned:true flag as a PENDING EXPENSE without any prefix" + `telegram.service.integration.test.ts` "planned e2e: a brain planned:true flag (no prefix) registers a PENDING EXPENSE through the guarded path" (DB-verified) | ✅ COMPLIANT |

### bot-brain (4 requirements, 16 scenarios)

| Requirement | Scenario | Covering test (all passed) | Result |
|-------------|----------|------|--------|
| Bot Brain Port | Valid interpretation | `bot-brain.test.ts` "returns the envelope for a string amount payload (happy path)" | ✅ COMPLIANT |
| Bot Brain Port | Dialog context supplied | `bot-brain.test.ts` "embeds the dialog addendum, the rendered context and the dialog few-shots when a context is supplied" | ✅ COMPLIANT |
| Bot Brain Port | Missing key means no brain | Wiring `apps/api/src/app.ts` constructs `GroqBotBrain` only when `env.GROQ_API_KEY !== undefined`; `env.test.ts` "defaults LLM_MODEL... and leaves GROQ_API_KEY unset" + integration tests run with default no-brain | ✅ COMPLIANT |
| Interpret Envelope Contract | Envelope decodes strict JSON | `bot-brain.test.ts` "normalizes a Spanish string amount and keeps category and note" (5 mil → 5000) | ✅ COMPLIANT |
| Interpret Envelope Contract | Mixed-intent envelope decodes | `bot-brain.test.ts` "decodes a mixed-intent envelope with then_reassign true (create + reassign)" | ✅ COMPLIANT |
| Interpret Envelope Contract | Unknown intent degrades | `bot-brain.test.ts` "rejects an unknown intent" | ✅ COMPLIANT |
| Interpret Envelope Contract | Savings-rule intent decodes | `bot-brain.test.ts` "decodes a create_savings_rule envelope carrying the keyword and percent phrasing" | ✅ COMPLIANT |
| Interpret Envelope Contract | Planned query intent decodes | `bot-brain.test.ts` "decodes a query_planned envelope (spec: Planned query intent decodes)" | ✅ COMPLIANT |
| Interpret Envelope Contract | Planned flag decodes | `bot-brain.test.ts` "carries planned: true on a register_expense envelope" + "defaults an absent planned flag to false" + "degrades to null for a malformed planned value" | ✅ COMPLIANT |
| Category Suggestion Contract | Suggestion is a suggestion only | `telegram.service.test.ts` "falls to otro and offers correction when the brain category is unknown, never auto-creating it" + "keeps resolveSuggestion EXACT: a plural brain suggestion never matches its singular category" | ✅ COMPLIANT |
| Category Suggestion Contract | Planned flag is a suggestion only | `telegram.service.test.ts` "materializes a brain planned:true flag as a PENDING EXPENSE without any prefix" (deterministic path only; brain never creates status) + prompt-contract "teaches conversational planned phrasings... Es una SUGERENCIA" | ✅ COMPLIANT |
| Prompt Contract | Prompt drift fails CI | `bot-brain.test.ts` "pins the interpret system prompt" (golden snapshot; all 8 goldens pinned, suite green) | ✅ COMPLIANT |
| Prompt Contract | Dialog prompt variant pinned | `bot-brain.test.ts` "pins the awaiting_category dialog addendum" + "pins the awaiting_category dialog few-shots" + amount-confirmation pair | ✅ COMPLIANT |
| Prompt Contract | Prompt changes regenerate goldens in-cycle | Commit `1a78e4c` regenerated all 8 goldens via `vitest -u`; only `interpret-system-prompt.txt` (+planned key/instruction) and `interpret-few-shots.json` (+planned few-shot) changed bytes; 6 byte-identical; snapshot tests pass | ✅ COMPLIANT |
| Prompt Contract | Planned-query prompt instruction pinned | `bot-brain.test.ts` "classifies planned-query phrasings into query_planned in the interpret prompt" + golden byte-match | ✅ COMPLIANT |
| Prompt Contract | Planned-flag prompt instruction pinned | `bot-brain.test.ts` "documents the planned flag in the interpret JSON key list" + "teaches conversational planned phrasings to set planned: true on register_expense" + "teaches the previsto: prefix as authoritative and never duplicated" + golden byte-match | ✅ COMPLIANT |

**Compliance summary**: 58/58 scenarios compliant (all with passing runtime tests).

## Correctness (Static Evidence)

| Requirement area | Status | Notes |
|------------|--------|-------|
| Reserved Concept Guard (choke point) | ✅ Implemented | `categories.service.ts` createCategory: exact-ahorro → SAVINGS upsert → folded reserved guard → folded availability → create; renameCategory guards before availability; error = `ReservedCategoryError` (concept discriminator) |
| Guard-only alias provisto→previsto | ✅ Implemented | `reserved.ts` `RESERVED_ALIASES` applied only in `resolveReservedConcept`; general matching never sees it |
| ahorros → SAVINGS redirect, no upsert | ✅ Implemented | folded `ahorros`∈reserved set → reject before availability; exact `ahorro` keeps `ensureAhorro` (integration-verified: no category, no SAVINGS upsert, no NORMAL) |
| Tolerant plural fold | ✅ Implemented | `matcher.ts` `foldSpanishPluralToken` (len≥4, exclusion list incl. app additions, specials, 13 ordered rules, single application) + `normalizeForMatchTolerant`; `normalizeForMatch`/`boundaryRegex` byte-identical (exports unchanged) |
| Duplicate-variant rejection | ✅ Implemented | `assertNameAvailable` folded; error names the EXISTING category |
| Savings tolerant matchNote | ✅ Implemented | `savings.service.ts` matchNote folds note + keyword; `defineRule` stores literal normalized; `computeSplit` untouched (arithmetic tests unchanged and passing) |
| Gated dialog auto-create | ✅ Implemented | `d6AwaitingCategory`/`resolveAwaitingCategory`: exact → folded → guarded single-token create; reserved reject keeps correction open; multi-word lists categories |
| Suggester ceiling | ✅ Implemented | `resolveSuggestion` exact `normalizeForMatch` only, "otro" → null; brain never creates; planned materializes only in deterministic tails |
| Envelope planned + prompt | ✅ Implemented | `bot-brain.ts` envelope `planned?: boolean`, schema `z.boolean().default(false)`; prompt key list + planned teaching + few-shot; `CategoryCommandErrorCode` `"reserved"` |
| Planned merge (prefix beats flag) | ✅ Implemented | `executeRegistration` `planned \|\| envelope.planned === true`; `registerWithCategory` forced EXPENSE + PENDING, never splits; payload persists planned |
| Movement-corrector reserved short-circuit | ✅ Implemented | `resolveTargetCategory` exact → folded → guarded create; `{status:"rejected", concept, name}` before listing/scoring |
| Executor + reply redirects | ✅ Implemented | `category-executor.ts` catches ReservedCategoryError BEFORE ValidationFailedError → code `"reserved"`; `reservedCategoryReply(name, concept)` per concept |
| Phantoms deletable / delete untouched | ✅ Implemented | `deleteCategory` unchanged (exact "otro" + SAVINGS guards only); integration test deletes pre-change `previsto` phantom |

## Coherence (Design)

| Decision (design.md) | Followed? | Evidence |
|----------|-----------|-------|
| D1 — tolerant fold as separate function; literal exports untouched | ✅ Yes | `normalizeForMatchTolerant`/`foldSpanishPluralToken` added; `normalizeForMatch`/`boundaryRegex` byte-identical (git diff shows no change to those exports) |
| D2 — rule set verbatim research §5.2 | ✅ Yes | 13 ordered rules 0–13 in exact order; exclusion list = S6 verbatim + app additions; specials list §5.3; single application |
| D3 — reserved guard after exact-ahorro, before availability | ✅ Yes | `createCategory`/`renameCategory` order verified in source |
| D4 — ReservedCategoryError extends ValidationFailedError + concept | ✅ Yes | `reserved.ts` class definition |
| D5 — assertNameAvailable folded; error names existing | ✅ Yes | error message `Category "${existing.name}" already exists` |
| D6 — variant resolution exact → folded before auto-create; resolveSuggestion stays exact | ✅ Yes | dialog cascade + `resolveTargetCategory` + `resolveSuggestion` (exact-only) |
| D7 — envelope planned mirror of shared; OR merge | ✅ Yes | `planned \|\| envelope.planned === true`; schema `z.boolean().default(false)` |
| D8 — LLM ceiling: resolveSuggestion exact + otro fallback | ✅ Yes | exact match only; "otro" → null; no auto-create from suggestions |
| Goldens regenerated in-cycle | ✅ Yes | Commit 1a78e4c: 8 goldens regenerated, only 2 changed bytes (interpret-system-prompt.txt, interpret-few-shots.json); 6 byte-identical |
| Delete untouched; phantoms deletable | ✅ Yes | deleteCategory unchanged; phantom delete integration test passes |
| Redirect replies per concept | ✅ Yes | `reservedCategoryReply` branches match design wording (previsto/gasto fijo/ahorro/compartido/otro) |

## TDD Compliance (Strict TDD Module)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | TDD Cycle Evidence table present in apply-progress, 17/17 rows |
| All tasks have tests | ✅ | 17/17 tasks map to existing test files (verified by source inspection) |
| RED confirmed (tests exist) | ✅ | All referenced test files exist; RED written in 8 tasks, RED-via-paired-test-task for 9 implementation tasks (documented `N/A (RED via X)` convention within each work unit) |
| GREEN confirmed (tests pass) | ✅ | Full suites re-run independently: API 886/886, dashboard 161/161 |
| Triangulation adequate | ✅ | 13 rule-case fold table + 5 excluded words + boundary + per-path funnel + per-concept guards + money pin + DB e2e |
| Safety Net for modified files | ✅ | Pre-modification counts recorded per task (12/12, 27/27, 39/39, 23/23, 153/153, 199/199, 10/10, 8/8, 14/14+52/52, 36/36); new files marked N/A |

**TDD Compliance**: 17/17 checks passed

### Test Layer Distribution

| Layer | Tests (changed-file new cases) | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~53 new declarations (46 claimed; it.each blocks expand further) | 8 files | vitest (no external tools needed) |
| Integration | DB-backed guards, savings money pin, planned e2e | 3 files | vitest + Postgres 5433 |
| E2E | — | — | not installed (bot flows covered by integration) |
| **Total** | **1047 passing** (886 api + 161 dashboard) | **60** (37 + 23) | |

### Changed File Coverage

Coverage analysis skipped — no coverage tool configured in either workspace (`vitest run` without coverage provider). Not a failure.

### Assertion Quality

✅ All assertions verify real behavior — no tautologies, no ghost loops, no smoke-only tests, no type-only-alone assertions found across the 11 changed test files. Assertions use concrete expected values (fold tables, formatted ARS amounts, DB row counts, persisted state shapes) and negative controls (cafe2go, cafeteria, entrenutsa, malformed planned).

### Quality Metrics

**Linter**: ✅ No errors (api + dashboard exit 0)
**Type Checker**: ✅ No errors (api + dashboard exit 0)

## Documented Deviations — Adjudication

The apply-progress documents 3 deviations; each was verified against the actual spec scenarios and ruled:

1. **Duplicate-variant "gastos fijos" scenario shadowed by the reserved guard** → **COMPLIANT**. Spec scenario (Duplicate-Variant Rejection "Variant create rejected", movement-categories "Duplicate-variant create rejected") requires the outcome "rejected and no duplicate is created". At runtime `createCategory("gastos fijos")` IS rejected with no category created — via the reserved guard (concept "gasto fijo"), which the specs themselves mandate ("Reserved Concept Guard" and the movement-categories ADDED requirement both list `gastos fijos` in the reserved set; reserved check runs before availability per the spec's own priority wording "Rejections MUST NOT create any category"). The folded-availability mechanism is pinned with the non-reserved pair `transporte`/`transportes` (create) and `cafe`/`cafes` (rename), all passing. The scenario's observable contract holds; no finding.

2. **Telegram money-pin uses "cobro sueldos" instead of "cobré sueldos"** → **COMPLIANT**. The savings spec scenario's text `cobré sueldos` is pinned VERBATIM at the `matchNote` level (`savings.service.test.ts` "matches a plural note against a singular rule keyword (sueldos ↔ sueldo)" → resolves 10), which is the layer the scenario exercises ("WHEN an income note is matched"). The telegram-layer pin uses `cobro sueldos 1000` because the arrival parser (untouched by this change) classifies `cobré` as EXPENSE; the pin's purpose — proving the split through the real service — holds (INCOME 900 / SAVINGS 100). No spec behavior is missed.

3. **`reservedCategoryReply` includes the attempted name in every concept branch** → **COMPLIANT**. No spec or design requirement prohibits the name; design's per-concept wording is preserved verbatim inside each branch (`reply-text.ts` verified); the name prefix is an additive clarity choice consistent with the spec's "educational redirect" intent.

None of the three breaks a spec; all are documented and test-verified. Listed as SUGGESTIONS below for spec-documentation polish only.

## Issues Found

**CRITICAL**: None

**WARNING**: None

**SUGGESTION**:
1. Spec polish (both specs): the "Variant create rejected" scenarios use the reserved pair `gasto fijo`/`gastos fijos`, which the reserved guard shadows by design. Consider a one-line spec note ("reserved-first wins; the duplicate-variant mechanism is pinned with non-reserved pairs") so future readers understand the fixture choice.
2. Spec polish (savings): the telegram-layer money pin text differs from the scenario wording (`cobro` vs `cobré`) because the parser domain is untouched; the `matchNote`-level pin matches the spec verbatim. Consider noting the layer split.
3. Environment: pre-existing Windows flakes (prisma EPERM on `generate`, cold migration-pin timeout) were warm-passing in both runs; confirmed not regressions introduced by this change.

## Rollback Note

Change is NOT pushed and has no PR: rollback = revert the 5 local work-unit commits (68a085a matcher fold, c5d50b5 reserved guards, 62ba724 savings tolerant, 1a78e4c envelope+goldens, 4c88c42 telegram funnel) or `git reset --hard ee8673d` (the base). No DB migration exists; stored keywords, names, and uniques are unchanged; `deleteCategory` gained no new reserved names, so pre-change phantoms remain deletable. Per-PR revert boundaries are documented in tasks.md and apply-progress Work Unit Evidence.

## Verdict

**PASS** — 15/15 requirements, 58/58 scenarios compliant with passing runtime tests; API 886/886 + dashboard 161/161 green; typecheck + lint clean; 0 blockers, 0 critical, 0 warnings; 3 documented deviations adjudicated COMPLIANT.