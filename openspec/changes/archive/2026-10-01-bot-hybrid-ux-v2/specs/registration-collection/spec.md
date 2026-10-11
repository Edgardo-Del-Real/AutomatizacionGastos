# Delta for Registration-Collection

## REMOVED Requirements

### Requirement: Collect Dialog State and Payload

(Reason: the `awaiting_registration` dialog is eliminated — capture is a one-shot `monto+nota` from a menu tap with a mandatory button-chosen category; there is no amount-null or category-unresolved entry anymore.)
(Migration: captured messages with a missing amount re-prompt in `awaiting_capture`; the category is mandatory at the preview. Leftover `awaiting_registration` payloads from a rollback recover to `idle` per the corrupt-payload discipline.)

### Requirement: Deterministic Entry and Persistence

(Reason: the entry points (a `register_expense` envelope with amount null, an unresolvable category intent) no longer exist — the brain never registers and never suggests categories.)
(Migration: none — replaced by quick-capture's `awaiting_capture`/`awaiting_preview` flow.)

### Requirement: Amount-Answer Resolution

(Reason: no collected-amount dialog remains; amounts parse once at capture and re-prompt deterministically.)
(Migration: telegram-bot Movement Parsing delta covers the `awaiting_capture` re-prompt.)

### Requirement: Category-Answer Cascade

(Reason: categories are chosen by buttons at the preview and the correction reassign row; text answers to dialogs do not exist.)
(Migration: conversational-categories and quick-capture deltas define the button-chosen behavior.)

### Requirement: Abandon Handling

(Reason: the collect dialog and its abandon replies are removed with the dialog states.)
(Migration: a menu tap supersedes any pending flow; nothing is persisted to abandon.)

### Requirement: Non-Consuming Intents

(Reason: no dialog payload exists to preserve; idle messages route per bot-free-text-routing.)
(Migration: none.)

### Requirement: Restart and Corrupt-Payload Recovery

(Reason: `awaiting_registration` is removed from the state machine; corrupt-payload recovery for its old persisted payloads falls to the generic recover-to-`idle` discipline.)
(Migration: telegram-bot Per-Owner State Machine delta.)

### Requirement: Deterministic-Only Mode

(Reason: collection fired only on brain envelopes or the removed prefixes; both are gone.)
(Migration: none — idle routing is deterministic-only by default (see bot-free-text-routing).)

### Requirement: asked_registration Reply Action

(Reason: the `asked_registration` reply action and its templates are removed with the dialog.)
(Migration: the fixed capture re-prompt template lives in quick-capture.)