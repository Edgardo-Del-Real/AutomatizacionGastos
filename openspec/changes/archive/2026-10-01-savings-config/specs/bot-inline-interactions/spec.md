# Delta for Bot Inline Interactions

## ADDED Requirements

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

## MODIFIED Requirements

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