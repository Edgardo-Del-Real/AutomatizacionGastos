# Design: Bot Conversation Controller

## Technical Approach

The brain becomes the conversation controller in every non-command state; deterministic executors stay authoritative. `telegram.service.ts` replaces the two dialog handlers with one brain-routed `handleDialogMessage` that calls `interpret(body, {state, pending, openQuestion})` and routes on `dialog_action`: `resolve` → resolution from the persisted payload only (phantom guard), `abandon`/brain-null/absent → today's D6 cascade verbatim (extracted, single fallback), `null` → a shared intent router where queries/CRUD/corrections execute without consuming the pending and `register_expense` abandons + registers from the same envelope (one brain call per message). A new `movement-corrector.ts` turns the `correct_category` reference into a unique reassignment or a persisted `awaiting_movement_selection` question whose pick is resolved deterministically.

## Architecture Decisions

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|---|
| D1 | Dialog fallback | One extracted D6 cascade (today's `handleAwaitingCategory`/`handleAwaitingAmountConfirmation` bodies verbatim), triggered by brain-absent, brain-`null`, or `dialog_action:"abandon"` | Per-classification abandon handlers | Spec pins "abandon or brain null/absent → today's D6 rules verbatim"; one path cannot drift from the fallback contract |
| D2 | Phantom guard | Resolve acts only on `state.pendingMovementId` / decoded `amountConfirmationPayloadSchema`; chosen amount = `normalizeAmountString(body) ?? parseAmount(body)` matched against `payload.amounts` — `envelope.amount` is never read in resolve | Trust `envelope.amount` when brain says resolve | Bare "si" must never fabricate a registration; spec forbids inventing amounts |
| D3 | Matcher scoring | Weighted integer table (below); full-score ties ask | Recency auto-pick on ties | Pinned scenario "repeated amount without note asks"; recency only breaks ties when buckets differ |
| D4 | Selection state | New `awaiting_movement_selection` value; candidates JSON in `pendingNote` (amount-conflict precedent); pick resolved deterministically (no brain) | Brain-routed pick; in-memory candidates | Restart survival is pinned; candidates are already known — brain routing adds misroute risk with zero gain |
| D5 | Brain calls | `register_expense` with `dialog_action:null` during a dialog reuses the same envelope (no second `interpret`) | Today's abandon → `handleRegistration` re-interpret | Same classification, half the latency, no inter-call drift |
| D6 | `then_reassign` | Schema-permissive boolean (default false); controller reads it only when `intent==="create_category"` AND a pending movement exists | Schema refinement rejecting stray `true` | A stray flag must not null the whole envelope (heavy D6 penalty) |
| D7 | Correction target category | Exact normalized match, else auto-`createCategory` (single-token precedent); duplicate race → use existing | "Missing category" reply | "esos 2500 → gastos hormiga" works without pre-created categories; typos are recoverable by correcting again |
| D8 | Ask/dropped replies | Candidates lists, no-match, dropped, and abandon notices are fixed-only (no `brain.reply` call) | LLM-rewritten candidate lists | Misnumbered lists are a real drift hazard; mirrors the D7-fixed-error convention |

## Data Flow

```
Telegram update
 │ dedupe → owner → empty → parseCommand ──► handleCommand (deterministic, every state)
 ▼
BotState.get ──► state?
 ├─ awaiting_setup ────────────► handleSetupReply (deterministic, unchanged)
 ├─ awaiting_category / awaiting_amount_confirmation
 │    ▼ brain.interpret(body, {state, pending, openQuestion})
 │    ├─ brain absent / null / dialog_action:"abandon" ──► D6 cascade (verbatim fallback)
 │    ├─ dialog_action:"resolve" ──► persisted-payload resolution (phantom guard)
 │    └─ dialog_action:null ──► routeEnvelopeIntent (pending-safe)
 ├─ awaiting_movement_selection ─► deterministic pick | abandon + normal processing
 └─ idle ──► brain.interpret(body) ──► routeEnvelopeIntent
      ├─ query* ──► QueryExecutor (real data)
      ├─ create/delete/rename ──► CategoryExecutor (+ then_reassign chain)
      ├─ correct_category ──► MovementCorrector ──► updateMovement | ask (selection state)
      └─ register_expense ──► registration flow (dialog abandoned first, same envelope)
```

## Orchestration Flow (telegram.service.ts)

- `handleUpdate`: unchanged until state dispatch; `awaiting_category`/`awaiting_amount_confirmation` → new `handleDialogMessage(state, body, reply)`; `awaiting_movement_selection` → new `handleMovementSelection`; idle → `handleRegistration` (interpret without context, as today).
- `handleDialogMessage`: (1) `envelope = tryBrainInterpret(body, buildInterpretContext(state))`; (2) `null` or `dialog_action==="abandon"` → extracted `d6AwaitingCategory` / `d6AwaitingAmountConfirmation` (today's bodies verbatim); (3) `resolve` → `resolveDialog`; (4) `null` → `routeEnvelopeIntent(envelope, body, reply, {state})`.
- `resolveDialog(state, envelope, body, reply)`:
  - `awaiting_category`: `pendingMovementId===null` → phantom (clear + `questionDroppedReply()`, return). Else run the D6 answer cascade with `envelope.category` as the candidate answer: exact normalized match → `answerCorrection`; single token → `createCategory` + `answerCorrection`; null/multi-word non-match → `categoryNotFoundReply` listing, state stays open.
  - `awaiting_amount_confirmation`: `decodeConfirmationPayload` null → phantom. Else `replied = normalizeAmountString(body) ?? parseAmount(body)`; no match in `payload.amounts` → phantom (never `envelope.amount`, never reprocess). Match → register from stored payload (`registerWithCategory` / `registerOtroWithCorrection`), as today.
- `routeEnvelopeIntent(envelope, body, reply, dialog?)` — shared by idle (`dialog=null`) and dialog-null-action: `query*` → `executeQuery`; `associate_keyword`/`off_topic`/`help`/`correct_amount`/`capabilities` → as today; CRUD → `executeCategoryCommand`, then if `create_category && ok && then_reassign && dialog?.pendingMovementId` → `updateMovement` + clear state + ONE `categoryCreatedReassignedReply` (reassign failure → clear + `categoryCreatedReply` + `movementMissingReply`); `correct_category` → `runMovementCorrection`; `register_expense` → if dialog: clear state + abandon reply (`correctionAbandonedReply` / `amountConfirmationAbandonedReply`) then `executeRegistration(body, parsed, envelope, categories, send)` reusing this envelope.
- `runMovementCorrection(envelope, reply, dialog)`: `envelope.category===null` → fixed `helpReply()`. Else `result = movementCorrector.correct(ownerId, {amount: envelope.amount, note: envelope.note}, envelope.category)`; `reassigned` → sender with `{intent:"correct_category", ok:true, action:"registered", amount, category, note}` (fixed: `movementCorrectionDoneReply`); `no_match` → fixed `movementNoMatchReply()`; `ask` → persist `{state: awaiting_movement_selection, pendingMovementId: null, pendingNote: JSON{category, candidates}}` + fixed candidates reply. A selection ask supersedes an open dialog (its pending is safe: movement stays in "otro" / nothing registered).
- `handleMovementSelection(state, body, reply)` (deterministic, no brain): decode `movementSelectionPayloadSchema`; corrupt → clear + `questionDroppedReply()` + `handleRegistration(body)`. Pick: (a) integer 1..N via `normalizeAmountString`; (b) normalized note equality/containment matching exactly one candidate; (c) amount matching exactly one candidate. Pick → `updateMovement(id, {category})` → clear + `correctionDoneReply(category)` (`NotFoundError` → clear + `movementMissingReply()`). No pick → clear + `movementSelectionAbandonedReply()` + `handleRegistration(body, reply)` (processed normally).
- `buildInterpretContext(state)`: `awaiting_category` → `{state, pending:{movementId, note}, openQuestion}` where `openQuestion` reconstructs from payload (`¿Querés asignarle otra categoría al movimiento "X"? Escribí el nombre o "no".`); `awaiting_amount_confirmation` → presented `amounts`/`note`/`category` + `openQuestion = amountConflictReply(a, b)` (proposal default: reconstruct).

## Movement Correction Matcher (movement-corrector.ts)

```ts
export type MovementCandidate = { id: string; amount: number; note: string | null; date: string; type: MovementType };
export type MovementReference = { amount: number | null; note: string | null };
export type CorrectionResult =
  | { status: "reassigned"; movement: MovementCandidate; category: string }
  | { status: "ask"; reason: "ambiguous" | "no_reference"; candidates: MovementCandidate[]; category: string }
  | { status: "no_match" };
export class MovementCorrector {
  constructor(movementService: MovementService, categoryService: CategoryService) {}
  async correct(ownerId: string, reference: MovementReference, targetCategory: string): Promise<CorrectionResult>;
}
```

`correct()` resolves the target (D7), fetches the window (`listMovements(ownerId, {})` is `ORDER BY occurredAt DESC` → slice 10), scores, and on unique calls `updateMovement(ownerId, id, {category})` (`NotFoundError`/`ValidationFailedError` → error result surfaced as fixed reply, nothing created). It never touches bot state.

| Signal | Rule | Points |
|---|---|---|
| Exact amount | `ref.amount≠null && candidate.amount===ref.amount` | 8 |
| Note exact | `normalizeForMatch` equality | 4 |
| Note partial | every normalized ref token ⊆ candidate note | 2 |
| Recency hot | `occurredAt` within 48h | 2 |
| Recency warm | within 7×24h | 1 |

Outcome: empty reference (`amount==null && note==null`) → `ask/no_reference` with the whole window; else best = max score; best===0 → `no_match` (covers empty window); exactly one at best → reassign; ≥2 at best → `ask/ambiguous` listing only tied top candidates. Weights make amount (8) dominate noteExact+recency (6); amount+note dominates amount-only; evidence ties fall to recency buckets; total ties ask.

## Phantom Guard (exact rule)

1. Payload must exist and parse (`pendingMovementId` non-null for `awaiting_category`; `amountConfirmationPayloadSchema` decodes for amount confirmation) — else clear + `questionDroppedReply()`, nothing registers, no reprocessing.
2. The acted-on value comes from the message matched against the persisted payload (category via the D6 cascade over existing categories; amount via `payload.amounts` equality) — never from `envelope.amount`.
3. A resolve that matches nothing (bare "si") → abandon with the dropped reply; NOT reprocessed as registration (brain-null fallback keeps today's reprocess behavior).

## Interfaces / Contracts (bot-brain.ts)

```ts
export type InterpretContext =
  | { state: "awaiting_category"; pending: { movementId: string | null; note: string | null }; openQuestion: string }
  | { state: "awaiting_amount_confirmation"; pending: { amounts: [number, number]; note: string | null; category: string | null }; openQuestion: string };
// replaces the Fase-2 { categories?: readonly string[] } stub; prompt stays category-blind

// conversationEnvelopeSchema additions:
dialog_action: z.enum(["resolve", "abandon"]).nullable().default(null),
then_reassign: z.boolean().default(false),
// BotAction += "asked_movement" | "created_reassigned"
```

`GroqBotBrain.interpret(message, context?)`: without context → today's prompt/few-shots. With context → system = `INTERPRET_SYSTEM_PROMPT + " " + DIALOG_INTERPRET_ADDENDUM[context.state] + " " + renderDialogContext(context)`; messages = `[...FEW_SHOTS, ...DIALOG_FEW_SHOTS[context.state], {user: message}]`. `INTERPRET_SYSTEM_PROMPT` gains: JSON keys line includes `dialog_action`/`then_reassign`; `dialog_action` semantics; `correct_category` reference extraction (`amount`/`note` identify the movement, `category` is the target); `then_reassign` for "creá X y guardalo ahí". `REPLY_SYSTEM_PROMPT` gains `asked_movement` and `created_reassigned` action lines. `dialog_action` is read only in dialog states; idle ignores it. **Goldens**: regenerate `interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt`; add `dialog-{awaiting-category,awaiting-amount-confirmation}-addendum.txt`, matching `-few-shots.json`, and a rendered-context fixture snapshot.

## reply-text.ts Additions

- `movementAmbiguousReply(reference, candidates)` — "¿Cuál de estos movimientos corrijo?" + numbered `n) DD/MM · $ X · nota` lines
- `movementNoReferenceReply(candidates)` — "¿Qué movimiento querés corregir?" + same numbered list
- `movementNoMatchReply()` — no movement matched / empty window
- `movementSelectionAbandonedReply()` — question dropped, nothing changed
- `questionDroppedReply()` — phantom-guard abandon (no "now registering" wording)
- `movementCorrectionDoneReply(category, amount, note)` — reassignment confirmed with the movement's facts
- `categoryCreatedReassignedReply(category)` — mixed create+reassign, one reply
- `categoryCommandReplyTemplate`: branch for `created_reassigned`

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/features/telegram/movement-corrector.ts` | Create | Matcher + reassign executor (D3/D7) |
| `apps/api/src/features/telegram/movement-corrector.test.ts` | Create | Scoring table, outcomes, target resolution |
| `apps/api/src/features/telegram/bot-brain.ts` | Modify | `InterpretContext`, envelope +`dialog_action`/`then_reassign`, `BotAction`, dialog addenda/few-shots/render, `interpret(message, context)` |
| `apps/api/src/features/telegram/bot-brain.test.ts` | Modify | Schema cases, context rendering, goldens |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | Dialog controller, phantom guard, shared intent router, selection handler, `correct_category` wiring |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Modify | `BOT_STATES` + `"awaiting_movement_selection"` |
| `apps/api/src/features/telegram/reply-text.ts` / `.test.ts` | Modify | Templates above + tests |
| `apps/api/src/features/telegram/telegram.service.test.ts` | Modify | Orchestration coverage |
| `apps/api/src/features/telegram/telegram.service.integration.test.ts` | Modify | Full loops with stubbed brain |
| `apps/api/src/features/telegram/__goldens__/*` | Modify | Regenerate + new dialog goldens |

`app.ts` unchanged — `MovementCorrector` is constructed inside `TelegramService` from existing deps (QueryExecutor precedent).

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (bot-brain) | Envelope zod: `dialog_action` values/defaults/invalid→null, `then_reassign` decode; context rendering; goldens | Existing patterns, `toMatchFileSnapshot` |
| Unit (matcher) | Every spec scenario: unique amount, note disambiguation, same-bucket tie asks, recency-bucket tie-break, empty window, no reference, auto-create target, `updateMovement` failure | Pure `MovementCorrector` with mocked services, fixed `occurredAt` dates |
| Unit (reply-text) | New templates | Existing table style |
| Service | Dialog routing per `dialog_action`; queries/CRUD pending-intact; mixed create+reassign; register-during-dialog single `interpret` call (assert mock called once); phantom (bare "si", missing pending, corrupt payload); selection pick by number/note; abandon + reprocess | Existing `makeHarness` with mock brain |
| Integration | Full loops with stubbed brain: register→otro→query→resolve; ambiguous correction→pick; selection payload restart survival | `app.inject`/service-level against test DB (config prerequisites) |

Existing tests that change: prompt goldens (regen), envelope schema tests (new fields default cleanly), idle `correct_category` (was help reply → corrector flow). Unchanged: parser, mil-stance, commands, setup.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The change is an in-process Telegram state machine; the only new external input (LLM JSON) is zod-validated and never executes anything.

## Migration / Rollout

No migration. `BotState.state` is a TEXT column — the new value needs no Prisma migration (amount-conflict precedent). Rollback: revert the slice; unset `GROQ_API_KEY` → dialogs return to today's D6 rules. Stale `awaiting_movement_selection` rows from a rollback degrade via the corrupt/non-answer path (clear + dropped reply).

## Open Questions

- [ ] Recency bucket boundaries (48h→2, 7d→1) and weights — confirm before apply (tunable constants).
- [ ] `correct_category` auto-creates a missing target category (D7) — confirm vs "missing category" reply.
- [ ] Selection pick accepts ordinal words ("el segundo")? Default: number + note + unique amount only.
