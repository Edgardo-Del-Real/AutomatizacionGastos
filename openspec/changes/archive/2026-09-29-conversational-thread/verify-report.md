```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:de51276576ba9dca99d29cd4ef04e375e6fb4ab6c2be9cdeda1504f7a9ed15a2
verdict: pass
blockers: 0
critical_findings: 0
requirements: 18/18
scenarios: 81/81
test_command: pnpm --filter @rita/api test
test_exit_code: 0
test_output_hash: sha256:7cdd6fa6ad1cbdc3a7dcffa42a7d875752a15cc5e277511ecdd7b2654920d499
build_command: pnpm --filter @rita/contracts build
build_exit_code: 0
build_output_hash: sha256:e06be89e9f814cc6f50623cff9519f13d3dce96cbb55892263013598af8fd967
```

## Verification Report

**Change**: conversational-thread
**Version**: N/A (delta specs)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 28 |
| Tasks complete | 28 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: ✅ Passed
```text
pnpm --filter @rita/contracts build → tsc -p tsconfig.json → exit 0
build_output_hash: sha256:e06be89e9f814cc6f50623cff9519f13d3dce96cbb55892263013598af8fd967
```

**Tests**: ✅ 966 passed (37 files)
```text
pnpm --filter @rita/api test → vitest run (v4.1.10)
 Test Files  37 passed (37)
      Tests  966 passed (966)
   Duration  42.74s
test_output_hash: sha256:7cdd6fa6ad1cbdc3a7dcffa42a7d875752a15cc5e277511ecdd7b2654920d499
```
Full suite executed WITHOUT `-u` — all golden snapshot tests passed against committed goldens (no prompt drift).

**Typecheck**: `pnpm --filter @rita/api exec tsc -p tsconfig.json --noEmit` → exit 0, no errors.
**Lint**: `pnpm --filter @rita/api lint` (eslint src) → exit 0, no errors.

**Coverage**: ➖ Not available — no coverage tool configured in the verify contract; coverage analysis skipped (informational, not blocking).

### Hard Constraint Verification
| Constraint | Evidence | Result |
|------------|----------|--------|
| `awaiting_category` D6 suite green and byte-identical | SHA-256 of the D6 describe block (old file cd76387 lines 696-783 vs HEAD lines 774-861): `A62B90FAD25888D34E922D024D9BCA9BD1078CC77848BFD7F0CDE7475113E74D` on both — byte-identical; suite green in the 966/966 run | ✅ PASS |
| `awaiting_registration` never routes through `awaiting_category` resolvers | `d6DialogFallback` (:1343-1351) dispatches `AWAITING_CATEGORY`→`d6AwaitingCategory`, `AWAITING_REGISTRATION`→`d6AwaitingRegistration`; `resolveDialog` (:1398-1406) dispatches `AWAITING_CATEGORY`→`resolveAwaitingCategory`, `AWAITING_REGISTRATION`→`resolveAwaitingRegistration` — distinct branches, distinct resolvers | ✅ PASS |
| Greeting reversal spec-signed | telegram.service.test.ts:2342/2362/2378 (greeting idle, fixed fallback, dialog-open pending untouched); bot-brain.test.ts:1185 ("greeting is a separate intent"), :1192 ("deliberate reversal"), :1202 ("hola" → greeting flip), :1216 (never closes dialogs); off_topic never-chats pins at :1180 and :2308/:2327 | ✅ PASS |
| Goldens regenerated in-cycle | 2 new goldens committed (`dialog-awaiting-registration-addendum.txt`, `dialog-awaiting-registration-few-shots.json`); 3 regenerated; suite passes WITHOUT `-u`; golden pins at bot-brain.test.ts:1108-1156 | ✅ PASS |
| No Prisma migration | `git diff cd76387..HEAD --name-only` contains no `migration`/`prisma` paths; `pendingNote` JSON + zod is the version contract | ✅ PASS |
| Deterministic-only mode | T2/D8 tests: previsto: prefix enters collect (:966), compartido: prefix enters collect (:984), no-brain bare noun keeps helpReply (:1000) | ✅ PASS |

### Spec Compliance Matrix

**registration-collection (9 requirements / 18 scenarios)**

