import { describe, expect, it } from 'vitest'
import { parseMainMenuCommand } from './mainMenuCommand'

const staticCommands = [
  'save',
  'retire',
  'multiplayer',
  'new-game',
  'cycle-text-speed',
  'toggle-battle-animations',
  'toggle-local-weather',
  'toggle-fullscreen',
  'report-bug',
  'emergency-unstick',
] as const

const dynamicCommands = [
  ['pokedex-species:493', { kind: 'pokedex-species', raw: 'pokedex-species:493', speciesId: 493 }],
  ['team-member:0', { kind: 'team-member', raw: 'team-member:0', partySlot: 0 }],
  ['team-summary:1', { kind: 'team-summary', raw: 'team-summary:1', partySlot: 1 }],
  ['team-move-up:2', { kind: 'team-move-up', raw: 'team-move-up:2', sourceSlot: 2 }],
  ['team-move-down:3', { kind: 'team-move-down', raw: 'team-move-down:3', sourceSlot: 3 }],
  ['team-take-item:4', { kind: 'team-take-item', raw: 'team-take-item:4', partySlot: 4 }],
  ['team-rename:5', { kind: 'team-rename', raw: 'team-rename:5', partySlot: 5 }],
  ['team-field-move:5:230', { kind: 'team-field-move', raw: 'team-field-move:5:230', partySlot: 5, moveId: 230 }],
  ['bag-pocket:7', { kind: 'bag-pocket', raw: 'bag-pocket:7', pocket: 7 }],
  ['bag-item:17', { kind: 'bag-item', raw: 'bag-item:17', itemId: 17 }],
  ['bag-action-use:17', { kind: 'bag-action-use', raw: 'bag-action-use:17', itemId: 17 }],
  ['bag-action-give:17', { kind: 'bag-action-give', raw: 'bag-action-give:17', itemId: 17 }],
  ['bag-action-cancel:17', { kind: 'bag-action-cancel', raw: 'bag-action-cancel:17', itemId: 17 }],
  ['bag-machine-target:328:0', { kind: 'bag-machine-target', raw: 'bag-machine-target:328:0', itemId: 328, partySlot: 0 }],
  ['bag-machine-replace:328:1:3', { kind: 'bag-machine-replace', raw: 'bag-machine-replace:328:1:3', itemId: 328, partySlot: 1, moveIndex: 3 }],
  ['bag-machine-cancel:328:1', { kind: 'bag-machine-cancel', raw: 'bag-machine-cancel:328:1', itemId: 328, partySlot: 1 }],
  ['bag-give:17:2', { kind: 'bag-give', raw: 'bag-give:17:2', itemId: 17, partySlot: 2 }],
  ['bag-bike:450', { kind: 'bag-bike', raw: 'bag-bike:450', itemId: 450 }],
  ['bag-repel:79', { kind: 'bag-repel', raw: 'bag-repel:79', itemId: 79 }],
  ['bag-fish:445', { kind: 'bag-fish', raw: 'bag-fish:445', itemId: 445 }],
  ['bag-sweet-scent:94', { kind: 'bag-sweet-scent', raw: 'bag-sweet-scent:94', itemId: 94 }],
  ['bag-use:17:3', { kind: 'bag-use', raw: 'bag-use:17:3', itemId: 17, partySlot: 3 }],
  ['bag-use-move:38:4:2', { kind: 'bag-use-move', raw: 'bag-use-move:38:4:2', itemId: 38, partySlot: 4, moveIndex: 2 }],
  ['bag-use-party:221', { kind: 'bag-use-party', raw: 'bag-use-party:221', itemId: 221 }],
  ['pokegear-contact:0', { kind: 'pokegear-contact', raw: 'pokegear-contact:0', contactId: 0 }],
  ['pokegear-radio:3', { kind: 'pokegear-radio', raw: 'pokegear-radio:3', slot: 3 }],
  ['pokegear-skin:7', { kind: 'pokegear-skin', raw: 'pokegear-skin:7', skin: 7 }],
] as const

describe('parseur des commandes du menu principal', () => {
  it('reconnaît toutes les commandes statiques traitées par le runtime', () => {
    for (const command of staticCommands) {
      expect(parseMainMenuCommand(command)).toEqual({ kind: command, raw: command })
    }
  })

  it.each(dynamicCommands)('parse %s et nomme ses arguments', (command, expected) => {
    expect(parseMainMenuCommand(command)).toEqual(expected)
  })

  it('accepte les bornes numériques valides', () => {
    expect(parseMainMenuCommand('bag-use-move:9007199254740991:5:3')).toEqual({
      kind: 'bag-use-move',
      raw: 'bag-use-move:9007199254740991:5:3',
      itemId: Number.MAX_SAFE_INTEGER,
      partySlot: 5,
      moveIndex: 3,
    })
    expect(parseMainMenuCommand('pokegear-contact:0')).toMatchObject({ kind: 'pokegear-contact', contactId: 0 })
  })

  it.each([
    'pokedex-species:0',
    'pokedex-species:-1',
    'pokedex-species:1.5',
    'pokedex-species:1e2',
    'pokedex-species:01',
    'pokedex-species:9007199254740992',
    'team-member:6',
    'team-move-up:0',
    'team-move-down:5',
    'team-field-move:0:0',
    'bag-pocket:8',
    'bag-item:0',
    'bag-machine-replace:328:0:4',
    'bag-use:17',
    'bag-use:17:0:1',
    'bag-use:17:not-a-slot',
    'pokegear-radio:8',
    'pokegear-skin:8',
  ])('conserve la commande numérique invalide %s comme inconnue', (command) => {
    expect(parseMainMenuCommand(command)).toEqual({ kind: 'unknown', raw: command })
  })

  it('préserve les commandes futures et les préfixes non reconnus', () => {
    expect(parseMainMenuCommand('cloud-save:12')).toEqual({ kind: 'unknown', raw: 'cloud-save:12' })
    expect(parseMainMenuCommand('bag-action-run:17')).toEqual({ kind: 'unknown', raw: 'bag-action-run:17' })
    expect(parseMainMenuCommand('')).toEqual({ kind: 'unknown', raw: '' })
  })
})
