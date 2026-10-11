# Delta for Bot Inline Interactions

## MODIFIED Requirements

### Requirement: Callback Query Routing

The system MUST process `callback_query` updates: it MUST parse `from.id` (owner resolution, same gate as messages), the source `message.chat`, and `callback_query.data`; it MUST route the callback by a stable action prefix in `data`; it MUST answer every processed callback with `answerCallbackQuery`; and it MUST ignore callbacks from unknown chats. The callback families MUST cover: menu type taps (`m:new`, `m:prev`, `m:inc`, `m:shr` storing the capture type), sub-menu entries (`am:*` expense admin, `ac:*` category admin, `rep:*` reports, `sa:*` savings admin), preview category picks and `➕ Crear categoría` (`cat:<id>`, `pv:catnew`), expense/category pick lists (`mp:<id>` mark-paid, `mc:<id>` correction, `cc:<catId>` reassign, `dk:<id>` delete pick), the delete confirmation gate (`dc:ok`, `dc:no`), the capture preview actions (`pv:save`, `pv:edit`), the INGRESO confirmation savings row (`sv:*` percent/other/off choices), the COMPARTIDO confirmation shared row (`sp:*` percent/other choices), and the savings rule delete gate (`svdel:ok`, `svdel:no`). A callback with an unrecognized action prefix MUST reply honestly ("acción no disponible") and MUST NOT crash or change state.
(Previously: the COMPARTIDO confirmation had no `sp:*` shared-row family.)

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

#### Scenario: Shared row callback routes

- GIVEN a `callback_query` with `data` for an `sp:*` shared choice
- WHEN it is processed
- THEN the confirmation re-renders with `sharedPercent` persisted and the callback is answered

#### Scenario: Unknown action replied honestly

- GIVEN a `callback_query` whose `data` prefix matches no known action
- WHEN it is processed
- THEN an "acción no disponible" reply is sent and no state changes

#### Scenario: Unknown chat ignored

- GIVEN a `callback_query` whose `from.id` matches no household member
- WHEN it is processed
- THEN nothing executes and no reply is sent

## ADDED Requirements

### Requirement: Shared Confirmation Keyboard Budgets

The partner-present COMPARTIDO confirmation keyboard MUST fit the shared row (`[50%] [25%] [75%] [Otro]`) together with the category row, `➕ Crear categoría`, and `[✅ Guardar] [✏️ Corregir]` within Telegram's 8-row limit. `sp:*` callback data MUST encode the save-token only — never the percent — and MUST stay under 64 bytes.

#### Scenario: Confirmation fits with the shared row

- GIVEN a COMPARTIDO confirmation with categories and the shared row
- WHEN the keyboard renders
- THEN every row fits within 8 rows and every `sp:*` button stays under 64 bytes

#### Scenario: Shared callbacks encode tokens

- GIVEN a shared choice button is rendered
- WHEN its `callback_data` is built
- THEN it encodes the save-token only, never the percent