| Requirement | Scenario | Test (evidence) | Result |
|-------------|----------|-----------------|--------|
| Collect Dialog State and Payload | Payload persists collect facts | telegram.service.test.ts > "T1: an amount-null register_expense persists the collect payload…" (:886); "registrationCollectPayloadSchema" describe (:250) | ✅ COMPLIANT |
| Collect Dialog State and Payload | Correction semantics untouched | telegram.service.test.ts > "TelegramService ambiguity rules (awaiting_category, D6)" — byte-identical block, green in full suite | ✅ COMPLIANT |
| Deterministic Entry and Persistence | Amount-null entry persists | T1 (:886) + "T1: a planned amount-null registration persists the planned bit" (:920); source `executeRegistration` E1 (:446-462) persists + `askAmountReply` | ✅ COMPLIANT |
| Deterministic Entry and Persistence | Category-unresolved entry | "T2: a category-signal that resolves to nothing persists the amount and asks the category" (:937) + E2 brain-orchestration delta (:1591) | ✅ COMPLIANT |
| Deterministic Entry and Persistence | No category signal keeps otro | "rescues an unparseable amount and registers in otro with the correction offer" (:1768) — pre-existing, green | ✅ COMPLIANT |
| Amount-Answer Resolution | Amount answer completes the registration | "T4: an amount answer completes the registration from the stored context when the category is resolved" (:1039) | ✅ COMPLIANT |
| Amount-Answer Resolution | Amount answer keeps collecting | "T4: an amount answer keeps collecting by persisting the amount and asking the category" (:1066) | ✅ COMPLIANT |
| Category-Answer Cascade | Exact match resolves | "T5: an exact category answer completes the registration from the stored context" (:1112) | ✅ COMPLIANT |
| Category-Answer Cascade | Multi-word non-match lists and stays open | "T5: a multi-word non-match lists the categories and stays open (never dead-ends)" (:1204) | ✅ COMPLIANT |
| Category-Answer Cascade | Single-token non-match auto-creates guarded | "T5: a single-token non-match auto-creates the category through the guarded path and completes" (:1161) + reserved redirect (:1182) | ✅ COMPLIANT |
| Abandon Handling | Abandon clears the collect | "T6: an explicit abandon clears the collect payload and registers nothing" (:1225) + deterministic "no, dejalo" (:1248) + dialog-controller (:2784) | ✅ COMPLIANT |
| Non-Consuming Intents | Query during collect does not consume | "T7: a query during the collect answers and keeps the pending payload intact" (:1263) + dialog-controller (:2825) | ✅ COMPLIANT |
| Non-Consuming Intents | CRUD during collect does not consume | "T7: a CRUD during the collect executes and keeps the pending payload intact" (:1298) | ✅ COMPLIANT |
| Restart and Corrupt-Payload Recovery | Collect survives restart | "T11: the collect payload survives a restart and the dialog continues" (:1360) + integration "collect e2e: restart survival mid-dialog" (:1274) | ✅ COMPLIANT |
| Restart and Corrupt-Payload Recovery | Corrupt payload recovers | "T10: a corrupt collect payload abandons to idle with the dropped reply, registering nothing" (:1339) + "2.5: corrupt context yields null" (:1408) + integration corrupt e2e | ✅ COMPLIANT |
| Deterministic-Only Mode | No-brain bare noun keeps help | "T2/D8: a no-brain bare noun keeps the help reply and starts no collect dialog" (:1000) | ✅ COMPLIANT |
| asked_registration Reply Action | Fixed fallback asks the amount | reply-text.test.ts > "asks for the amount, echoing the collected note when present" (:506) + T1 asserts `askAmountReply` sent | ✅ COMPLIANT |
| asked_registration Reply Action | Fixed fallback asks the category | reply-text.test.ts > "asks for the category…" (:517) + T4 keeps-collecting asserts ask-category reply | ✅ COMPLIANT |

**telegram-bot (4 modified requirements / 31 scenarios)**

