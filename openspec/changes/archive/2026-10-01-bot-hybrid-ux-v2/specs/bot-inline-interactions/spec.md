# Delta for Bot Inline Interactions

## MODIFIED Requirements

### Requirement: Callback Query Routing

The system MUST process `callback_query` updates: it MUST parse `from.id` (owner resolution, same gate as messages), the source `message.chat`, and `callback_query.data`; it MUST route the callback by a stable action prefix in `data`; it MUST answer every processed callback with `answerCallbackQuery`; and it MUST ignore callbacks from unknown chats. The callback families MUST cover: menu type taps (`m:new`, `m:prev`, `m:inc`, `m:shr` storing the capture type), sub-menu entries (`am:*` expense admin, `ac:*` category admin, `rep:*` reports), preview category picks and `➕ Crear categoría` (`cat:<id>`, `pv:catnew`), expense/category pick lists (`mp:<id>` mark-paid, `mc:<id>` correction, `cc:<catId>` reassign, `dk:<id>` delete pick), the delete confirmation gate (`dc:ok`, `dc:no`), and the capture preview actions (`pv:save`, `pv:edit`). A callback with an unrecognized action prefix MUST reply honestly ("acción no disponible") and MUST NOT crash or change state.
(Previously: callbacks covered `m:new`/`m:prev` prompts, `pv:save`/`pv:edit`/`pv:typ`, `m:del`, `dk:*`, and `dc:*` only.)

#### Scenario: Known callback routes

- GIVEN a `callback_query` from a known owner chat with `data` for a known action
- WHEN it is processed
- THEN the action handler runs and the callback is answered

#### Scenario: Menu type tap stores the capture type

- GIVEN a `callback_query` with `data` for `m:prev`
- WHEN it is processed
- THEN capture type PENDING is persisted and the capture prompt replies

#### Scenario: Unknown action replied honestly

- GIVEN a `callback_query` whose `data` prefix matches no known action
- WHEN it is processed
- THEN an "acción no disponible" reply is sent and no state changes

#### Scenario: Unknown chat ignored

- GIVEN a `callback_query` whose `from.id` matches no household member
- WHEN it is processed
- THEN nothing executes and no reply is sent

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