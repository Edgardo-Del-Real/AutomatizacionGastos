# Design: Bot Expense Lifecycle

## Technical Approach

Mirror the `CategoryExecutor`/`QueryExecutor` pattern: two new intents (`mark_paid`, `delete_expense`) routed to a new deterministic `MovementLifecycleExecutor` that calls `MovementService.markMovementPaid` and `ExpenseService.deleteExpense` as-is — zero duplicated business logic. Reference resolution is deterministic (category cue → amount cue → recency default; ambiguity reuses `awaiting_movement_selection`). Guards get a punctuation-stripping `normalizeForMatchGuard`; `resolveSuggestion` gains the tolerant fold (B2) plus one static prompt sentence; setup lists real categories and executes batch commands; CR-5 merges the register-during-dialog reply; a one-off owner-scoped script cleans contaminated data. Implements proposal approaches A1, B2+hint, C, D1, E1, F1 against `specs/bot-expense-lifecycle`, `bot-brain`, `telegram-bot`, `conversational-categories`, `movement-categories`, `planned-fixed-expenses`.

## Architecture Decisions

| # | Decision | Choice (vs rejected) | Rationale |
|---|---|---|---|
| D1 | Intents | New `mark_paid`/`delete_expense` in `BOT_INTENTS` (vs overloaded `correct_*` fields) | Proposal A1; one-intent-per-capability is the established pattern; schema enum auto-accepts; `it.each(BOT_INTENTS)` test auto-covers. |
| D2 | Envelope cues | Reuse `category`/`amount` as reference cues; **no new `target` field**; `note` ignored by the executor | Spec delta pins cues to "category and/or amount" and forbids movement ids. `note` is conversational filler ("ya lo pagué") — using it would blur the fixed cue order. |
| D3 | Resolution | Conjunctive cue filters + recency default (vs corrector weighted `score()` with recency tiebreak) | Spec scenario "two PENDING in same category → ask": recency must NOT break a category-cue tie. Recency applies only when both cues are absent (spec: "borra ese gasto" → most recent; "ya lo pagué" + single PENDING → it). |
| D4 | Already-paid | On 0 PENDING cue matches, re-filter the EXPENSE non-PENDING window with the same cues; unique match → call `markMovementPaid` → 409 → conflict reply | Makes the spec's 409 scenario deterministically testable and honest ("el previsto de alquiler ya estaba pagado" beats a confusing "nothing pending"). Keeps the PENDING check in ONE place (repository guarded write). |
| D5 | BotAction | Add `"marked_paid"`, `"deleted_movement"` (vs reusing `registered`/`deleted`) | Reply-prompt wording for `deleted`/`registered` is category/registration-specific; honest actions keep the brain reply grounded. Goldens regenerate anyway (D8). |
| D6 | Selection ask | New `lifecycleSelectionPayloadSchema` beside the correction payload (vs extending `movementSelectionPayloadSchema` into a discriminated union) | Zod `discriminatedUnion` cannot default a discriminator — old persisted payloads would fail to decode. A sibling schema decoded in `handleMovementSelection` is migration-free; the pick logic (`pickMovementSelection`) is shared as-is. |
| D7 | Corrector reuse | Reuse the corrector **pattern** (mine-scope, 10-most-recent window, tie→ask), not its code (vs exporting `toCandidate`/`score`) | Lifecycle candidates need `category` + strict `occurredAt` (tie detection) which `MovementCandidate` lacks; filtering differs per intent. Zero churn in `movement-corrector.ts` keeps its 357-line test file untouched. |
| D8 | CR-5 merged reply | Extend `ExecutionResult` with `abandoned_dialog?: boolean` + a merged `Sender` wrapper in `routeEnvelopeIntent` (vs fix-only merged text) | One reply mechanism (same sender, one send); brain reply stays grounded (abandon fact is a fact); fixed fallback covers brain absence. Scope: ONLY the `routeEnvelopeIntent` register-with-dialog branch — the spec pins D6 fallbacks to "today's rules verbatim". |
| D9 | Prompt strategy | B2: folded `resolveSuggestion` + one static hint sentence in `INTERPRET_SYSTEM_PROMPT` (vs B1 dynamic category list per message) | Proposal B2; no per-message `listCategories` cost, no PII in prompts, goldens stay static. The hint steers the LLM off redirectable intents; the folded resolver is the safety net on every envelope path that reads a category. No extra "run resolver despite `dialog_action: null`" machinery is needed: `dialog_action: null` already routes through `routeEnvelopeIntent` → `executeRegistration` → `resolveSuggestion` (folded). |
| D10 | Cleanup script home | `apps/api/src/scripts/cleanup-phantom-data.ts` (vs `apps/api/scripts/` sibling) | `tsconfig.json` includes `src` → script is typechecked; excluded from `dist` via one line in `tsconfig.build.json`; vitest only picks `*.test.ts`. |
| D11 | Setup batch parser | Pure `parseSetupBatchCommand` exported from `telegram.commands.ts` (new `DELETE_CATEGORY_RE`, reused `REGISTER_RE`/`RENAME_RE`); execution stays in `handleSetupReply` | Keeps `extractCategoryNames`-style purity, reuses tested command regexes + `sliceFromOriginal`, and the parser gets direct unit tests in `telegram.commands.test.ts`. `registrar categoria: X` folds into plain create names (identical effect); only delete/rename need command semantics. |