| Requirement | Scenario | Test (evidence) | Result |
|-------------|----------|-----------------|--------|
| Success and Help Reply Content | Success confirmation | Pre-existing success-confirmation tests (brain-written from executed result or fixed template) — green in full suite | ✅ COMPLIANT |
| Success and Help Reply Content | Unparseable gets help | Pre-existing help-reply tests (`helpReply` fallback) — green | ✅ COMPLIANT |
| Success and Help Reply Content | Off-topic gets a redirect, never a chat answer | "redirects an off_topic intent without creating a movement and never chats" (:2308) + fixed fallback (:2327) | ✅ COMPLIANT |
| Success and Help Reply Content | Query gets an executed answer | Pre-existing query executor tests (real data; redirect only on failure) — green | ✅ COMPLIANT |
| Success and Help Reply Content | Collection question uses the ask template | reply-text.test.ts "registration collection reply templates" describe (:505) + T1/T4 asserts | ✅ COMPLIANT |
| Success and Help Reply Content | Greeting keeps the dialog alive | "greeting: a greeting during an open dialog leaves the pending untouched" (:2378) | ✅ COMPLIANT |
| Per-Owner State Machine | Idle to setup | "enters awaiting_setup for a valid registration when the owner has no categories" (:328) — pre-existing, green | ✅ COMPLIANT |
| Per-Owner State Machine | Correction to idle | Pre-existing awaiting_category resolution tests — green | ✅ COMPLIANT |
| Per-Owner State Machine | Pending correction survives restart | "resolves a correction after a restart by reading the persisted state (restart survival)" (:522) — pre-existing, green | ✅ COMPLIANT |
| Per-Owner State Machine | Conflict answer registers the chosen amount | Pre-existing amount-confirmation resolve tests — green | ✅ COMPLIANT |
| Per-Owner State Machine | Conflict abandoned by a new registration | Pre-existing awaiting_amount_confirmation abandon tests (e.g. :672 region) — green | ✅ COMPLIANT |
| Per-Owner State Machine | Pending conflict question survives restart | "resolves a confirmation after a restart from a payload built through the schema" (:1939) — pre-existing, green | ✅ COMPLIANT |
| Per-Owner State Machine | Null-amount registration enters collection | T1 (:886) — transitions to `awaiting_registration`, payload persisted | ✅ COMPLIANT |
| Per-Owner State Machine | Collection completes to idle | T4 complete (:1039) + T5 exact (:1112) — returns to idle, payload clears | ✅ COMPLIANT |
| Intent-First Message Handling | Register intent runs the existing flow | Pre-existing brain-orchestration register_expense tests — green | ✅ COMPLIANT |
| Intent-First Message Handling | Keyword rule beats the brain suggestion | Pre-existing keyword-rule tests (:554 region comment: "keyword rule beats any brain suggestion") — green | ✅ COMPLIANT |
| Intent-First Message Handling | Query intent executes and answers from real data | Pre-existing query executor tests — green | ✅ COMPLIANT |
| Intent-First Message Handling | Off-topic redirects | :2308 + :2327 | ✅ COMPLIANT |
| Intent-First Message Handling | Greeting replies warm and keeps the thread | :2342 (idle) + :2378 (dialog open, pending intact) | ✅ COMPLIANT |
| Intent-First Message Handling | Setup gate precedes the brain | :328 — awaiting_setup without interpret | ✅ COMPLIANT |
| Intent-First Message Handling | Brain null behaves as today | Pre-existing deterministic registration tests (parse, otro+correction, help) — green | ✅ COMPLIANT |
| Intent-First Message Handling | Dialog answers route through the brain | Dialog-controller describe (brain-routed) extended with `seedAwaitingRegistration` (:2739+) — green | ✅ COMPLIANT |
| Dialog Controller | Query in dialog answers without consuming the pending | Pre-existing dialog-controller query test (awaiting_category) — green | ✅ COMPLIANT |
| Dialog Controller | Resolve answer reassigns the pending movement | Pre-existing resolveAwaitingCategory tests — green | ✅ COMPLIANT |
| Dialog Controller | Resolve answer registers the chosen amount | Pre-existing awaiting_amount_confirmation resolve tests — green | ✅ COMPLIANT |
| Dialog Controller | Phantom guard blocks a bare affirmation | Pre-existing phantom-guard tests (:3171 "phantom: a resolve with a corrupt amount-confirmation payload…") — green | ✅ COMPLIANT |
| Dialog Controller | New registration during a dialog abandons the pending | T8 (:1317) + dialog-controller "a new registration during the collect abandons it with a single interpret call" (:2845) | ✅ COMPLIANT |
| Dialog Controller | CRUD during a dialog does not consume the pending | Pre-existing dialog-controller CRUD test (awaiting_category) — green | ✅ COMPLIANT |
| Dialog Controller | Brain absent in a dialog degrades to D6 | Byte-identical D6 suite (hash A62B90FAD2…) green | ✅ COMPLIANT |
| Dialog Controller | Collection resolve follows the cascade | "collection: a resolve answer with the category completes from the stored context (single interpret call)" (:2758) | ✅ COMPLIANT |
| Dialog Controller | Collection abandon clears the payload | "collection: an explicit abandon clears the collect and registers nothing" (:2784) | ✅ COMPLIANT |

**bot-brain (5 modified requirements / 32 scenarios)**

