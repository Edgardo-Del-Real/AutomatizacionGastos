# Exploration: Conversational Thread (registration detail collection)

## Executive Summary

The bot is intent-driven per message with NO persisted "in-progress registration": when a message
lacks an amount, `executeRegistration` dead-ends into the brain's free-text `reply()` with no
`botStateRepository.set` call, so the next message is interpreted from scratch as a brand-new
command — which is exactly why "gym" became `create_category` and "no la estoy queriendo crear..."
became a failed category operation. The two persisted dialogs that exist today
(`awaiting_category`, `awaiting_amount_confirmation`) cover only post-registration correction and
two-amount conflict resolution — neither collects missing fields for a NEW registration. The proven
pattern to copy is the amount-confirmation payload (a zod-validated JSON object living in
`BotState.pendingNote`), and the resolver cascade to copy is the D6 category-answer logic
(exact → folded → single-token auto-create → multi-word list-and-keep-open). Adding a "collect
registration" dialog therefore requires: one new state, one new payload schema, two entry points in
`executeRegistration`/`deterministicRegistration` (amount missing; category unresolvable), brain
context teaching (`InterpretContext` union + dialog addendum/few-shots + new reply action), and
explicit off-topic/greeting handling. Greeting behavior ("hola" → warm reply) deliberately reverses
today's "off_topic never chats" contract and must be a separate, product-signed decision.

## Current Conversation State Machine

Persisted per owner in `BotState` (`ownerId, state, pendingMovementId, pendingNote` — Prisma model,
`apps/api/prisma/schema.prisma`). `pendingNote` is a String column reused as a JSON payload for
dialog state (amount-confirmation and movement-selection payloads) — no schema migration needed for
a new payload.

| State | Set where | Consumed where | Payload | Meaning |
|---|---|---|---|---|
| `idle` | everywhere on completion (e.g. `registerWithCategory:1512`, `answerCorrection:826`) | `handleUpdate` falls through to `handleRegistration:264` | — | no open question |
| `awaiting_setup` | `handleRegistration:280-285` (no categories) / `/configurar` command `:1417` | `handleSetupReply:652` | plain (names parsed from body) | collect initial category list |
| `awaiting_category` | `registerOtroWithCorrection:1564-1569` | `handleDialogMessage` → `d6AwaitingCategory:707` / `resolveAwaitingCategory:951` | `pendingMovementId` + display note (plain strings) | **correction** of an ALREADY-registered "otro" movement |
| `awaiting_amount_confirmation` | `askAmountConfirmation:507-512` | `handleDialogMessage` → `d6AwaitingAmountConfirmation:519` / `resolveAwaitingAmountConfirmation:1040` | `amountConfirmationPayloadSchema:125-135` JSON in `pendingNote` (`body,note,amounts,category,shared,planned,override`) | conflict between two PRESENTED amounts |
| `awaiting_movement_selection` | `runMovementCorrection:1250-1255` | `handleMovementSelection:1272` | `movementSelectionPayloadSchema:144-157` JSON | "which movement do I correct?" pick |

Routing in `handleUpdate` (telegram.service.ts:247-264): commands first (every state, D6), then
`AWAITING_SETUP` → `handleSetupReply`, `AWAITING_CATEGORY`/`AWAITING_AMOUNT_CONFIRMATION` →
`handleDialogMessage`, `AWAITING_MOVEMENT_SELECTION` → `handleMovementSelection`, else
`handleRegistration`. Dialog messages are interpreted WITH `InterpretContext`
(`buildInterpretContext:911-928`) and routed on `dialog_action` (`handleDialogMessage:843-887`);
`dialog_action: null` falls to the shared `routeEnvelopeIntent` leaving the pending untouched
(queries/CRUD during a dialog do not consume it — test telegram.service.test.ts:2120).

**Key semantic fact**: `awaiting_category` today means "the movement is ALREADY registered in
'otro'; pick/confirm its category". It is NOT "collect the category for a new registration". Its
resolvers assume `pendingMovementId` exists (phantom guard `resolveAwaitingCategory:958-962`).

## Bug Path Evidence (user-observed, live)

### Message 1 — "quiero cargar un gasto previsto" → free-text question, NO persisted state

1. `handleUpdate` → no command, no `previsto:` prefix (the signal is prose, not the prefix),
   state `null`/`idle` → `handleRegistration` (telegram.service.ts:264).