## Data Flow

Mark-paid sequence (the complex flow; delete is the same shape over the all-movements window):

```
Owner: "el previsto de alquiler lo pagué"
  └─ handleUpdate → idle → handleRegistration (setup gate first, listCategories)
       └─ brain.interpret → {intent:"mark_paid", category:"alquiler"}
            └─ routeEnvelopeIntent("mark_paid") → runMovementLifecycle
                 └─ MovementLifecycleExecutor.markPaid(owner, {category:"alquiler"})
                      1. listMovements(mine) → filter EXPENSE∧PENDING → window[0..10]
                      2. category-cue filter (tolerant fold, both sides)
                      3. 1 left → markMovementPaid(id) ── 409 → already_paid reply
                         0 left → PAID-window fallback → 409 → already_paid / nothingPending
                         >1    → ask: persist lifecycleSelectionPayload, fixed ask reply
                         no cues → unique most-recent (tie → ask)
                 └─ Sender: brain.reply({action:"marked_paid",…}) ?? markPaidReply(...)
       ← ONE reply (dialog pending untouched — lifecycle never consumes it;
         an ask supersedes the dialog, pending stays safe in "otro"/unregistered)
```

Ambiguity pick: `handleUpdate` → `AWAITING_MOVEMENT_SELECTION` → decode lifecycle payload → `pickMovementSelection` (number 1..N / note / amount) → `markPaidById`/`deleteById` → one reply → idle.

**Executor status → reply mapping** (`runMovementLifecycle`; delete mirrors the mark-paid path):

| Executor status | Reply path |
|---|---|
| `executed` | brain reply (`{intent, ok: true, action, amount, category, note}`) ?? `markPaidReply(amount, note, category)` / `deletedMovementReply(amount, note, category)` |
| `already_paid` | brain reply (`ok: false`, `action: "none"`, facts + message) ?? `markPaidAlreadyReply()` = "Ese movimiento ya estaba pagado: no cambié nada." |
| `nothing_pending` (mark_paid) | fixed-only `nothingPendingReply()` = "No encontré ningún gasto previsto pendiente que coincida con eso." |
| `no_match` (delete) | fixed-only `nothingToDeleteReply()` = "No encontré ningún movimiento que coincida con eso para borrar. No borré nada." |
| `missing` | fixed-only `movementMissingReply()` (existing reuse) |
| `ask` | fixed-only `markPaidAskReply(candidates)` / `deleteAskReply(candidates)` + persisted `lifecycleSelectionPayloadSchema` |