| Requirement | Scenario | Test (evidence) | Result |
|-------------|----------|-----------------|--------|
| Interpret Envelope Contract | Envelope decodes strict JSON | Pre-existing envelope decode tests (string amount "5 mil" → 5000, :115) — green | ✅ COMPLIANT |
| Interpret Envelope Contract | Mixed-intent envelope decodes | "decodes a mixed-intent envelope with then_reassign true (create + reassign)" (:518) | ✅ COMPLIANT |
| Interpret Envelope Contract | Unknown intent degrades | "rejects an unknown intent" (:153) + "degrades to null when the payload fails the schema (unknown intent)" (:850) | ✅ COMPLIANT |
| Interpret Envelope Contract | Savings-rule intent decodes | "decodes a create_savings_rule envelope carrying the keyword and percent phrasing" (:446) | ✅ COMPLIANT |
| Interpret Envelope Contract | Planned query intent decodes | "decodes a query_planned envelope (spec: Planned query intent decodes)" (:375) | ✅ COMPLIANT |
| Interpret Envelope Contract | Planned flag decodes | "carries planned: true on a register_expense envelope" (:204) + defaults (:219) | ✅ COMPLIANT |
| Interpret Envelope Contract | Greeting intent decodes | "decodes a greeting envelope (spec: Greeting intent decodes)" (:462) | ✅ COMPLIANT |
| Interpret Envelope Contract | Null-amount register remains valid | "keeps a null-amount register_expense valid and routed to collection (spec: Null-amount register remains valid)" (:476) | ✅ COMPLIANT |
| Reply-After-Action Contract | Reply reflects only executed facts | "writes replies after the action from the executed result only" (:1221) + reply happy-path (:977) | ✅ COMPLIANT |
| Reply-After-Action Contract | Redirected result never invents amounts | Pre-existing redirect reply tests — green | ✅ COMPLIANT |
| Reply-After-Action Contract | Split result confirms gross, net, and savings | "posts the executed result with the savings split facts to the LLM" (:989) + "teaches the reply to confirm the savings split" (:1355) | ✅ COMPLIANT |
| Reply-After-Action Contract | Planned query reply reflects executed facts | "posts the planned query facts to the LLM (spec: Planned query reply reflects executed facts)" (:1037) | ✅ COMPLIANT |
| Reply-After-Action Contract | Collection question asks only the open field | "teaches the reply to ask ONLY the asked_field for an asked_registration action" (:1211) + `asked_field` on ExecutionResult | ✅ COMPLIANT |
| Intent Taxonomy | Off-topic redirects, never chats | "classifies off-topic and never answers as general chat" (:1180) + integration "brain: an off_topic intent creates no movement and never chats" (:524) | ✅ COMPLIANT |
| Intent Taxonomy | Greeting replies warm and keeps dialogs alive | "teaches the greeting classification separately from off_topic (deliberate reversal)" (:1192) + :1216 + service :2378 | ✅ COMPLIANT |
| Intent Taxonomy | Expense-signal bias in the prompt | "biases expense-signal messages to register_expense even without an amount" (:1174) + golden pin | ✅ COMPLIANT |
| Intent Taxonomy | Query intent executes real data | Pre-existing query executor tests + integration query e2e — green | ✅ COMPLIANT |
| Intent Taxonomy | Correct-category activates the correction flow | Pre-existing movement-correction tests — green | ✅ COMPLIANT |
| Intent Taxonomy | Savings-rule intent redirects to the command | :446 decode + pre-existing savings-rule routing tests — green | ✅ COMPLIANT |
| Intent Taxonomy | Planned query intent executes real data | "planned e2e: previsto: registers PENDING EXPENSE rows… planned query answers real data" integration (:1011) | ✅ COMPLIANT |
| Prompt Contract | Prompt drift fails CI | "pins the interpret system prompt" (:1108) / "pins the interpret few-shots" (:1112) / "pins the reply system prompt" (:1116) — pass without `-u` | ✅ COMPLIANT |
| Prompt Contract | Dialog prompt variant pinned | "pins the awaiting_category dialog addendum" (:1120) + few-shots pins (:1132) + amount-confirmation pins (:1126/:1138) | ✅ COMPLIANT |
| Prompt Contract | Prompt changes regenerate goldens in-cycle | 2 new goldens committed + 3 regenerated in change commits 60cd8c5/68798a2; full suite green without `-u` | ✅ COMPLIANT |
| Prompt Contract | Planned-query prompt instruction pinned | Golden pin of interpret prompt (byte-match) + "models the planned-query phrasing in the interpret few-shots" (:1348) | ✅ COMPLIANT |
| Prompt Contract | Planned-flag prompt instruction pinned | "models a planned phrasing in the interpret few-shots" (:1302) + interpret golden byte-match | ✅ COMPLIANT |
| Prompt Contract | Greeting and collection teaching pinned | "pins the awaiting_registration dialog addendum" (:1144) + few-shots (:1150) + "models the greeting flip…" (:1202) + teaching pins (:1182-1221) | ✅ COMPLIANT |
| Dialog Action Contract | Resolve classified for an exact category answer | "returns a resolve envelope when the LLM answers with an exact category" (:926) | ✅ COMPLIANT |
| Dialog Action Contract | Abandon classified for an explicit out | "models an exact category answer as resolve and an explicit out as abandon in the category few-shots" (:1395) — pre-existing, green | ✅ COMPLIANT |
| Dialog Action Contract | Null for a query during a dialog | "embeds the dialog addendum… when a context is supplied" (:908) + dialog few-shots pins | ✅ COMPLIANT |
| Dialog Action Contract | Bare affirmation never resolves | Pre-existing bare-affirmation/phantom tests (:3171) + T4/phantom (:1091) | ✅ COMPLIANT |
| Dialog Action Contract | Resolve classified for a collection amount answer | awaiting_registration dialog few-shots golden pin (:1150) + T4 phantom re-ask (:1091) | ✅ COMPLIANT |
| Dialog Action Contract | Resolve classified for a collection category answer | awaiting_registration dialog addendum/few-shots pins (:1144/:1150) + service resolve (:2758) | ✅ COMPLIANT |

