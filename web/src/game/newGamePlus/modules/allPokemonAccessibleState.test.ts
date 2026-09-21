import { describe, expect, it } from 'vitest'
import { deriveLegacyPokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import {
  allPokemonAccessibleStateFormat,
  allPokemonAccessibleStateVersion,
  createInitialAllPokemonAccessibleState,
  isAllPokemonAccessibleStateV1,
  parseAllPokemonAccessibleStateV1,
} from './allPokemonAccessibleState'

const instanceId = deriveLegacyPokemonInstanceId('all-pokemon-state-test', 'active')

describe('état Tous les Pokémon accessibles', () => {
  it('crée un état initial trié et réalise un aller-retour JSON déterministe', () => {
    const initial = createInitialAllPokemonAccessibleState([493, 144, 251])
    expect(initial).toEqual({
      format: allPokemonAccessibleStateFormat,
      version: allPokemonAccessibleStateVersion,
      quests: [
        { speciesId: 144, status: 'locked', encounterInstanceId: null },
        { speciesId: 251, status: 'locked', encounterInstanceId: null },
        { speciesId: 493, status: 'locked', encounterInstanceId: null },
      ],
    })
    const restored = parseAllPokemonAccessibleStateV1(JSON.parse(JSON.stringify(initial)))
    expect(restored).toEqual(initial)
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored.quests)).toBe(true)
    expect(Object.isFrozen(restored.quests[0])).toBe(true)
  })

  it('restaure une association d’instance active et canonicalise l’ordre', () => {
    const restored = parseAllPokemonAccessibleStateV1({
      format: allPokemonAccessibleStateFormat,
      version: 1,
      quests: [
        { speciesId: 493, status: 'captured', encounterInstanceId: null },
        { speciesId: 144, status: 'available', encounterInstanceId: instanceId },
      ],
    })
    expect(restored.quests.map(({ speciesId }) => speciesId)).toEqual([144, 493])
    expect(restored.quests[0]?.encounterInstanceId).toBe(instanceId)
  })

  it('refuse versions, champs, doublons, bornes et associations incohérentes', () => {
    const valid = {
      format: allPokemonAccessibleStateFormat,
      version: 1,
      quests: [{ speciesId: 144, status: 'locked', encounterInstanceId: null }],
    }
    for (const invalid of [
      { ...valid, version: 2 },
      { ...valid, token: 'private' },
      { ...valid, quests: [{ speciesId: 0, status: 'locked', encounterInstanceId: null }] },
      { ...valid, quests: [{ speciesId: 144, status: 'unknown', encounterInstanceId: null }] },
      { ...valid, quests: [{ speciesId: 144, status: 'defeated', encounterInstanceId: instanceId }] },
      { ...valid, quests: [...valid.quests, ...valid.quests] },
    ]) {
      expect(() => parseAllPokemonAccessibleStateV1(invalid)).toThrow()
      expect(isAllPokemonAccessibleStateV1(invalid)).toBe(false)
    }
    expect(() => createInitialAllPokemonAccessibleState([144, 144])).toThrow('doublon')
  })

  it('rejette les prototypes et accesseurs sans les exécuter', () => {
    let reads = 0
    const hostile = Object.defineProperty({}, 'format', {
      enumerable: true,
      get: () => {
        reads += 1
        return allPokemonAccessibleStateFormat
      },
    })
    expect(() => parseAllPokemonAccessibleStateV1(hostile)).toThrow('JSON stricte')
    expect(reads).toBe(0)
    expect(() => parseAllPokemonAccessibleStateV1(new (class SaveState {
      format = allPokemonAccessibleStateFormat
      version = 1
      quests = []
    })())).toThrow()
  })
})
