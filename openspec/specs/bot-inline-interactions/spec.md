# Bot Inline Interactions Specification

## Purpose

Inline keyboard interactions for the Telegram bot: `callback_query` parsing and routing, a keyboard-capable reply port, idempotent callback handling, stale-button revalidation, and Telegram keyboard limits. This capability is the interactive surface behind the quick-capture preview, the delete confirmation gate, the category pickers, and the main menu.

## Requirements

### Requirement: Callback Query Routing

The system MUST process `callback_query` updates: it MUST parse `from.id` (owner resolution, same gate as messages), the source `message.chat`, and `callback_query.data`; it MUST route the callback by a stable action prefix in `data`; it MUST answer every processed callback with `answerCallbackQuery`; and it MUST ignore callbacks from unknown chats. A callback with an unrecognized action prefix MUST reply honestly ("acción no disponible") and MUST NOT crash or change state.

#### Scenario: Known callback routes

- GIVEN a `callback_query` from a known owner chat with `data` for a known action
- WHEN it is processed
- THEN the action handler runs and the callback is answered

#### Scenario: Unknown action replied honestly

- GIVEN a `callback_query` whose `data` prefix matches no known action
- WHEN it is processed
- THEN an "acción no disponible" reply is sent and no state changes

#### Scenario: Unknown chat ignored

- GIVEN a `callback_query` whose `from.id` matches no household member
- WHEN it is processed
- THEN nothing executes and no reply is sent

### Requirement: Keyboard Reply Port

The system MUST extend the reply port to `(text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>`: text-only calls keep today's behavior; a `keyboard` renders as an inline keyboard on the reply; an `editMessageId` edits the existing message instead of sending a new one. The production wiring MUST use grammy's reply/edit mechanism; the offline harness MUST record the full payload — text, keyboard rows, and edit target — through `recordApiCalls` with zero network calls.

#### Scenario: Reply with keyboard

- GIVEN a reply emitted with a two-button inline keyboard
- WHEN the reply port sends it
- THEN the text and the keyboard are sent to the owner chat

#### Scenario: Edit updates the message

- GIVEN a reply emitted with `editMessageId` set
- WHEN the reply port sends it
- THEN the existing message is edited instead of sending a new one

#### Scenario: Offline keyboard assertion

- GIVEN the offline harness processes an update that replies with a keyboard
- WHEN the reply is recorded
- THEN the recorded payload contains the keyboard rows and no network call occurs

### Requirement: Callback Idempotency

Callback retries MUST NOT double-execute. Every registering or destructive action MUST carry a persisted token in the callback `data` (save-token for preview Guardar, target id for delete); a repeated callback with an already-consumed token MUST reply "ya procesado" and MUST NOT execute again. Text-message dedup via `ProcessedMessage` is unchanged and does not cover callbacks.

#### Scenario: Retried delete confirms once

- GIVEN a `[🗑 Borrar]` callback whose token was already consumed
- WHEN it arrives again
- THEN a "ya procesado" reply is sent and no second delete occurs

#### Scenario: Double tap Guardar registers once

- GIVEN the preview Guardar callback tapped twice
- WHEN both callbacks are processed
- THEN exactly one movement registers and the second tap replies "ya procesado"

### Requirement: Stale Button Revalidation

Before executing, the system MUST revalidate the callback target server-side: a deleted category, a deleted movement, or a closed dialog MUST produce an honest missing/closed reply and MUST NOT execute. When `editMessageText` fails because the original message was deleted, the system MUST fall back to sending a new message with the same content.

#### Scenario: Deleted target replies missing

- GIVEN a callback referencing a movement that no longer exists
- WHEN it is processed
- THEN a clear "no existe" reply is sent and nothing executes

#### Scenario: Edit failure falls back to a new message

- GIVEN an `editMessageText` call fails because the original message is gone
- WHEN the reply port handles it
- THEN a new message with the same text and keyboard is sent instead

### Requirement: Keyboard Size Limits

The system MUST respect Telegram keyboard limits: at most 8 rows per inline keyboard and at most 64 bytes per `callback_data`. Callback data MUST encode stable ids or indexes, never category names; when a category set exceeds the limit, the system MUST paginate with "otro"/scroll buttons.

#### Scenario: Paginated categories stay within limits

- GIVEN an owner with more categories than fit in one keyboard
- WHEN the category picker is rendered
- THEN the categories are paginated and every callback_data stays under 64 bytes

#### Scenario: Callback data encodes ids

- GIVEN a category button is rendered
- WHEN its `callback_data` is built
- THEN it encodes the category id, never the raw name