**Compliance summary**: 81/81 scenarios compliant (all covering tests passed in the 966/966 run).

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| registration-collection: Collect Dialog State and Payload | ✅ Implemented | `AWAITING_REGISTRATION` (:116), `registrationCollectPayloadSchema` + `decodeCollectPayload`, `pendingNote` JSON, no migration |
| registration-collection: Deterministic Entry and Persistence | ✅ Implemented | E1 (:446-462), E2 (:514-536), deterministic prefix entry (:586), no-signal otro branch untouched |
| registration-collection: Amount-Answer Resolution | ✅ Implemented | message-derived amount (`normalizeAmountString ?? parseAmount`, positive-only brain rescue); register from stored context |
| registration-collection: Category-Answer Cascade | ✅ Implemented | exact → folded → guarded single-token create → multi-word list-and-stay-open; reserved redirect stays open |
| registration-collection: Abandon Handling | ✅ Implemented | clears payload, `collectAbandonedReply`, no createExpense |
| registration-collection: Non-Consuming Intents | ✅ Implemented | query/CRUD/greeting keep pending; new register_expense abandons + registers |
| registration-collection: Restart and Corrupt-Payload Recovery | ✅ Implemented | Postgres persistence; corrupt → idle + `questionDroppedReply`, nothing registers |
| registration-collection: Deterministic-Only Mode | ✅ Implemented | collect only on brain envelopes or `previsto:`/`compartido:` prefixes; bare noun keeps helpReply |
| registration-collection: asked_registration Reply Action | ✅ Implemented | `asked_registration` action + `asked_field` + 3 fixed templates |
| telegram-bot: Success and Help Reply Content | ✅ Implemented | greeting/asked_registration reply surfaces; off_topic strictly redirect |
| telegram-bot: Per-Owner State Machine | ✅ Implemented | 4th state, distinct from correction; restart semantics for all pendings |
| telegram-bot: Intent-First Message Handling | ✅ Implemented | greeting routing; setup gate precedes interpret; brain null = today |
| telegram-bot: Dialog Controller | ✅ Implemented | awaiting_registration in dialog branch (:289), dispatch (:1334-1406), phantom guard, D6 fallback |
| bot-brain: Interpret Envelope Contract | ✅ Implemented | greeting intent, planned flag, null-amount register valid, temperature 0 + json_object |
| bot-brain: Reply-After-Action Contract | ✅ Implemented | asked_registration/asked_field, split + planned facts grounded |
| bot-brain: Intent Taxonomy | ✅ Implemented | greeting separate from off_topic; planned-query classification |
| bot-brain: Prompt Contract | ✅ Implemented | category-blind, dialog-aware, greeting/planned/collection teaching, goldens pinned |
| bot-brain: Dialog Action Contract | ✅ Implemented | resolve/abandon/null classification; bare affirmation never resolves |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 New state vs reuse | ✅ Yes | `awaiting_registration` distinct; D6 suite byte-identical (non-conflation proof) |
| D2 Open-field tracking | ✅ Yes | open field derived from payload (amount null → amount; else category null → category) |
| D3 Resolver authority | ✅ Yes | message-derived value + payload context; phantom guard; envelope.amount positive-only rescue |
| D4 Greeting | ✅ Yes | real greeting intent; warm reply; dialogs stay open; off_topic stays redirect-only |
| D5 Version contract | ✅ Yes | `pendingNote` JSON + zod; no Prisma migration |
| D6 Wrong-field resolve | ✅ Yes | T9 stay-open re-ask (`keptCollectingReply`), explicit abandon is the exit |
| D7 Corrupt payload | ✅ Yes | abandon WITHOUT reprocessing (`questionDroppedReply`) |
| D8 Deterministic-only entry | ✅ Yes | only prefixes `previsto:`/`compartido:` without amount; "gym" keeps helpReply |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | TDD Cycle Evidence table found in apply-progress (28 task rows, Phases 1-5) |
| All tasks have tests | ✅ | 28/28 tasks have test files (cross-referenced: all listed files exist) |
| RED confirmed (tests exist) | ✅ | All RED="✅ Written" tests exist on disk (telegram.service.test.ts, bot-brain.test.ts, reply-text.test.ts, telegram.service.integration.test.ts) |
| GREEN confirmed (tests pass) | ✅ | 966/966 pass on execution — every listed test file green |
| Triangulation adequate | ✅ | T1 ×2, T2 ×3, T4 ×3, T5 ×5, T6 ×2, T7 ×2, T10 ×2, T11 + integration ×2 — spec scenarios per task covered |
| Safety Net for modified files | ✅ | All modified files report ✅ N/N baseline runs (211→966 progression consistent) |

