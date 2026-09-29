# Design: Conversational Thread — Registration Detail Collection

## Technical Approach

Add a fourth persisted dialog state `awaiting_registration` with a zod payload in `BotState.pendingNote`, copying two proven patterns: `amountConfirmationPayloadSchema` (telegram.service.ts:125-135) for persistence and the D6 cascade (`d6AwaitingCategory`:707-798 / `resolveAwaitingCategory`:951-1031) for category answers. The state machine stays the transition authority: the brain only classifies (`dialog_action`/intent); entry, persist, resolve, and consume are deterministic. Collection sequence: amount → category → register from stored context (`shared`/`planned`/`override` honored from the payload, never the resolve envelope).

## State Machine Design

- **Constant**: `AWAITING_REGISTRATION = "awaiting_registration"` (:106-110); add to `BOT_STATES`/`BotStateName` (bot-state.repository.ts:3-11).
- **Payload schema** (next to :125-135; mirrors the amount-confirmation contract, no Prisma migration):

```ts
export const registrationCollectPayloadSchema = z.object({
  body: z.string().min(1),
  note: z.string().nullable(),
  amount: z.number().positive().nullable(),
  category: z.string().min(1).nullable(),
  shared: z.boolean().default(false),
  planned: z.boolean().default(false),
  override: savingsOverrideSchema.default({ kind: "none" }),
});
```

- **Open field is derived deterministically from the payload**: `amount === null` → ask amount; else `category === null` → ask category. No sub-states.
- **Entries** (both deterministic):
  - **E1 amount-null** — `executeRegistration` :444-450: `detAmount === null && brainAmount === null` → persist payload (`note = envelope.note ?? extractNote(body)`; `category = matchNote(...) ?? resolveSuggestion(...)`) and send `asked_registration` instead of the unpersisted `action:"none"` + `helpReply`.
  - **E2 category-signal-unresolved** — :474-480: when `category === null` but `envelope.category !== null` (a signaled suggestion that resolves to nothing) → persist payload (amount set, category null) and ask the category. No category signal (`envelope.category === null`) keeps `registerOtroWithCorrection` unchanged (spec: "No category signal keeps otro").
- **Routing** — `handleUpdate` :254-257: the dialog branch gains `|| state?.state === AWAITING_REGISTRATION` → `handleDialogMessage`. `d6DialogFallback` (:890-904) and `resolveDialog` (:931-943) dispatch the new state to new handlers; `buildInterpretContext` (:911-928) decodes the payload (corrupt → `null` → D6 fallback owns the message) and renders `openQuestion` from the derived field.

### Transition Table

| # | State | Signal (deterministic fact) | Next state | Action |
|---|---|---|---|---|
| T1 | idle | `register_expense` envelope, det+brain amount null | awaiting_registration | persist payload (amount:null), send `asked_registration(asked_field:"amount")` |
| T2 | idle | amount resolved, category signaled but unresolved | awaiting_registration | persist payload (category:null), ask category |
| T3 | idle | category resolves / no category signal | unchanged | register, or otro+correction (untouched) |
| T4 | awaiting_registration, amount open | resolve, amount parseable from message | category set → idle; else stays | register from stored context, or persist amount + ask category |
| T5 | awaiting_registration, category open | resolve, category answer | exact/folded/single-token → idle; multi-word → stays | cascade; register from stored context; list categories |
| T6 | awaiting_registration | abandon (`dialog_action:"abandon"` / "no, dejalo") | idle | clear payload, clear reply, nothing registers |
| T7 | awaiting_registration | `dialog_action:null` + query/CRUD/off_topic/greeting | awaiting_registration (untouched) | execute intent; pending intact |
| T8 | awaiting_registration | `dialog_action:null` + register_expense | idle → new registration | abandon collect + register the new message |
| T9 | awaiting_registration | non-answer (no amount/category in message) | awaiting_registration | `keptCollectingReply` re-asks the open field |
| T10 | awaiting_registration | corrupt `pendingNote` (any message) | idle | `questionDroppedReply`; nothing registers; no reprocessing |
| T11 | awaiting_registration | process restart | awaiting_registration | payload survives (Postgres); dialog continues |
| T12 | awaiting_category | any | unchanged | correction semantics + `pendingMovementId` phantom guard untouched — NEVER conflated |

**Coexistence with `awaiting_category`**: distinct constant, distinct payload (`pendingMovementId` vs `pendingNote` JSON), distinct resolvers, distinct brain context. The `awaiting_category` phantom guard (resolveAwaitingCategory:958-962) and D6 suite (:584-783) stay byte-identical — that suite staying green is the non-conflation proof.

## Dialog Flow Sequences