`nothingToDeleteReply` is a dedicated template (vs reusing `movementNoMatchReply`): the spec's "No candidate" scenario requires the reply to state BOTH that nothing matched AND that nothing was deleted — the dedicated wording says both, mirroring the mark-paid path.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/features/telegram/bot-brain.ts` | Modify | `BOT_INTENTS` += 2; `BotAction` += `marked_paid`,`deleted_movement`; `ExecutionResult` += `abandoned_dialog?`; prompt sentences + 6 few-shots; dialog addenda/few-shots (awaiting_category, awaiting_registration). |
| `apps/api/src/features/telegram/movement-lifecycle-executor.ts` | Create | Deterministic executor + window builder + cue filters + 409/404 mapping. |
| `apps/api/src/features/telegram/movement-lifecycle-executor.test.ts` | Create | Unit tests (fake services). |
| `apps/api/src/features/telegram/telegram.service.ts` | Modify | `routeEnvelopeIntent` cases + `runMovementLifecycle`; `lifecycleSelectionPayloadSchema` + decode/dispatch in `handleMovementSelection`; folded `resolveSuggestion`; guard-normalized guard sets (7 sites) + single-token rejects (3 sites); setup flow (dynamic question + batch execution); CR-5 merged send. |
| `apps/api/src/features/telegram/reply-text.ts` | Modify | `setupQuestionReply(existing)`; `setupBatchDoneReply`; `markPaidReply`, `markPaidAlreadyReply`, `nothingPendingReply`, `nothingToDeleteReply`, `deletedMovementReply`, `markPaidAskReply`, `deleteAskReply`; capabilities summary + 2 lines. |
| `apps/api/src/features/telegram/telegram.commands.ts` | Modify | `DELETE_CATEGORY_RE` + `parseSetupBatchCommand` export. |
| `apps/api/src/features/categories/matcher.ts` | Modify | New `normalizeForMatchGuard` export; `normalizeForMatch`/`normalizeForMatchTolerant` untouched. |
| `apps/api/src/features/categories/reserved.ts` | Modify | `RESERVED_ALIASES` += `provisorio: "previsto"`; token-level alias check in `resolveReservedConcept` (covers "gasto provisorio"). |
| `apps/api/src/scripts/cleanup-phantom-data.ts` | Create | One-off owner-scoped cleanup (runbook below). |
| `apps/api/tsconfig.build.json` | Modify | `exclude` += `"src/scripts"`. |
| `.gitignore` | Modify | `apps/api/.cleanup-backups/`. |
| Tests: `bot-brain.test.ts`, `telegram.service.test.ts`, `telegram.service.integration.test.ts`, `reply-text.test.ts`, `telegram.commands.test.ts`, `matcher.test.ts` | Modify | New cases; ~40 prompt `toContain` extensions. |
| `__goldens__/` (7 of 10 files) | Modify | Regenerated via `vitest -u`, diff reviewed. |

## Interfaces / Contracts

**Guard normalization** (`matcher.ts`) — strips everything outside `[a-z0-9\s]` after the accent fold, collapses whitespace; `normalizeForMatch` stays byte-identical:

```ts
export function normalizeForMatchGuard(value: string): string {
  return normalizeForMatch(value)
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .join(" ");
}
```

Call sites: `KEEP_OTRO_ANSWERS` (`d6AwaitingCategory` ~:863, `resolveAwaitingCategory` ~:1434); `CATEGORY_AFFIRM_ANSWERS` (~:897, ~:1159, pre-brain interception ~:1292/:1296); `COLLECT_ABANDON_ANSWERS` (`awaitingRegistrationAnswer` ~:1022, ~:1131). Single-token auto-create reject (before `createCategory` at ~:915, ~:1190, ~:1474): guard-normalized token ∈ guard-set union → route to the matching handling (keep-otro abandon / affirm re-ask / collect abandon); guard-normalized empty (`"..."`) → non-answer (list categories, state open).

**Executor**:

```ts
export type LifecycleCues = { category: string | null; amount: number | null };
export type LifecycleCandidate = { id: string; amount: number; note: string | null; date: string; category: string; occurredAtMs: number };
export type LifecycleResult =
  | { status: "executed"; action: "marked_paid" | "deleted_movement"; movement: LifecycleCandidate }
  | { status: "already_paid"; movement: LifecycleCandidate }
  | { status: "missing" }
  | { status: "nothing_pending" }  // mark_paid only
  | { status: "no_match" }         // delete only
  | { status: "ask"; candidates: LifecycleCandidate[] };

export class MovementLifecycleExecutor {
  constructor(deps: { movementService: MovementService; expenseService: ExpenseService });
  markPaid(ownerId: string, cues: LifecycleCues): Promise<LifecycleResult>;   // window: EXPENSE∧PENDING, slice 10
  delete(ownerId: string, cues: LifecycleCues): Promise<LifecycleResult>;      // window: all movements, slice 10
  markPaidById(ownerId: string, movement: LifecycleCandidate): Promise<LifecycleResult>; // 409→already_paid, 404→missing
  deleteById(ownerId: string, movement: LifecycleCandidate): Promise<LifecycleResult>;  // 404→missing
}
```

