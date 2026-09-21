import { describe, expect, it } from 'vitest'
import {
  createEmptyVisibleWildPokemonState,
  isVisibleWildPokemonStateV1,
  parseVisibleWildPokemonStateV1,
  visibleWildPokemonStateFormat,
  visibleWildPokemonStateVersion,
} from './visibleWildPokemonState'

const actor = Object.freeze({
  id: 'ngp-visible-wild:7:aabbccdd00112233',
  mapId: 7,
  tileX: 4,
  tileZ: 9,
  direction: 'south' as const,
  speciesId: 16,
  form: 0,
  level: 5,
  encounterKey: 'map-7:land:0',
  encounterMethod: 'land' as const,
  movementStep: 3,
})

function state() {
  return {
    format: visibleWildPokemonStateFormat,
    version: visibleWildPokemonStateVersion,
    actors: [actor],
    retiredEncounters: [{ mapId: 8, encounterKey: 'map-8:safari:1' }],
    populationCycles: [{ mapId: 8, generation: 4, repopulationPending: true }],
  }
}

describe('état sauvegardé des Pokémon visibles', () => {
  it('effectue un roundtrip JSON canonique et gelé', () => {
    const parsed = parseVisibleWildPokemonStateV1(JSON.parse(JSON.stringify(state())))
    expect(parsed).toEqual(state())
    expect(isVisibleWildPokemonStateV1(parsed)).toBe(true)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.actors)).toBe(true)
    expect(Object.isFrozen(parsed.actors[0])).toBe(true)
    expect(createEmptyVisibleWildPokemonState()).toEqual({
      format: visibleWildPokemonStateFormat,
      version: 1,
      actors: [],
      retiredEncounters: [],
      populationCycles: [],
    })
  })

  it('migre un ancien etat v1 sans cycles de peuplement', () => {
    const current = state()
    const legacy = {
      format: current.format,
      version: current.version,
      actors: current.actors,
      retiredEncounters: current.retiredEncounters,
    }
    expect(parseVisibleWildPokemonStateV1(legacy)).toEqual({ ...legacy, populationCycles: [] })
  })

  it('refuse versions, champs, bornes, doublons et état actif/retiré incohérent', () => {
    for (const invalid of [
      { ...state(), version: 2 },
      { ...state(), privateToken: 'secret' },
      { ...state(), actors: [{ ...actor, speciesId: 494 }] },
      { ...state(), actors: [{ ...actor, id: 'remote:7:aabb' }] },
      { ...state(), actors: [{ ...actor, direction: 'up' }] },
      { ...state(), actors: [{ ...actor, encounterMethod: 'fishing' }] },
      { ...state(), actors: [actor, actor] },
      { ...state(), populationCycles: [
        { mapId: 8, generation: 1, repopulationPending: false },
        { mapId: 8, generation: 2, repopulationPending: false },
      ] },
      { ...state(), populationCycles: [
        { mapId: actor.mapId, generation: 1, repopulationPending: true },
      ] },
      { ...state(), retiredEncounters: [
        { mapId: actor.mapId, encounterKey: actor.encounterKey },
      ] },
    ]) {
      expect(() => parseVisibleWildPokemonStateV1(invalid)).toThrow()
      expect(isVisibleWildPokemonStateV1(invalid)).toBe(false)
    }
  })

  it('refuse les objets non JSON et les tableaux troués sans invoquer un accesseur hostile', () => {
    let invoked = false
    const hostile = Object.defineProperty({}, 'format', {
      enumerable: true,
      get: () => {
        invoked = true
        throw new Error('hostile')
      },
    })
    const sparse = state()
    sparse.actors.length = 2

    expect(() => parseVisibleWildPokemonStateV1(hostile)).toThrow()
    expect(invoked).toBe(false)
    expect(() => parseVisibleWildPokemonStateV1(sparse)).toThrow()
  })
})