```
Owner                 Service                                   Store        Brain
"quiero cargar un gasto previsto"
  ├─ handleRegistration → interpret ────────────────────────────────────────────►
  │  ◄────────── envelope {register_expense, amount:null, planned:true} ◄───────┤
  │  [T1] executeRegistration:444 both amounts null
  │       set{awaiting_registration, payload{note,body,amount:null,category,shared,planned,override}}
  ◄─ "¿Qué monto…?"  (result: action:"asked_registration", asked_field:"amount")
"dale 5000"
  ├─ handleDialogMessage → interpret(body, ctx) ────────────────────────────────►
  │  ◄────────── {dialog_action:"resolve", amount:5000} ◄────────────────────────┤
  │  [T4] amount = normalizeAmountString ?? parseAmount = 5000  (message, not envelope)
  │       set{awaiting_registration, payload{amount:5000}}
  ◄─ "¿En qué categoría…?" (asked_registration, asked_field:"category")
"gym"
  ├─ handleDialogMessage → interpret ────────────────────────────────────────────►
  │  ◄────────── {dialog_action:"resolve", category:"gym"} ◄─────────────────────┤
  │  [T5] cascade: exact ✗ folded ✗ single-token → guarded createCategory("gym") ✓
  │       registerWithCategory(body, 5000, note, "gym", payload.shared, payload.planned, payload.override)
  │       set{idle, null, null}
  ◄─ "Registrado: $ 5.000 (…) — Categoría: gym" (action:"registered")
```

```
Abandon (T6):   "no, dejalo" → resolve/abandon → set{idle,null,null} → collectAbandonedReply; createExpense NOT called
Non-consuming (T7): "decime los últimos movimientos" → {dialog_action:null, intent:query} → executeQuery answers real data; state+pendingNote unchanged
                  "hola" → {intent:"greeting"} → greetingReply (brain or fixed); pending untouched
Restart (T11):  process restarts → BotState row survives → next message resumes from the payload
Corrupt (T10):  pendingNote invalid JSON → decodeCollectPayload → null → set{idle} → questionDroppedReply; nothing registers
```

## Deterministic Resolver Authority

`resolveAwaitingRegistration` / `d6AwaitingRegistration` (new, mirroring :1040-1081 and :707-798):

**Phantom guard (from resolveAwaitingAmountConfirmation)**: the payload must parse (else T10); the resolving value originates ONLY in the current message — amount: `normalizeAmountString(body) ?? parseAmount(body)`, then `envelope.amount` as brain rescue (positive only); category: `envelope.category` (resolve mode) or raw body (D6 fallback), then the cascade. Every other fact (note, category, shared, planned, override) comes from the persisted payload — resolve-envelope fields NEVER mutate state. A wrong-field or empty resolve → T9 (stay open, re-ask), never fabricate, never reprocess.

**Category cascade (order)**: abandon words → exact normalized match → folded plural match → `CATEGORY_AFFIRM_ANSWERS` (stay open, re-ask) → `parseAmountAndNote(body) !== null` (D6 rule 2 verbatim: abandon collect + reprocess as new registration) → single-token guarded `createCategory` (reserved reject → stay open with redirect) → multi-word → `categoryNotFoundReply` list, stay open. Never dead-ends, never auto-creates nonsense.

**Pre-brain interception** (handleDialogMessage :855-861): extend the affirmation intercept to `AWAITING_REGISTRATION` → kept-collecting re-ask, so a bare "dale" cannot be classified `register_expense(amount:null)` and destroy the collect via abandon+re-enter.

## Brain Integration

- `BOT_INTENTS` + `"greeting"` (bot-brain.ts:4-21); `conversationEnvelopeSchema` accepts it; `register_expense` with `amount:null` stays valid (drives E1).
- `BotAction` + `"asked_registration"`; `ExecutionResult` + `asked_field?: "amount" | "category" | null`.
- `InterpretContext` union + `{ state: "awaiting_registration", pending: { amount, category, note }, openQuestion }`.
- `DIALOG_INTERPRET_ADDENDUM.awaiting_registration` + `DIALOG_FEW_SHOTS.awaiting_registration` (:352-417): resolve = the message answers the open field (amount for the amount question, a category name for the category question); abandon = explicit outs; null otherwise; never invent the amount/category.
- `renderDialogContext` case (:420-427): `estado awaiting_registration; monto: X|pendiente; categoría: Y|pendiente; nota: …; pregunta abierta: "…"`.
- `INTERPRET_SYSTEM_PROMPT` (:213-236): intent list gains `greeting`; teach "saludos → greeting, no off_topic"; teach "register_expense con amount null abre el diálogo de registro". `FEW_SHOTS` (:304-305): "hola, cómo andás?" flips `off_topic` → `greeting` — **DELIBERATE reversal** of the locked "never general chat" contract, signed in the spec deltas.
- `REPLY_SYSTEM_PROMPT` (:336-346): `asked_registration` = ask ONLY the `asked_field` question, never invent the other field; `intent:"greeting"` (action none) = warm one-line expense-scoped greeting, overrides the generic none-guidance, never closes dialogs.
- **Greeting routing** (routeEnvelopeIntent :1089-1153): new `case "greeting"` sends `{intent:"greeting", ok:true, action:"none"}` + `greetingReply()` fixed fallback; the pending is untouched by construction (only register_expense clears it). The register-expense abandon arm (:1136-1149) gains the `AWAITING_REGISTRATION` → `collectAbandonedReply()` third case.

