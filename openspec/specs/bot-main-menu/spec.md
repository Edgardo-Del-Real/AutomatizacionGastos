# Bot Main Menu Specification

## Purpose

The owner-facing main menu: five inline actions (Nuevo gasto, Gasto previsto, Borrar, Reporte, Ayuda), Telegram `setMyCommands` registration, and a static help text with capture examples that works without the LLM.

## Requirements

### Requirement: Main Menu Actions

The system MUST expose a main menu with exactly eight buttons — `➕ Nuevo gasto`, `📅 Gasto previsto`, `➕ Ingreso`, `👥 Compartido`, `🗂 Administrar categorías`, `🧾 Administrar gastos`, `📊 Reportes`, `❓ Ayuda`. `➕ Nuevo gasto` MUST start REAL capture, `📅 Gasto previsto` MUST start PENDING capture, `➕ Ingreso` MUST start INGRESO capture, and `👥 Compartido` MUST start COMPARTIDO capture — each MUST persist the chosen type so the next `monto+nota` message opens the preview with that type. `🗂 Administrar categorías`, `🧾 Administrar gastos`, and `📊 Reportes` MUST open their sub-menus (see bot-manage-categories, bot-manage-expenses, bot-reports-menu). `❓ Ayuda` MUST send the static help. The menu MUST be reachable from the `menu` command and from `/start`. A menu tap or the `menu` command while any pending flow is open MUST abandon the pending flow and start fresh — the menu supersedes any pending capture or preview.
(Previously: five buttons — Nuevo gasto, Gasto previsto, Borrar, Reporte, Ayuda — that replied with capture prompts and remembered no intent; reopening never changed state.)

#### Scenario: Menu shows eight actions

- GIVEN an owner sends the `menu` command
- WHEN the menu is rendered
- THEN exactly eight buttons appear: ➕ Nuevo gasto, 📅 Gasto previsto, ➕ Ingreso, 👥 Compartido, 🗂 Administrar categorías, 🧾 Administrar gastos, 📊 Reportes, ❓ Ayuda

#### Scenario: Menu tap stores the capture type

- GIVEN an owner taps `➕ Ingreso`
- WHEN the callback is processed
- THEN the system persists capture type INGRESO and prompts for `monto+nota`

#### Scenario: Menu tap supersedes a pending preview

- GIVEN an owner in `awaiting_preview` with an unsaved preview
- WHEN they tap `🧾 Administrar gastos`
- THEN the pending preview abandons and the expense admin sub-menu opens fresh

#### Scenario: Menu reopens without side effects in idle

- GIVEN an owner already in `idle`
- WHEN they tap `menu` again
- THEN the menu re-renders and no state changes

### Requirement: setMyCommands Registration

The system MUST register the owner-visible command list through Telegram `setMyCommands` when the bot starts, covering `menu`, `ayuda`, `configurar categorias`, `listar categorias`, `registrar_ahorro`, `listar_ahorros`, and `borrar_ahorro`. The text category CRUD commands (`registrar categoria:`, `renombrar categoria:`, `asociar palabra:`) MUST NOT be registered — category admin is button-driven. A registration failure MUST be logged and MUST NOT crash the polling loop. Unknown commands MUST still fall through to idle free-text routing (see bot-free-text-routing).
(Previously: the registered list covered only `menu`, `ayuda`, `configurar categorias`, and `listar categorias`.)

#### Scenario: Commands registered on start

- GIVEN the API process starts with a valid bot token
- WHEN the bot boots
- THEN `setMyCommands` is called with the trimmed command list

#### Scenario: Registration failure tolerated

- GIVEN `setMyCommands` fails
- WHEN the bot boots
- THEN the failure is logged and the polling loop still starts

#### Scenario: Savings commands registered

- GIVEN the command list
- WHEN the bot boots
- THEN `registrar_ahorro`, `listar_ahorros`, and `borrar_ahorro` are present

#### Scenario: Text CRUD commands not registered

- GIVEN the command list
- WHEN the bot boots
- THEN `registrar categoria:`, `renombrar categoria:`, and `asociar palabra:` are absent

### Requirement: Static Help

The system MUST provide a static help reply (no LLM) that explains the eight-button menu and gives real examples — "Nuevo gasto: mandá 30000 gym", "Previsto: tocá Gasto previsto" — and states that amounts typed directly in chat are not captured (they redirect to ➕ Nuevo gasto). The help MUST mention the savings rule (`registrar ahorro: <palabra> al <X>%`) and MUST include a 💰 Ahorro keyboard button that opens the savings-rule sub-menu (see bot-manage-savings). The help MUST be reachable from the `❓ Ayuda` button and the `ayuda` command, and MUST work with `GROQ_API_KEY` unset.
(Previously: the help taught capture examples, the `previsto:` prefix, the category commands, and the delete confirmation, and never mentioned savings.)

#### Scenario: Ayuda replies offline

- GIVEN `GROQ_API_KEY` is unset and an owner taps `❓ Ayuda`
- WHEN the callback is processed
- THEN the static help with menu buttons and examples is sent and no LLM call occurs

#### Scenario: Help explains the button flow

- GIVEN the static help text
- WHEN it is rendered
- THEN it explains the eight buttons with real capture examples and never mentions prefixes

#### Scenario: Help mentions savings and opens the sub-menu

- GIVEN the static help text
- WHEN it is rendered
- THEN it mentions `registrar ahorro:` and the 💰 Ahorro button opens the savings-rule sub-menu

### Requirement: Post-Action Menu Return

After every completed action — capture save, delete, correction, mark-paid, category admin, or report — the system MUST return the owner to the main menu with a fresh menu reply. The only flows that do not end in the menu are `awaiting_setup` (setup question) and the capture prompt that follows a type menu tap.

#### Scenario: Save returns to menu

- GIVEN a preview save completes
- WHEN the movement registers
- THEN a confirmation replies followed by the main menu

#### Scenario: Report answer returns to menu

- GIVEN a report query completes
- WHEN the answer is sent
- THEN the main menu follows the answer