2. `tryBrainInterpret` → brain classifies `register_expense` with `amount:null`, `planned:true`
   (bot-brain.ts:217 "Si el mensaje tiene señal de gasto... usá register_expense, aunque no tenga
   monto"; :235 `planned` true for "gasto previsto") → `routeEnvelopeIntent` →
   `executeRegistration` (telegram.service.ts:422).
3. `detAmount === null && brainAmount === null` → **helpReply branch** (telegram.service.ts:444-450):
   `send({intent:"register_expense", ok:false, action:"none", amount:null, category:null,
   note:body}, helpReply())`. `send` is `makeSender(true, reply)` → `tryBrainReply` runs the LLM
   `reply()` (bot-brain.ts:508) over that JSON; REPLY_SYSTEM_PROMPT maps `action:"none"` to "guiá al
   dueño" (bot-brain.ts:341), so the LLM wrote the observed "¿En qué categoría querés que lo
   guarde?" — **that text is not in the codebase**; `helpReply()` (reply-text.ts:71) is "No entendí
   el mensaje...".
4. **No `botStateRepository.set` anywhere in this branch** → nothing persisted. State stays idle.
   Root cause A: a question is asked (by the LLM) without an open-question record.

### Message 2 — "gym" → create_category duplicate

1. State still idle → `handleRegistration` → `interpret("gym")` with NO context → the LLM classifies
   a bare noun as `create_category` (few-shot bot-brain.ts:308-313 teaches category-creation
   phrasings) → `routeEnvelopeIntent` → `executeCategoryCommandWithReassign:1160` →
   `CategoryExecutor.create:42` → `CategoryService.createCategory` → `assertNameAvailable` throws
   `ValidationFailedError('Category "gym" already exists')` (categories.service.ts:34-42).
2. Result `{ok:false, error:"duplicate", message:"Category \"gym\" already exists"}` →
   brain `reply()` paraphrases in rioplatense: "Che, la categoría 'gym' ya existe, no se pudo
   crear." (fixed fallback would be `duplicateCategoryReply` reply-text.ts:306).
   Root cause B: with no pending dialog, the follow-up is treated as a brand-new command.

### Message 3 — "no la estoy queriendo crear..." → "No encontré la categoría ..."

1. Same: idle → fresh `interpret()` with the whole sentence, no context. The LLM misroutes it into a
   category CRUD intent (mechanism is deterministic: no pending state exists, so whatever intent the
   model emits is routed as a fresh idle intent).
2. The CRUD executor returns a failure (duplicate / not_found / unknown), and the brain
   `reply()` free-texts it — observed "No encontré la categoría ...". Fixed-template candidates for
   that phrasing: `missingCategoryReply` (reply-text.ts:310 "No existe la categoría X") or
   `categoryNotFoundReply` (reply-text.ts:147 "No encontré la categoría X. Elegí una de estas: ...").
   The exact LLM intent for this sentence is model-dependent (temperature 0, single-shot, no
   history); the structural cause is root cause C: no context continuity across turns.

## Design Space: Adding a "Collect Registration" Dialog

### Core shape (all options)

- **New state** (e.g. `awaiting_registration`): entered ONLY from `executeRegistration`'s
  amount-null branch (`:444`) and/or when the envelope has no resolvable category; must NOT reuse
  `awaiting_category` (correction-of-registered-movement semantics + phantom guard).
- **New payload** `registrationCollectPayloadSchema` mirroring `amountConfirmationPayloadSchema`
  (`:125-135`) — the pattern already persists `shared`/`planned`/`override` across turns:
  `{ body, note, amount (nullable), category (nullable), shared, planned, override }`. Lives in
  `BotState.pendingNote`; no Prisma migration.
- **Resolver authority**: the answer value MUST come from the persisted payload matched against the
  message (phantom-guard rule, already proven at `resolveAwaitingAmountConfirmation:1060-1062`);
  never trust envelope fields to fabricate state.
- **Category-answer cascade** (copy of D6, `d6AwaitingCategory:707-798` / `resolveAwaitingCategory:951-1031`):
  exact normalized match → folded plural match → single-token auto-create via guarded
  `createCategory` (reserved redirect keeps dialog open) → multi-word non-match lists categories and
  STAYS OPEN (never dead-ends).
- **Abandon**: explicit "no, dejalo" / `dialog_action:"abandon"` clears the collect payload with a
  clear reply; nothing registers from the abandoned message.
- **Non-consuming intents**: queries, CRUD, off_topic during collection keep the pending untouched
  (mirror test telegram.service.test.ts:2120).

### Approach options

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. Amount-only collection** — new state fires only when brain says `register_expense` and both amounts are null; after amount is collected, keep today's tail (category resolved → register; unresolved → "otro" + existing correction offer) | Smallest surface; direct fix for the observed dead-end; reuses persisted-payload pattern | Category still not asked BEFORE registering ("¿en qué categoría?" intent only partially met); the "gym" misroute is only fixed for collected cases | Medium |
| **B. Full collection (amount → category → register)** — same new state, payload carries both; ask amount first, then category (if unresolved), then register from stored context | Matches the product intent exactly ("dale, ¿qué monto?" → "¿en qué categoría?" → done); keeps context across N turns; stops follow-up misroutes entirely | Bigger change: new resolver cascade + brain teaching + reply action + spec deltas + more test churn | High |
| **C. Reuse `awaiting_category`** with a not-yet-registered marker | No new state constant | Breaks correction semantics: `resolveAwaitingCategory` requires `pendingMovementId` (a registered movement); D6 ambiguity suite (telegram.service.test.ts:584+) and dialog controller suite assume correction semantics; phantom guard would drop the question | Rejected |
| **D. Greeting intent** — new `greeting` intent (or teach `off_topic` to greet) so "hola" warms up and, when a collect dialog is open, prompts to continue | Meets "greet back and follow the thread" | Deliberately reverses spec "off_topic... NUNCA lo respondas como charla general" (bot-brain.ts:230) and locked tests (telegram.service.test.ts:1675/1693, bot-brain.test.ts:1126); needs intent-taxonomy spec delta + explicit product sign-off | Low-Medium (separate decision) |

### Recommendation

**Option B as the core change**, sequenced internally as amount → category (phased sub-states or
field-flag in the payload), with entry points at `executeRegistration:444` (amount null) and the
category-resolution point (`:474-480`, when `matched` and `resolveSuggestion` both return null and
the envelope DID signal a category intent — keeping "otro" fallback only for the deterministic-only
mode and for brain envelopes that carry NO category signal). **Option D (greetings) should be a
scoped decision inside the same proposal but explicitly flagged**, because it reverses a locked
product contract; default recommendation if approved: add a real `greeting` intent that greets AND
keeps any open collection dialog alive.

## Affected Areas

- `apps/api/src/features/telegram/telegram.service.ts` — state constants (`:106-110`), new payload
  schema next to `:125-159`, `executeRegistration` entry (`:444-450`), `buildInterpretContext`
  (`:911-928`), `handleDialogMessage`/`d6DialogFallback` (`:843-904`), new resolver cascade,
  `routeEnvelopeIntent` greeting case (`:1122`).
- `apps/api/src/features/telegram/bot-brain.ts` — `InterpretContext` union (`:115-125`),
  `DIALOG_INTERPRET_ADDENDUM`/`DIALOG_FEW_SHOTS` (`:352-417`), `renderDialogContext` (`:420-427`),
  `BOT_INTENTS` (`:4-21`) if a greeting intent is added, `REPLY_SYSTEM_PROMPT` action mapping
  (`:336-346`) for the new "asked registration" action.
- `apps/api/src/features/telegram/bot-state.repository.ts` — `BOT_STATES` (`:3-9`) + `BotStateName`
  (`:11`) gain the new state name.
- `apps/api/src/features/telegram/reply-text.ts` — new fixed templates for "ask amount" / "ask
  category" / "kept collecting" (fixed fallbacks when brain reply is null).
- `apps/api/src/features/telegram/__goldens/*` — interpret prompt, both dialog addenda/few-shots,
  rendered context goldens must be regenerated (tests pin them: bot-brain.test.ts:1065-1110).
- `openspec/specs/telegram-bot/spec.md` — "Per-Owner State Machine" (`:312`), "Dialog Controller
  (Brain-Routed Dialogs)" (`:474`), "Intent-First Message Handling" (`:403`).
- `openspec/specs/bot-brain/spec.md` — "Dialog Action Contract" (`:263`), "Prompt Contract"
  (`:202`), "Intent Taxonomy" (`:105`).

## Tests Locking Current Behavior (load-bearing)

- `telegram.service.test.ts:506` — "replies with help for an unparseable message and creates
  nothing" ("hola" → helpReply; deterministic harness). Changes only if the no-amount path changes
  for brain-less mode.
- `telegram.service.test.ts:1108/1135` — brain amount rescue (amount PRESENT + category resolved /
  "otro"); the pattern a collect dialog must not regress.
- `telegram.service.test.ts:1161-1174` — interpret-null → helpReply ("gaste cinco mil pesos").
- `telegram.service.test.ts:1176-1206` — conflict payload persisted with `amounts/body/note/
  category`; the persisted-payload contract to extend.
- `telegram.service.test.ts:1234-1380` — `awaiting_amount_confirmation` suite (resolve from stored
  context, abandon-and-reprocess, restart survival, corrupt payload recovery, movement-creation
  failure keeps question open).
- `telegram.service.test.ts:584-783` — `awaiting_category` D6 ambiguity suite (amount-answer → new
  registration, "500" beats amount, folded plurals, single-token auto-create, reserved redirect,
  multi-word lists and keeps open, "no"/affirmation handling).
- `telegram.service.test.ts:1675/1693` — off_topic redirects, never chats (LLM paraphrase allowed,
  fixed `offTopicRedirectReply` fallback); greeting changes break these.
- `telegram.service.test.ts:2023-2455` — dialog controller suite (resolve/abandon/phantom guards,
  query and CRUD during dialog don't consume pending, single interpret call per message, D6
  fallback verbatim when brain null).
- `bot-brain.test.ts:859-932` — interpret-with-context contract (addendum + rendered context +
  dialog few-shots assembly, resolve envelope shape, invalid dialog_action → null).
- `bot-brain.test.ts:1065-1110` — prompt goldens pinned to `__goldens__` files.
- `bot-brain.test.ts:1126` — "classifies off-topic and never answers as general chat".
- `telegram.service.integration.test.ts:543-635` — amount-confirmation e2e incl. restart survival;
  `:818-966` — dialog e2e (query during dialog, then_reassign); `:1011+` — planned e2e.
- `reply-text.test.ts` — `categoryCommandReplyTemplate` goldens.

## Risks

- **CRITICAL** — Conflating the new collection state with `awaiting_category` breaks correction
  semantics (phantom guard requires a registered movement; D6 ambiguity suite and dialog controller
  suite lock correction-only behavior). Use a NEW state.
- **CRITICAL** — Prompt goldens and few-shots are pinned by tests and loaded from `__goldens__`;
  any brain-teaching change MUST regenerate them or the suite fails.
- **WARNING** — The state machine MUST remain the transition authority (spec: "the LLM MUST never
  decide state transitions"); entry/persist/consume of the new state must be fully deterministic.
- **WARNING** — Greeting behavior reverses the locked "never general chat" contract
  (spec + bot-brain.ts:230 + tests 1675/1693/1126); needs spec delta and product sign-off.
- **WARNING** — The LLM `reply()` over an `ok:false/action:"none"` result is exactly what produced
  the unpersisted free-text question; the new flow needs a dedicated action (e.g.
  `asked_registration`) with honest prompt teaching so the LLM asks grounded questions.
- **WARNING** — Deterministic-only mode (brain absent) has no intent signal; collection can only
  fire on brain envelopes or deterministic prefixes (`previsto:`/`compartido:` without amount).
  Document that no-brain "gym" still gets helpReply.
- **WARNING** — Multi-word non-category answers during collection must list categories and stay
  open (never dead-end, never auto-create nonsense) — mirror D6 rule 4.
- **INFO** — `BotState` needs no migration; `pendingNote` String + zod payload is the version
  contract (proven by amount-confirmation).
- **INFO** — `AWAITING_MOVEMENT_SELECTION` is untouched by this change.

## Ready for Proposal

Yes. The orchestrator should tell the user: the failure is a missing persisted "in-progress
registration" dialog — the bot asks via free text but records no open question, so the next message
is re-interpreted as a fresh command. Recommended change: one new state + persisted payload
(amount/category/note/shared/planned/override), amount-then-category collection driven by the brain
as classifier and the deterministic cascade as resolver, plus a flagged separate decision on
greeting behavior ("hola" warm reply) which reverses today's never-chat contract.