**TDD Compliance**: 6/6 checks passed

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~61 new (8 reply-text + 6 schema + 38 collection + 4 dialog-controller + 6 greeting + 5 brain) | 3 (telegram.service.test.ts, bot-brain.test.ts, reply-text.test.ts) | vitest |
| Integration | 5 new collect e2e (+43 in file) | 1 (telegram.service.integration.test.ts) | vitest + Postgres localhost:5433 |
| E2E | 0 | 0 | not installed |
| **Total** | **966 (full suite, 37 files)** | 4 changed | |

### Changed File Coverage
Coverage analysis skipped — no coverage tool configured in the verify contract (`vitest run` without coverage provider; no `--coverage` script). Informational, not blocking.

### Assertion Quality
Scanned all 4 changed test files for banned patterns: no tautologies, no orphan empty-collection assertions, no ghost loops, no CSS-class/implementation-detail coupling in the deltas. The only `toBeDefined()` uses inside this change's delta (bot-brain.test.ts:1204) is a guard combined with a value assertion (`parsed.intent === "greeting"`, :1208). Three `toHaveBeenCalledTimes(1)` assertions (:1330, :2770, :2857) assert the spec's own "single interpret call" behavioral contract, not implementation detail. Standalone `toBeDefined()` at bot-brain.test.ts:1306/1311/1352/1407 and integration :851/:940 are pre-existing (outside this change's diff hunks). Mock/assertion ratios: telegram.service.test.ts 210 mocks/519 expects, bot-brain 0/250, reply-text 0/142, integration 0/202 — no mock-heavy tests.

**Assertion quality**: ✅ All assertions verify real behavior

### Quality Metrics
**Linter**: ✅ No errors (`eslint src` exit 0)
**Type Checker**: ✅ No errors (`tsc -p tsconfig.json --noEmit` exit 0)

### Issues Found
**CRITICAL**: None
**WARNING**: None
**SUGGESTION**:
- apply-progress "Total tests written: +66" does not sum from its own breakdown (8+6+38+4+6+5+5 = 72); arithmetic-only, no impact on evidence or verdict.
- apply-progress notes two baseline integration files (movements.status, savings.migration) timed out at 5000ms in an early baseline run but passed in the final full run — environmental timing, not code; consistent with the final 966/966 run here.

### Verdict
**PASS**
All 28 tasks complete; 966/966 tests pass without `-u`; typecheck and lint clean; 81/81 spec scenarios compliant with runtime evidence; all six hard constraints verified (D6 byte-identical non-conflation, distinct resolvers, spec-signed greeting reversal, in-cycle goldens, no Prisma migration, deterministic-only mode); Strict TDD evidence fully cross-referenced.