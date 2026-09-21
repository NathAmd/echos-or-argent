import type { HgssItemPocket } from '../../rom/items/itemData'
import type { MainMenuCommand } from './mainMenuController'

type StaticMainMenuCommand =
  | 'save'
  | 'retire'
  | 'multiplayer'
  | 'new-game'
  | 'cycle-text-speed'
  | 'toggle-battle-animations'
  | 'toggle-local-weather'
  | 'toggle-fullscreen'
  | 'report-bug'
  | 'emergency-unstick'
type ParsedCommand<
  Kind extends string,
  Raw extends MainMenuCommand,
  Fields extends object = object,
> = Readonly<{ kind: Kind, raw: Raw } & Fields>

type ParsedStaticMainMenuCommand = {
  [Command in StaticMainMenuCommand]: ParsedCommand<Command, Command>
}[StaticMainMenuCommand]

export type ParsedKnownMainMenuCommand =
  | ParsedStaticMainMenuCommand
  | ParsedCommand<'pokedex-species', `pokedex-species:${number}`, { speciesId: number }>
  | ParsedCommand<'team-member', `team-member:${number}`, { partySlot: number }>
  | ParsedCommand<'team-summary', `team-summary:${number}`, { partySlot: number }>
  | ParsedCommand<'team-move-up', `team-move-up:${number}`, { sourceSlot: number }>
  | ParsedCommand<'team-move-down', `team-move-down:${number}`, { sourceSlot: number }>
  | ParsedCommand<'team-take-item', `team-take-item:${number}`, { partySlot: number }>
  | ParsedCommand<'team-rename', `team-rename:${number}`, { partySlot: number }>
  | ParsedCommand<'team-field-move', `team-field-move:${number}:${number}`, { partySlot: number, moveId: number }>
  | ParsedCommand<'bag-pocket', `bag-pocket:${number}`, { pocket: HgssItemPocket }>
  | ParsedCommand<'bag-item', `bag-item:${number}`, { itemId: number }>
  | ParsedCommand<'bag-action-use', `bag-action-use:${number}`, { itemId: number }>
  | ParsedCommand<'bag-action-give', `bag-action-give:${number}`, { itemId: number }>
  | ParsedCommand<'bag-action-cancel', `bag-action-cancel:${number}`, { itemId: number }>
  | ParsedCommand<'bag-machine-target', `bag-machine-target:${number}:${number}`, { itemId: number, partySlot: number }>
  | ParsedCommand<'bag-machine-replace', `bag-machine-replace:${number}:${number}:${number}`, { itemId: number, partySlot: number, moveIndex: number }>
  | ParsedCommand<'bag-machine-cancel', `bag-machine-cancel:${number}:${number}`, { itemId: number, partySlot: number }>
  | ParsedCommand<'bag-give', `bag-give:${number}:${number}`, { itemId: number, partySlot: number }>
  | ParsedCommand<'bag-bike', `bag-bike:${number}`, { itemId: number }>
  | ParsedCommand<'bag-repel', `bag-repel:${number}`, { itemId: number }>
  | ParsedCommand<'bag-fish', `bag-fish:${number}`, { itemId: number }>
  | ParsedCommand<'bag-sweet-scent', `bag-sweet-scent:${number}`, { itemId: number }>
  | ParsedCommand<'bag-use', `bag-use:${number}:${number}`, { itemId: number, partySlot: number }>
  | ParsedCommand<'bag-use-move', `bag-use-move:${number}:${number}:${number}`, { itemId: number, partySlot: number, moveIndex: number }>
  | ParsedCommand<'bag-use-party', `bag-use-party:${number}`, { itemId: number }>
  | ParsedCommand<'pokegear-contact', `pokegear-contact:${number}`, { contactId: number }>
  | ParsedCommand<'pokegear-radio', `pokegear-radio:${number}`, { slot: number }>
  | ParsedCommand<'pokegear-skin', `pokegear-skin:${number}`, { skin: number }>

export type UnknownMainMenuCommand = Readonly<{
  kind: 'unknown'
  raw: string
}>

export type ParsedMainMenuCommand = ParsedKnownMainMenuCommand | UnknownMainMenuCommand

type CoveredMainMenuCommand = ParsedKnownMainMenuCommand['raw']
const parserCoversMainMenuCommandType: Exclude<MainMenuCommand, CoveredMainMenuCommand> extends never
  ? Exclude<CoveredMainMenuCommand, MainMenuCommand> extends never
    ? true
    : never
  : never = true