Category-cue filter: `normalizeForMatchTolerant(candidate.category) === normalizeForMatchTolerant(cue)` (covers exact, plural fold, orphaned names). Amount cue: equality. Windows are mine-scope (`{viewerId, partnerId: null, visibility: "mine"}`), 10 most recent, mirroring the corrector. Naming: the executor's `action` IS the `BotAction` name (D5) — `runMovementLifecycle` copies it straight into `ExecutionResult.action`; there is no naming bridge between executor and reply contract.

**Selection payload** (`telegram.service.ts`, beside `movementSelectionPayloadSchema`; decoded in `handleMovementSelection`, pick shared, then `markPaidById`/`deleteById`):

```ts
export const lifecycleSelectionPayloadSchema = z.object({
  action: z.enum(["mark_paid", "delete_expense"]),
  candidates: z.array(z.object({
    id: z.string().min(1), amount: z.number().positive(),
    note: z.string().nullable(), date: z.string().min(1),
  })).min(1).max(10),
});
```

**Folded `resolveSuggestion` truth table** (spec-pinned asymmetry):

| Suggestion | Owner has | Result |
|---|---|---|
| `"Cafe"`/`"cafes"` | `Cafe` | `Cafe` (exact, then folded) |
| `"Otros"` | `otro` | `otro` — registers in `otro`, **no correction offer** |
| `"otro"` (exact) | any | `null` — no suggestion, otro + correction offer (today's behavior kept; the hint's "usá 'otro'" case) |
| `"Supercado"` | — | `null` — falls back to `otro` |

**Prompt changes** (exact Spanish wording; static constants — NOT `renderDialogContext`, no per-message injection):

`INTERPRET_SYSTEM_PROMPT` — after the `"correct_category"` line:
> `'Para marcar pagado un gasto previsto ya registrado usá "mark_paid": "ya lo pagué", "pásalo a pagado", "el previsto de alquiler lo pagué". Para borrar un gasto ya registrado usá "delete_expense": "borra ese gasto", "borralo", "borrá el de cafe". Nunca son "register_expense": no crean movimientos ni categorías. En "mark_paid" y "delete_expense", "category" y/o "amount" identifican el movimiento ya registrado (ej: "Alquiler" en category, 2500 en amount); si el mensaje no trae referencia usá null en ambos y el bot usa el más reciente. Nunca inventes ids.'`

`INTERPRET_SYSTEM_PROMPT` — right after the `'"category" es una sugerencia…'` line (the B2 hint):
> `'"category" se resuelve contra las categorías existentes del dueño: sugerí el nombre más parecido a una existente (los plurales valen, ej: "cafes" para "Cafe"); si nada se parece usá "otro", la categoría de respaldo. Nunca inventes categorías nuevas.'`

`FEW_SHOTS` += 6: `"ya lo pagué"`→`mark_paid` (all-null cues); `"el previsto de alquiler lo pagué"`→`mark_paid`+`category:"alquiler"`; `"ya lo pagué, los 2500"`→`mark_paid`+`amount:2500`; `"borra ese gasto"`→`delete_expense`; `"borra el de cafe"`→`delete_expense`+`category:"cafe"`; anti-degradation `"marcá pagado el gasto de 2500"`→`mark_paid`+`amount:2500` (NOT `register_expense`).

`REPLY_SYSTEM_PROMPT` +=: `"marked_paid = el gasto previsto quedó pagado — confirmalo con amount y category, y que ya suma en los gastos;"`, `"deleted_movement = el gasto se borró — confirmalo con amount y category;"`, `"Si abandoned_dialog es true: el registro nuevo reemplazó un diálogo anterior que dejaste sin efecto — confirmá ambos hechos en el mismo mensaje, sin contradecirte."` Capabilities enumeration += marcar pagado / borrar gasto.

