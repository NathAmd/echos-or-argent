import { describe, expect, it } from 'vitest'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { parseHgssDataOnlyExtensions } from './hgssDataOnlyExtensions'

const unsafeInstanceId = (index: number) => deriveLegacyPokemonInstanceId(
  `rom-presentation-${index}`,
  `party/${index}`,
)
const portableInstanceId = deriveLegacyPokemonInstanceId('hgss-7-00000007', 'party/0')

describe('extensions HGSS data-only', () => {
  it.each([
    ['new-game-plus.all-pokemon-accessible', {
      format: 'pokemaster-hgss-all-pokemon-accessible-state', version: 1,
      quests: [{ speciesId: 144, status: 'available', encounterInstanceId: unsafeInstanceId(0) }],
    }],
    ['new-game-plus.nuzlocke', {
      format: 'pokemaster-hgss-nuzlocke-state', version: 1,
      sections: [{ mapSectionId: 1, instanceId: unsafeInstanceId(1), method: 'land', speciesId: 16, level: 5, outcome: 'caught' }],
    }],
    ['new-game-plus.permanent-death', {
      format: 'pokemaster-hgss-permanent-death-state', version: 1,
      deadPokemonInstanceIds: [unsafeInstanceId(2)],
    }],
    ['new-game-plus.solo-run', { version: 1, instanceId: unsafeInstanceId(3) }],
    ['new-game-plus.eevee-team', {
      version: 1,
      members: [
        [134, 11], [135, 13], [136, 10], [196, 14], [197, 17], [470, 12],
      ].map(([targetSpeciesId, typeId], index) => ({ instanceId: unsafeInstanceId(index + 4), targetSpeciesId, typeId })),
    }],
  ])('refuse un instanceId legacy porteur de texte dans %s', (key, value) => {
    expect(() => parseHgssDataOnlyExtensions({ [key]: { version: 1, value } })).toThrow('data-only')
  })

  it('accepte une référence Pokémon legacy limitée au chemin machine HGSS', () => {
    expect(parseHgssDataOnlyExtensions({
      'new-game-plus.nuzlocke': { version: 1, value: {
        format: 'pokemaster-hgss-nuzlocke-state', version: 1,
        sections: [{ mapSectionId: 1, instanceId: portableInstanceId, method: 'land', speciesId: 16, level: 5, outcome: 'caught' }],
      } },
    })).toMatchObject({
      'new-game-plus.nuzlocke': { value: { sections: [{ instanceId: portableInstanceId }] } },
    })
  })

  it('n’atteste que les clés et identités machine produites par le runtime Pokémon visible', () => {
    const actor = {
      id: 'ngp-visible-wild:7:aabbccdd00112233', mapId: 7, tileX: 4, tileZ: 9,
      direction: 'south', speciesId: 16, form: 0, level: 5,
      encounterKey: 'hgss-vw2:deadbeef:7:12:l:d:n:n:0', encounterMethod: 'land', movementStep: 3,
    }
    const extension = (overrides: Record<string, unknown> = {}) => ({
      'new-game-plus.visible-wild-pokemon': { version: 1, value: {
        format: 'pokemaster-hgss-visible-wild-state', version: 1,
        actors: [{ ...actor, ...overrides }], retiredEncounters: [], populationCycles: [],
      } },
    })
    expect(() => parseHgssDataOnlyExtensions(extension())).not.toThrow()
    expect(() => parseHgssDataOnlyExtensions(extension({ encounterKey: 'ROM_PRESENTATION_CANARY' }))).toThrow('machine')
    expect(() => parseHgssDataOnlyExtensions(extension({ id: 'ngp-visible-wild:7:ROM_CANARY' }))).toThrow('machine')
    expect(() => parseHgssDataOnlyExtensions(extension({ mapId: 8 }))).toThrow('incohérent')
  })
})