void parserCoversMainMenuCommandType

type NumericPartParser = (raw: string) => number | undefined
type ParsedNumericArguments<Parsers extends readonly NumericPartParser[]> = {
  readonly [Index in keyof Parsers]: number
}

function parseBoundedInteger(raw: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined
}

const parsePositiveId: NumericPartParser = (raw) => parseBoundedInteger(raw, 1)
const parseUnsignedId: NumericPartParser = (raw) => parseBoundedInteger(raw, 0)
const parsePartySlot: NumericPartParser = (raw) => parseBoundedInteger(raw, 0, 5)
const parseMoveUpSourceSlot: NumericPartParser = (raw) => parseBoundedInteger(raw, 1, 5)
const parseMoveDownSourceSlot: NumericPartParser = (raw) => parseBoundedInteger(raw, 0, 4)
const parseMoveIndex: NumericPartParser = (raw) => parseBoundedInteger(raw, 0, 3)
const parsePocket: NumericPartParser = (raw) => parseBoundedInteger(raw, 0, 7)
const parseRadioSlot: NumericPartParser = (raw) => parseBoundedInteger(raw, 0, 7)
const parseSkin: NumericPartParser = (raw) => parseBoundedInteger(raw, 0, 7)

function parseNumericArguments<const Parsers extends readonly NumericPartParser[]>(
  parts: readonly string[],
  parsers: Parsers,
): ParsedNumericArguments<Parsers> | undefined {
  if (parts.length !== parsers.length + 1) return undefined
  const values: number[] = []
  for (let index = 0; index < parsers.length; index += 1) {
    const value = parsers[index]!(parts[index + 1]!)
    if (value === undefined) return undefined
    values.push(value)
  }
  return values as ParsedNumericArguments<Parsers>
}

function unknownCommand(raw: string): UnknownMainMenuCommand {
  return { kind: 'unknown', raw }
}

