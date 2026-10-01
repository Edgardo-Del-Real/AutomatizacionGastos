# Delta for Bot Main Menu

## MODIFIED Requirements

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