# Bot Inline Interactions Specification

## Purpose

Inline keyboard interactions for the Telegram bot: `callback_query` parsing and routing, a keyboard-capable reply port, idempotent callback handling, stale-button revalidation, and Telegram keyboard limits. This capability is the interactive surface behind the quick-capture preview, the delete confirmation gate, the category pickers, and the main menu.

## Requirements

### Requirement: Callback Query Routing

The system MUST process `callback_query` updates: it MUST parse `from.id` (owner resolution, same gate as messages), the source `message.chat`, and `callback_query.data`; it MUST route the callback by a stable action prefix in `data`; it MUST answer every processed callback with `answerCallbackQuery`; and it MUST ignore callbacks from unknown chats. The callback families MUST cover: menu type taps (`m:new`, `m:prev`, `m:inc`, `m:shr` storing the capture type), sub-menu entries (`am:*` expense admin, `ac:*` category admin, `rep:*` reports, `sa:*` savings admin), preview category picks and `➕ Crear categoría` (`cat:<id>`, `pv:catnew`), expense/category pick lists (`mp:<id>` mark-paid, `mc:<id>` correction, `cc:<catId>` reassign, `dk:<id>` delete pick), the delete confirmation gate (`dc:ok`, `dc:no`), the capture preview actions (`pv:save`, `pv:edit`), the INGRESO confirmation savings row (`sv:*` percent/other/off choices), and the savings rule delete gate (`svdel:ok`, `svdel:no`). A callback with an unrecognized action prefix MUST reply honestly ("acción no disponible") and MUST NOT crash or change state.
(Previously: the covered families were menu taps, sub-menu entries, preview picks, pick lists, the delete gate, and the capture preview actions only.)

#### Scenario: Known callback routes

- GIVEN a `callback_query` from a known owner chat with `data` for a known action
- WHEN it is processed
- THEN the action handler runs and the callback is answered

#### Scenario: Menu type tap stores the capture type

- GIVEN a `callback_query` with `data` for `m:prev`
- WHEN it is processed
- THEN capture type PENDING is persisted and the capture prompt replies

#### Scenario: Savings row callback routes

- GIVEN a `callback_query` with `data` for a `sv:*` savings choice
- WHEN it is processed
- THEN the confirmation re-renders with the override persisted and the callback is answered

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

The system MUST respect Telegram keyboard limits: at most 8 rows per inline keyboard and at most 64 bytes per `callback_data`. Callback data MUST encode stable ids or indexes, never category names. The preview keyboard (category row + `➕ Crear categoría` + `[✅ Guardar] [✏️ Corregir]`) MUST fit within the limits; when a category set exceeds the capacity, the system MUST paginate with `cp:` scroll buttons.
(Previously: the limit clause named "otro"/scroll buttons as the pagination mechanism.)

#### Scenario: Paginated categories stay within limits

- GIVEN an owner with more categories than fit in one keyboard
- WHEN a category picker is rendered
- THEN the categories are paginated with `cp:` buttons and every callback_data stays under 64 bytes

#### Scenario: Preview keyboard fits with the create row

- GIVEN an owner with a large category set in `awaiting_preview`
- WHEN the preview keyboard renders
- THEN the category row, ➕ Crear categoría, and Guardar/Corregir fit within 8 rows and 64 bytes per button

#### Scenario: Callback data encodes ids

- GIVEN a category button is rendered
- WHEN its `callback_data` is built
- THEN it encodes the category id, never the raw name

### Requirement: Savings Keyboard Budgets

The INGRESO confirmation keyboard MUST fit the savings row (`[5%] [10%] [Otro] [No apartar]`) together with the category row, `➕ Crear categoría`, and `[✅ Guardar] [✏️ Corregir]` within Telegram's 8-row limit. `sv:*` and `sa:*` callback data MUST encode ids or save-tokens, never rule keywords or percents by name, and MUST stay under 64 bytes.

#### Scenario: Confirmation fits with the savings row

- GIVEN an INGRESO confirmation with categories and the savings row
- WHEN the keyboard renders
- THEN every row fits within 8 rows and every `sv:*` button stays under 64 bytes

#### Scenario: Savings callbacks encode tokens

- GIVEN a savings choice button is rendered
- WHEN its `callback_data` is built
- THEN it encodes the save-token or rule id, never the keyword or percent