/** Parse une commande sans consulter le menu, la ROM ou l'état de partie. */
export function parseMainMenuCommand(command: string): ParsedMainMenuCommand {
  switch (command) {
    case 'save': return { kind: 'save', raw: command }
    case 'retire': return { kind: 'retire', raw: command }
    case 'multiplayer': return { kind: 'multiplayer', raw: command }
    case 'new-game': return { kind: 'new-game', raw: command }
    case 'cycle-text-speed': return { kind: 'cycle-text-speed', raw: command }
    case 'toggle-battle-animations': return { kind: 'toggle-battle-animations', raw: command }
    case 'toggle-local-weather': return { kind: 'toggle-local-weather', raw: command }
    case 'toggle-fullscreen': return { kind: 'toggle-fullscreen', raw: command }
    case 'report-bug': return { kind: 'report-bug', raw: command }
    case 'emergency-unstick': return { kind: 'emergency-unstick', raw: command }
  }

  const parts = command.split(':')
  switch (parts[0]) {
    case 'pokedex-species': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'pokedex-species', raw: command as `pokedex-species:${number}`, speciesId: values[0] } : unknownCommand(command)
    }
    case 'team-member': {
      const values = parseNumericArguments(parts, [parsePartySlot])
      return values ? { kind: 'team-member', raw: command as `team-member:${number}`, partySlot: values[0] } : unknownCommand(command)
    }
    case 'team-summary': {
      const values = parseNumericArguments(parts, [parsePartySlot])
      return values ? { kind: 'team-summary', raw: command as `team-summary:${number}`, partySlot: values[0] } : unknownCommand(command)
    }
    case 'team-move-up': {
      const values = parseNumericArguments(parts, [parseMoveUpSourceSlot])
      return values ? { kind: 'team-move-up', raw: command as `team-move-up:${number}`, sourceSlot: values[0] } : unknownCommand(command)
    }
    case 'team-move-down': {
      const values = parseNumericArguments(parts, [parseMoveDownSourceSlot])
      return values ? { kind: 'team-move-down', raw: command as `team-move-down:${number}`, sourceSlot: values[0] } : unknownCommand(command)
    }
    case 'team-take-item': {
      const values = parseNumericArguments(parts, [parsePartySlot])
      return values ? { kind: 'team-take-item', raw: command as `team-take-item:${number}`, partySlot: values[0] } : unknownCommand(command)
    }
    case 'team-rename': {
      const values = parseNumericArguments(parts, [parsePartySlot])
      return values ? { kind: 'team-rename', raw: command as `team-rename:${number}`, partySlot: values[0] } : unknownCommand(command)
    }
    case 'team-field-move': {
      const values = parseNumericArguments(parts, [parsePartySlot, parsePositiveId])
      return values ? { kind: 'team-field-move', raw: command as `team-field-move:${number}:${number}`, partySlot: values[0], moveId: values[1] } : unknownCommand(command)
    }
    case 'bag-pocket': {
      const values = parseNumericArguments(parts, [parsePocket])
      return values ? { kind: 'bag-pocket', raw: command as `bag-pocket:${number}`, pocket: values[0] as HgssItemPocket } : unknownCommand(command)
    }
    case 'bag-item': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-item', raw: command as `bag-item:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-action-use': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-action-use', raw: command as `bag-action-use:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-action-give': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-action-give', raw: command as `bag-action-give:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-action-cancel': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-action-cancel', raw: command as `bag-action-cancel:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-machine-target': {
      const values = parseNumericArguments(parts, [parsePositiveId, parsePartySlot])
      return values ? { kind: 'bag-machine-target', raw: command as `bag-machine-target:${number}:${number}`, itemId: values[0], partySlot: values[1] } : unknownCommand(command)
    }
    case 'bag-machine-replace': {
      const values = parseNumericArguments(parts, [parsePositiveId, parsePartySlot, parseMoveIndex])
      return values ? { kind: 'bag-machine-replace', raw: command as `bag-machine-replace:${number}:${number}:${number}`, itemId: values[0], partySlot: values[1], moveIndex: values[2] } : unknownCommand(command)
    }
    case 'bag-machine-cancel': {
      const values = parseNumericArguments(parts, [parsePositiveId, parsePartySlot])
      return values ? { kind: 'bag-machine-cancel', raw: command as `bag-machine-cancel:${number}:${number}`, itemId: values[0], partySlot: values[1] } : unknownCommand(command)
    }
    case 'bag-give': {
      const values = parseNumericArguments(parts, [parsePositiveId, parsePartySlot])
      return values ? { kind: 'bag-give', raw: command as `bag-give:${number}:${number}`, itemId: values[0], partySlot: values[1] } : unknownCommand(command)
    }
    case 'bag-bike': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-bike', raw: command as `bag-bike:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-repel': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-repel', raw: command as `bag-repel:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-fish': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-fish', raw: command as `bag-fish:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-sweet-scent': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-sweet-scent', raw: command as `bag-sweet-scent:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'bag-use': {
      const values = parseNumericArguments(parts, [parsePositiveId, parsePartySlot])
      return values ? { kind: 'bag-use', raw: command as `bag-use:${number}:${number}`, itemId: values[0], partySlot: values[1] } : unknownCommand(command)
    }
    case 'bag-use-move': {
      const values = parseNumericArguments(parts, [parsePositiveId, parsePartySlot, parseMoveIndex])
      return values ? { kind: 'bag-use-move', raw: command as `bag-use-move:${number}:${number}:${number}`, itemId: values[0], partySlot: values[1], moveIndex: values[2] } : unknownCommand(command)
    }
    case 'bag-use-party': {
      const values = parseNumericArguments(parts, [parsePositiveId])
      return values ? { kind: 'bag-use-party', raw: command as `bag-use-party:${number}`, itemId: values[0] } : unknownCommand(command)
    }
    case 'pokegear-contact': {
      const values = parseNumericArguments(parts, [parseUnsignedId])
      return values ? { kind: 'pokegear-contact', raw: command as `pokegear-contact:${number}`, contactId: values[0] } : unknownCommand(command)
    }
    case 'pokegear-radio': {
      const values = parseNumericArguments(parts, [parseRadioSlot])
      return values ? { kind: 'pokegear-radio', raw: command as `pokegear-radio:${number}`, slot: values[0] } : unknownCommand(command)
    }
    case 'pokegear-skin': {
      const values = parseNumericArguments(parts, [parseSkin])
      return values ? { kind: 'pokegear-skin', raw: command as `pokegear-skin:${number}`, skin: values[0] } : unknownCommand(command)
    }
    default: return unknownCommand(command)
  }
}