`DIALOG_INTERPRET_ADDENDUM` (`awaiting_category`, `awaiting_registration`): extend the enumeration to `'Cualquier otra cosa (consulta, registro nuevo, crear categoría, marcar pagado o borrar un gasto) es "dialog_action" null con su intent real.'` + one lifecycle few-shot each (`"ya lo pagué"` → `dialog_action:"null"` mark_paid; `"borralo"` → delete_expense), full key set like existing dialog shots. `awaiting_amount_confirmation` addendum/few-shots: unchanged.

**CR-5**: `ExecutionResult` += `abandoned_dialog?: boolean`. In `routeEnvelopeIntent`'s `register_expense`-with-dialog branch: clear state (as today), do NOT send the abandon template; pass a merged `Sender` into `executeRegistration` (new optional `send?: Sender` param, threaded to its existing `send` consumers):

```ts
const base = this.makeSender(true, reply);
const merged: Sender = async (result, fixed) =>
  base({ ...result, abandoned_dialog: true }, `${abandonedTemplate} ${fixed}`);
```

**Reserved alias + token-level alias guard** (`reserved.ts`): `RESERVED_ALIASES` += `provisorio: "previsto"` (plural fold already reduces "provisorios"; feminine "provisoria(s)" out of spec — documented). Full-name lookup alone misses the observed phantom — "gasto provisorio" folds to the two-token `"gasto provisorio"`, which is neither an alias key nor a reserved member — so `resolveReservedConcept` gains a token-level alias check after the full-name checks: if ANY token of the folded name is a `RESERVED_ALIASES` key, resolve to its concept. Scope criterion (anti-over-block): the token check applies ONLY to the guard-only misspelling aliases (`provisto`, `provisorio`) — NEVER to the general `RESERVED_CONCEPTS` (`otro`, `previsto`, `ahorro`, `compartido`), which stay full-name-equality only. Rationale: a misspelling token can never be a legitimate part of an owner category name, while real concept words legitimately occur inside longer names ("un otro gasto") and must stay creatable.

```ts
export function resolveReservedConcept(name: string): ReservedConcept | null {
  const folded = normalizeForMatchTolerant(name);
  const aliased = RESERVED_ALIASES[folded];
  if (aliased !== undefined) {
    return aliased;
  }
  if (RESERVED_FOLDED_SET.has(folded)) {
    return folded as ReservedConcept;
  }
  // Token-level alias guard: a name CONTAINING a guard-only misspelling
  // token ("gasto provisorio") is the same concept attempt — rejected.
  for (const token of folded.split(" ")) {
    const tokenAliased = RESERVED_ALIASES[token];
    if (tokenAliased !== undefined) {
      return tokenAliased;
    }
  }
  return null;
}
```

Truth table:

| Input | Folded | Full-name check | Token-alias check | Outcome |
|---|---|---|---|---|
| `"provisorio"` | `"provisorio"` | alias hit | — | rejected → previsto redirect |
| `"provisorios"` | `"provisorio"` (plural fold) | alias hit | — | rejected |
| `"gasto provisorio"` | `"gasto provisorio"` | miss | token `"provisorio"` ∈ aliases | rejected → previsto redirect |
| `"gastos provisorios"` | `"gasto provisorio"` (both folds) | miss | token hit | rejected |
| `"otro"` | `"otro"` | ∈ reserved set | — | rejected (today) |
| `"un otro gasto"` | `"un otro gasto"` | miss | `"otro"` is a concept, not an alias — no token check | created (no over-blocking) |

Call site: unchanged — `resolveReservedConcept` runs inside `CategoryService.createCategory`/`renameCategory` (~:27-33, ~:71-74) before availability, so every category creation path inherits it. Coverage: every creation path funnels through those guards (commands, `CategoryExecutor`, setup batch, 3 single-token auto-creates, corrector target); expense paths resolve-or-`otro` and never create categories — no new guard surface needed.

