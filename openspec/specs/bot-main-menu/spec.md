# Bot Main Menu Specification

## Purpose

The owner-facing main menu: five inline actions (Nuevo gasto, Gasto previsto, Borrar, Reporte, Ayuda), Telegram `setMyCommands` registration, and a static help text with capture examples that works without the LLM.

## Requirements

### Requirement: Main Menu Actions

The system MUST expose a main menu with exactly five buttons — `Nuevo gasto`, `Gasto previsto`, `Borrar`, `Reporte`, `Ayuda`. `Nuevo gasto` MUST start text capture (`idle`); `Gasto previsto` MUST start capture with a PENDING intent (the type is still confirmed by button); `Borrar` MUST start the delete flow (target selection + confirmation gate); `Reporte` MUST run the recent-movements query; `Ayuda` MUST send the static help. The menu MUST be reachable from the `menu` command and MUST be idempotent (reopening it never changes state).

#### Scenario: Menu shows five actions

- GIVEN an owner sends the `menu` command
- WHEN the menu is rendered
- THEN exactly five buttons appear: Nuevo gasto, Gasto previsto, Borrar, Reporte, Ayuda

#### Scenario: Borrar starts the delete flow

- GIVEN an owner taps `Borrar`
- WHEN the callback is processed
- THEN the delete target selection starts and no movement is deleted yet

#### Scenario: Reporte answers from real data

- GIVEN an owner taps `Reporte`
- WHEN the callback is processed
- THEN the recent-query executor answers with the owner's real movements

#### Scenario: Menu reopens without side effects

- GIVEN an owner already in `idle`
- WHEN they tap `menu` again
- THEN the menu re-renders and no state changes

### Requirement: setMyCommands Registration

The system MUST register the owner-visible command list through Telegram `setMyCommands` when the bot starts, covering at least `menu`, `listar categorias`, `configurar categorias`, and `ayuda`. A registration failure MUST be logged and MUST NOT crash the polling loop. Unknown commands MUST still fall through to normal registration parsing.

#### Scenario: Commands registered on start

- GIVEN the API process starts with a valid bot token
- WHEN the bot boots
- THEN `setMyCommands` is called with the command list

#### Scenario: Registration failure tolerated

- GIVEN `setMyCommands` fails
- WHEN the bot boots
- THEN the failure is logged and the polling loop still starts

### Requirement: Static Help

The system MUST provide a static help reply (no LLM) showing capture examples ("30000 gym"), the `previsto:` prefix, the category commands, and the delete flow — including that deletes always confirm before executing. The help MUST be reachable from the `Ayuda` button and the `ayuda` command, and MUST work with `GROQ_API_KEY` unset.

#### Scenario: Ayuda replies offline

- GIVEN `GROQ_API_KEY` is unset and an owner taps `Ayuda`
- WHEN the callback is processed
- THEN the static help with capture examples is sent and no LLM call occurs

#### Scenario: Help explains the delete confirmation

- GIVEN the static help text
- WHEN it is rendered
- THEN it states that deleting always asks for confirmation first