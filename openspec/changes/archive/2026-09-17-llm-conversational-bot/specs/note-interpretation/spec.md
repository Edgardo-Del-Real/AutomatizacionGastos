# Delta for Note Interpretation

## REMOVED Requirements

### Requirement: Note Interpreter Port

(Reason: superseded — the extraction-only `NoteInterpreter` port is replaced by the two-method `BotBrain` port (`interpret` + `reply`); the Groq client and `normalizeAmountString` are reused verbatim.)
(Migration: bot-brain "Bot Brain Port"; swap `TelegramServiceDeps.interpreter` for the brain.)

### Requirement: Degrade-to-Null Contract

(Reason: survives — absorbed into the bot brain with the same failure classes and never-throw policy.)
(Migration: bot-brain "Degrade-to-Null Contract", extended to cover both `interpret` and `reply`.)

### Requirement: Amount Normalization and Validation

(Reason: survives — `normalizeAmountString` and the zod amount transform are reused verbatim.)
(Migration: bot-brain "Amount Normalization and Validation".)

### Requirement: Category Suggestion Contract

(Reason: survives — suggestions still never auto-create categories and resolve via exact `normalizeForMatch`.)
(Migration: bot-brain "Category Suggestion Contract"; enforcement stays in the bot layer.)

### Requirement: Deterministic-First Invocation

(Reason: replaced — the brain now fires for every non-command `idle` message (intent-first); keyword rules still beat suggestions and execution stays deterministic.)
(Migration: telegram-bot "Intent-First Message Handling" and "Movement Parsing, Classification and Categorization".)

### Requirement: Amount Precedence and Product Rules

(Reason: superseded — precedence now includes the "mil" stance refinement and the deterministic-note-wins rule; the amount-conflict question still exists for genuine disagreements.)
(Migration: telegram-bot "Movement Parsing, Classification and Categorization" + bot-brain "Reply-After-Action Contract".)

### Requirement: Amount-Conflict Question Lifecycle

(Reason: unchanged behavior — the conflict question and its abandonment/restart semantics survive, now owned by the bot-layer state machine.)
(Migration: telegram-bot "Per-Owner State Machine" (unchanged canonical requirement).)

### Requirement: Environment Configuration

(Reason: survives — the same four env vars and zod validation are reused unchanged.)
(Migration: bot-brain "Environment Configuration".)

### Requirement: Timeout, No-Retry, and Injectable Fetch

(Reason: survives — single attempt, `AbortSignal.timeout`, no retries, injectable `fetchImpl`.)
(Migration: bot-brain "Timeout, No-Retry, and Injectable Fetch".)