**Setup**: `setupQuestionReply(existing: string[])` — 0 categories: today's text + command examples; N: `Tus categorías actuales:\n- …\nMandá categorías nuevas, o comandos como "borrar categoria: X" / "renombrar categoria: X a: Y".` Both `configurar` (~:1891) and the setup gate (~:321) pass the fetched list. `handleSetupReply`: split tokens, classify via `parseSetupBatchCommand` (delete/rename execute through `CategoryService` with per-command honest outcomes; `registrar categoria: X` folds into plain names), creates as today, `ensureOtro` unchanged, one `setupBatchDoneReply` summary.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | `normalizeForMatchGuard` (cases + `normalizeForMatch` untouched); `provisorio` alias full table (incl. phrase forms "gasto provisorio"/"gastos provisorios" and the no-over-block case "un otro gasto"); `parseSetupBatchCommand`; executor windows/cues/recency/409/404; `resolveSuggestion` truth table; guard sites ("no.", "si.", "no," never create); setup batch (no literal phantoms); CR-5 exactly-one-reply; `handleMovementSelection` lifecycle picks | vitest, fakes; `matcher.test.ts`, `reserved` via service paths, `telegram.commands.test.ts`, `movement-lifecycle-executor.test.ts`, `telegram.service.test.ts`, `reply-text.test.ts`, `bot-brain.test.ts` (~40 `toContain` extensions) |
| Integration | "ya lo pagué" PENDING→PAID in DB; "borralo" row gone; already-paid → 409 reply, no state change; two PENDING → ask → "2" → paid; setup lists real categories, batch delete executes | `telegram.service.integration.test.ts` (Fastify inject + Prisma test DB) |
| Goldens | Prompt/intents/few-shots changes | Regenerate, review, re-run (below) |

**Golden regeneration order** (discovery: the test pins **10** golden files, not 8 — proposal count was off): expected to change — `interpret-system-prompt.txt`, `interpret-few-shots.json`, `reply-system-prompt.txt`, `dialog-awaiting-category-addendum.txt`, `dialog-awaiting-category-few-shots.json`, `dialog-awaiting-registration-addendum.txt`, `dialog-awaiting-registration-few-shots.json` (7). Expected byte-identical — `dialog-awaiting-amount-confirmation-addendum.txt` + its few-shots, `dialog-context-rendered.txt` (3). Procedure: run suite (RED) → `pnpm --filter @rita/api exec vitest run -u` → `git diff` the `__goldens__` — accept ONLY the intended sentences/shots; investigate any of the 3 unchanged files differing → full suite green. All in the same change (spec "Prompt changes regenerate goldens in-cycle").

## Threat Matrix

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No executable/doc-like file classification introduced. |
| Git repository selection | N/A | No `git -C`/repo-selection code. |
| Commit state | N/A | No commit-state manipulation. |
| Push state | N/A | No push automation. |
| PR commands | N/A | No PR automation. |

No routing/shell/subprocess/VCS/PR boundary in this change — the cleanup script is a manually-run tsx runbook step (data safety below), and intent routing is application-internal.

## Migration / Rollout

No schema/migration changes. Cleanup script runbook (post-apply, real DB — `DATABASE_URL` → `automatizacionrita`, NOT the `_test` DB; docker compose up; confirm owner id first — default `default`):

1. **Pre-assert**: the 4 phantom categories exist by exact name (`"No."`, `"Borrar categoría: no"`, `"si"`, `"gasto provisorio"`); junk expense (owner, 30000, category `"No."`, PAID) exists; valid PENDING 30000 "gastos hormiga" exists (capture row). If all phantoms absent AND the valid expense intact → print "already clean", exit 0 (safe re-run). Any partial drift → abort exit 1 with the report.
2. **Backup**: write every to-be-deleted row (full JSON) to `apps/api/.cleanup-backups/cleanup-phantom-data-<ISO-timestamp>.json` BEFORE deleting.
3. **Delete**: junk expense via `expenseService.deleteExpense(id, ownerId)`; phantoms via `categoryService.deleteCategory` (service guards for free; pre-change NORMAL categories stay deletable — the new alias does NOT block deletes per spec). Does NOT touch the PENDING "gastos hormiga" expense (independent rows — categories carry no FK).
4. **Verify**: exactly one category folds to `"otro"` (report only, no auto-fix); post-assert phantoms gone; valid PENDING row identical to the captured pre-row. Exit 0 only if every assertion passes.

## Open Questions

- [ ] Confirmed owner id for the cleanup runbook step (proposal dependency — must be confirmed before running).
- [ ] Feminine reserved forms ("provisoria"/"provisorias") are outside the spec'd alias set — add later if observed in the wild?