## Reply Templates (reply-text.ts)

| Template | Text (voseo, grounded) |
|---|---|
| `askAmountReply(note)` | `¿Qué monto tiene el gasto${notePart}? Mandame el número.` |
| `askCategoryReply(note)` | `¿En qué categoría lo guardo${notePart}? Mandame el nombre.` |
| `keptCollectingReply(field)` | `Sigo con el registro: falta ${el monto|el nombre de la categoría}. Si querés cancelarlo, mandá "no, dejalo".` |
| `collectAbandonedReply()` | `Dale, cancelé el registro. No guardé nada.` |
| `greetingReply()` | `¡Hola! Estoy para tus gastos: mandame un monto con una nota (ej: $2500 supermercado) y lo cargo al toque.` |

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | constant, schema+decoder, E1/E2 entries, no-brain prefix entry (deterministicRegistration :404-407), handleUpdate routing, buildInterpretContext, fallback/resolve dispatch, new resolvers, affirmation intercept, routeEnvelopeIntent greeting case + abandon arm |
| `apps/api/src/features/telegram/bot-brain.ts` | Modify | greeting intent, asked_registration action, asked_field, InterpretContext, prompts, few-shots, addendum/few-shots, renderDialogContext |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | `BOT_STATES` + state |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | 5 new templates |
| `__goldens__/interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt` | Regenerate | greeting + collection teaching; "hola" few-shot flip |
| `__goldens__/dialog-awaiting-registration-addendum.txt`, `dialog-awaiting-registration-few-shots.json` | Create | new pinned goldens |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (telegram.service.test.ts) | T1–T11 | new "collection dialog" describe; entries (amount-null persists, category-unresolved persists, no-signal keeps otro), amount answer, cascade (exact/folded/auto-create/reserved/multi-word), abandon, non-consuming (query/CRUD/greeting), restart, corrupt payload, no-brain prefix entry + no-brain bare noun keeps `helpReply` |
| Unit — locked suites | deliberate deltas only | :584-783 (awaiting_category D6) **stays green unchanged** — non-conflation proof; :1675/1693 off_topic fixtures move off "hola" (now greeting-classified) to genuinely off-topic text + new greeting-routing tests (idle and during open dialogs); :2023-2455 dialog controller extended with `seedAwaitingRegistration` cases (resolve/abandon/phantom guard/non-consuming/single interpret call) |
| Unit (bot-brain.test.ts) | envelope + prompts | greeting decodes; null-amount register_expense valid; :859-932 extended with awaiting_registration context assembly; :1065-1110 goldens regenerated (`pnpm --filter @rita/api test -- -u`, then full suite) + 2 new golden pins; :1126 stays (off_topic still never chats) + sibling pinning greeting teaching |
| Integration | e2e collect | telegram.service.integration.test.ts: entry→amount→category→registered with planned/shared/override honored; restart survival mid-dialog; corrupt-payload recovery (mirror :543-635) |
| Unit (reply-text.test.ts) | templates | 5 new replies |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Message routing is in-process service logic; the dedup/gate ordering (handleUpdate :191-220) is untouched.

## Migration / Rollout

No migration. `pendingNote` + zod is the version contract (amount-confirmation precedent); stale collect rows degrade via corrupt-payload recovery (T10). Rollback: revert the additive state/schema/resolvers/teaching and restore goldens + test deltas from git.

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|---|---|---|---|
| D1 | New state vs reuse | `awaiting_registration` | reuse `awaiting_category` (rejected: correction-only + `pendingMovementId` phantom guard; breaks D6 suite) | spec CRITICAL constraint; distinct semantics |
| D2 | Open-field tracking | payload field-flag | phased sub-states | one state/payload; open question derived deterministically; fewer transitions to test |
| D3 | Resolver authority | message-derived value + payload context | trust envelope values | phantom-guard rule; LLM classifies only, never decides transitions |
| D4 | Greeting | real `greeting` intent; warm reply; dialogs stay open | keep never-chat; teach off_topic to greet | signed product reversal; isolated intent keeps `off_topic` strictly redirect-only |
| D5 | Version contract | `pendingNote` JSON + zod | Prisma migration | proven pattern; zero migration risk |
| D6 | Wrong-field resolve | stay open + re-ask | drop question (amount-confirmation precedent) | collection holds no registered movement; never dead-end; explicit abandon stays the exit |
| D7 | Corrupt payload | abandon WITHOUT reprocessing | reprocess (amount-confirmation precedent) | spec: "MUST NOT crash or register anything" |
| D8 | Deterministic-only entry | only `previsto:`/`compartido:` prefix without amount | collect on bare nouns | no intent signal without the brain; "gym" keeps helpReply (spec) |

## Open Questions

- None blocking. (Apply-phase detail: exact final wording of the 5 templates; `asked_field` naming is fixed here.)
