import { describe, expect, it, vi } from 'vitest'
import type { HgssItemPocket } from '../../rom/items/itemData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { createUtilityMenuScreenItemsHost, getUtilityPokegearAppLabels } from './utilityMenuScreenItemsHost'

function pokemon(overrides: Partial<CanonicalPokemon> = {}): CanonicalPokemon {
  return {
    speciesName: 'HÉRICENDRE',
    level: 5,
    nickname: undefined,
    heldItemId: 0,
    isEgg: false,
    moves: [],
    ...overrides,
  } as CanonicalPokemon
}

function createFixture(members: CanonicalPokemon[] = []) {
  let teamSlot = 0
  let pokedexSpeciesId: number | undefined
  let bagSelection: {
    itemId: number | undefined
    pocket: HgssItemPocket | undefined
    action: 'use' | 'give' | undefined
    pendingMachineTeaching: { itemId: number, partySlot: number } | undefined
  } = {
    itemId: undefined as number | undefined,
    pocket: undefined,
    action: undefined,
    pendingMachineTeaching: undefined,
  }
  const fieldState = {
    party: { members },
    inventory: new Map(),
    flags: new Set<number>(),
    pokegearCards: new Set<number>(),
  } as unknown as FieldScriptState
  const selectCard = vi.fn()
  const getMenuItems = vi.fn(() => [{ id: 'root', label: 'Retour', kind: 'screen' }] as const)
  const host = createUtilityMenuScreenItemsHost({
    readContext: () => ({ inventory: undefined, fieldState, mapId: 1 }),
    selection: {
      team: {
        readSlot: () => teamSlot,
        writeSlot: (slot) => { teamSlot = slot },
      },
      pokedex: {
        readSpeciesId: () => pokedexSpeciesId,
        writeSpeciesId: (speciesId) => { pokedexSpeciesId = speciesId },
      },
      bag: {
        read: () => bagSelection,
        write: (selection) => { bagSelection = { ...bagSelection, ...selection } },
      },
    },
    pokegear: { selectCard, getMenuItems },
  })
  return {
    host,
    selectCard,
    getMenuItems,
    readTeamSlot: () => teamSlot,
    setTeamSlot: (slot: number) => { teamSlot = slot },
  }
}

describe('utility menu screen items host', () => {
  it('nomme la carte Pokématos selon son application et non selon l’action Vol', () => {
    const inventory = { uiMessageBanks: { 271: { 0: 'Téléphone' }, 273: { 7: 'Vol' }, 270: { 0: 'Podomètre' } }, radioProgramMessages: { 0: { 0: 'Radio' } } }

    expect(getUtilityPokegearAppLabels(inventory as never)).toEqual(['Téléphone', 'Carte', 'Radio', 'Podomètre'])
  })

  it('normalise la sélection Équipe et expose les actions du Pokémon courant', () => {
    const first = pokemon()
    const second = pokemon({ nickname: 'BRAISE', heldItemId: 17 })
    const fixture = createFixture([first, second])
    fixture.setTeamSlot(9)

    const items = fixture.host.getItems('team') ?? []

    expect(fixture.readTeamSlot()).toBe(1)
    expect(items.map(({ id }) => id)).toEqual([
      'team-member:0',
      'team-member:1',
      'team-summary:1',
      'team-move-up:1',
      'team-take-item:1',
      'team-rename:1',
    ])
    expect(items[1]?.label).toBe('BRAISE · Nv.5')
  })

  it('ne propose pas le renommage d’un Œuf', () => {
    const fixture = createFixture([pokemon({ isEgg: true })])

    expect(fixture.host.getItems('team')?.map(({ id }) => id)).toEqual([
      'team-member:0',
      'team-summary:0',
    ])
  })

  it('retourne des listes vides sans ressources ROM pour le Pokédex et le Sac', () => {
    const fixture = createFixture()

    expect(fixture.host.getItems('pokedex')).toEqual([])
    expect(fixture.host.getItems('bag')).toEqual([])
  })

  it('délègue les applications Pokématos et mémorise leur carte', () => {
    const fixture = createFixture()

    expect(fixture.host.getItems('pokegear-map')).toEqual([
      { id: 'root', label: 'Retour', kind: 'screen' },
    ])
    expect(fixture.selectCard).toHaveBeenCalledWith(1)
    expect(fixture.getMenuItems).toHaveBeenCalledOnce()
  })

  it('laisse le contrôleur fournir les écrans statiques', () => {
    expect(createFixture().host.getItems('options')).toBeUndefined()
  })
})
