```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:be696755255f1f1990dfbe318e8647785b2331a5a94fa01933664cf91f76fc6a
verdict: pass
blockers: 0
critical_findings: 0
requirements: 15/15
scenarios: 56/56
test_command: pnpm --filter @rita/api test
test_exit_code: 0
test_output_hash: sha256:17a0430b98fc0b7a4d86905fed7816f3c2eb374b32abd109adad0dd9b8c64ce0
build_command: pnpm --filter @rita/api typecheck && pnpm --filter @rita/api lint
build_exit_code: 0
build_output_hash: sha256:6082e8715c0a5ec6b82acc1ea6612f93b9b7cd85c8b12220e1ebcff314a8ddae
```

# VERIFY-REPORT: bot-conversation-controller

**Verdict: PASS** — implementation matches the 3 delta specs (movement-correction, bot-brain, telegram-bot), the design, and all 15 tasks. Ready for archive.

## Evidence

| Check | Command | Exit | Result |
|---|---|---|---|
| Full test suite | `pnpm --filter @rita/api test` | 0 | **557 passed / 0 failed (22 files)**, 44.05s (Postgres :5433 / automatizacionrita_test reachable; integration ran) |
| Typecheck | `pnpm --filter @rita/api typecheck` | 0 | Clean (`tsc -p tsconfig.json`) |
| Lint | `pnpm --filter @rita/api lint` | 0 | Clean (`eslint src`) |

Branch verified: `feat/bot-conversation-controller` @ `f7b507f8c6013801d34ccc526028951d679f2670` (3 feature commits: `e3d8e4f`, `680f355`, `bca4be1` on top of `dev` @ `6143797`). No branch switch, no code modification.

## Coverage (authoritative counts from the 3 delta specs)

**15 requirements / 56 scenarios — all covered by tests or golden-pinned prompts.**

| Domain | Reqs | Scenarios | Coverage |
|---|---|---|---|
| movement-correction | 4 | 9 | 9/9 — `movement-corrector.test.ts` (15 unit), service selection/pick tests, integration restart-survival loop |
| bot-brain | 5 | 16 | 16/16 — schema cases, context rendering, prompt contracts, 8 golden snapshots |
| telegram-bot | 6 | 31 | 31/31 — service dialog-routing suite, integration loops (`app.inject`, real Prisma, stubbed brain) |

Notable mappings: bare-affirmation-never-resolves (phantom tests: bare "si", missing pending, corrupt payload, never reads `envelope.amount`), D6-verbatim fallback (byte-diffed old `handleAwaitingCategory`/`handleAwaitingAmountConfirmation` vs extracted `d6*` — identical code), query/CRUD pending-intact, single-interpret register-during-dialog (mock called once), selection restart survival, then_reassign no-pending ignore.

## Design Conformance (spot-checked in code)

- **Brain-routed dialogs**: `handleDialogMessage` interprets with `buildInterpretContext(state)`; routes `resolve` → `resolveDialog`, `abandon`/null/absent → `d6DialogFallback`, `null` → `routeEnvelopeIntent(..., {state})`. ✓
- **Phantom guard**: resolve acts only on `state.pendingMovementId` / decoded `amountConfirmationPayloadSchema`; amount = `normalizeAmountString(body) ?? parseAmount(body)` matched against `payload.amounts` — `envelope.amount` never read; bare "si" → `questionDroppedReply()`, not reprocessed. ✓
- **Movement corrector**: 10-movement window, weighted 8/4/2/2/1, ties → ask; `awaiting_movement_selection` persisted in `pendingNote` (schema-validated), deterministic `pickMovementSelection` (number 1..N / note / unique amount); never touches bot state. ✓
- **then_reassign**: guarded by `create_category && ok && then_reassign===true && pendingMovementId!==null`; one `categoryCreatedReassignedReply`; failure → created reply + `movementMissingReply`; no pending → ignored. ✓
- **Pending-safe router**: query/CRUD/capabilities/correct paths never clear dialog state; only `register_expense` abandons. ✓
- **7 reply templates** + `created_reassigned` branch in `categoryCommandReplyTemplate`; ask/dropped/no-match replies fixed-only (D8). ✓
- **Goldens**: 8 committed snapshots (`interpret-system-prompt.txt`, `reply-system-prompt.txt`, 2 dialog addenda, 2 dialog few-shots, rendered-context fixture) all pinned by `toMatchFileSnapshot`. ✓
- **Scope**: diff limited to `apps/api/src/features/telegram/*` + goldens; `app.ts`, `env.ts`, package.json untouched; no new dependencies; no scope creep.

## Divergences from Design (8 documented in apply-progress — all evaluated acceptable/spec-faithful)

1. Recency as tie-breaker only (not standalone matcher) — required by "reference matches nothing → no_match"; spec-faithful. **Acceptable.**
2. `CorrectionResult` gains `{status:"missing"}` — required to surface spec "Missing movement degrades" (clear reply, nothing created). **Acceptable.**
3. Injectable `now: Date` clock — additive, deterministic recency tests. **Acceptable.**
4. Null-category resolve → `questionDroppedReply()` instead of `categoryNotFoundReply` — phantom-guard rule 3 and "resolve must not invent categories" win; multi-word non-match still lists categories + stays open. **Acceptable.**
5. Corrupt amount-confirmation payload → D6 fallback without brain call — no context can be built from garbage; brain null/absent → D6 verbatim. **Acceptable.**
6. `runMovementCorrection` dropped unused `dialog` param — lint-driven, never read. **Acceptable.**
7. `dialog_action`/`then_reassign` typed optional — zod defaults both on parse; permissive typing avoids mock churn, semantics identical (undefined ≡ null/false). **Acceptable.**
8. Empty window + empty reference → `no_match` — spec "Empty window" pins the no-match reply; an ask with zero candidates would fail the payload schema (`.min(1)`). **Acceptable.**

## Blockers / Criticals

None. No uncovered requirements or scenarios; no failing checks; no contradiction with spec or design.

## Warnings

None at change level. (Pre-existing repo infra flake documented as suggestion below, not introduced by this change.)

## Suggestions

- Pre-existing infra flake (not introduced here): `expenses.route.test.ts` `beforeAll` migrate-deploy 10s timeout in one baseline run; passes in isolation (17/17) and in the final full run (557/557).
- Design open questions resolved by defaults: recency bucket constants (48h/7d) and weights are tunable; selection pick accepts number + note + unique amount (no ordinal words), as designed.
- Brain-absent wiring (`app.ts` conditional `GroqBotBrain`) is verified via env tests + null-brain service behavior; no direct construction test exists for the absent-key path.

## Archive-Time Notes

- Commit/revert boundary: revert branch to `dev` (6143797) restores today's D6 rules; unset `GROQ_API_KEY` → dialogs degrade to D6 verbatim; stale `awaiting_movement_selection` rows degrade via corrupt-payload path (clear + dropped reply).
- No migration needed: `BotState.state` is a TEXT column; `"awaiting_movement_selection"` is a new value, not a schema change.
- Single PR boundary: 17 files changed (~2,495 insertions, 59 deletions incl. goldens); review budget ~2,300 changed lines as forecast.
- Real Groq endpoint never hit during tests (fake `fetchImpl` / stubbed brain everywhere).
- Recommendation: proceed to archive (sync deltas into canonical specs), then PR.