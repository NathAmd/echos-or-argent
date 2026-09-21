import { describe, expect, it } from 'vitest'
import { deriveLegacyPokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import {
  createEmptyNuzlockeState,
  isNuzlockeStateV1,
  nuzlockeStateFormat,
  parseNuzlockeStateV1,
} from './nuzlockeState'

const firstId = deriveLegacyPokemonInstanceId('nuzlocke-state', 'encounter/first')
const secondId = deriveLegacyPokemonInstanceId('nuzlocke-state', 'encounter/second')

function section(mapSectionId: number, instanceId = firstId) {
  return {
    mapSectionId,
    instanceId,
    method: 'land' as const,
    speciesId: 16,
    level: 3,
    outcome: 'started' as const,
  }
}

describe('état Nuzlocke versionné', () => {
  it('crée un état vide immuable et strictement sérialisable', () => {
    const state = createEmptyNuzlockeState()

    expect(state).toEqual({
      format: nuzlockeStateFormat,
      version: 1,
      sections: [],
    })
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.sections)).toBe(true)
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('valide, trie et fige chaque première rencontre de façon déterministe', () => {
    const state = parseNuzlockeStateV1({
      format: nuzlockeStateFormat,
      version: 1,
      sections: [
        { ...section(42, secondId), method: 'safari', speciesId: 113, level: 17, outcome: 'caught' },
        { ...section(7), method: 'scripted', outcome: 'missed' },
      ],
    })

    expect(state.sections.map(({ mapSectionId }) => mapSectionId)).toEqual([7, 42])
    expect(state.sections[0]).toEqual({ ...section(7), method: 'scripted', outcome: 'missed' })
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.sections)).toBe(true)
    expect(state.sections.every(Object.isFrozen)).toBe(true)
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
    expect(isNuzlockeStateV1(state)).toBe(true)
  })

  it('accepte toutes les méthodes et issues prévues par le contrat', () => {
    const methods = ['land', 'surfing', 'fishing', 'roamer', 'safari', 'scripted'] as const
    const outcomes = ['started', 'caught', 'missed'] as const
    const sections = methods.map((method, index) => ({
      ...section(index, deriveLegacyPokemonInstanceId('nuzlocke-state', `method/${method}`)),
      method,
      outcome: outcomes[index % outcomes.length]!,
    }))

    expect(parseNuzlockeStateV1({
      format: nuzlockeStateFormat,
      version: 1,
      sections,
    }).sections).toHaveLength(methods.length)
  })

  it('refuse format, version, clés, doublons et valeurs de domaine invalides', () => {
    const valid = {
      format: nuzlockeStateFormat,
      version: 1,
      sections: [section(12)],
    }
    const invalidValues: unknown[] = [
      null,
      [],
      { ...valid, format: 'autre-format' },
      { ...valid, version: 2 },
      { ...valid, extra: true },
      { ...valid, sections: 'douze' },
      { ...valid, sections: [section(12), section(12, secondId)] },
      { ...valid, sections: [{ ...section(12), extra: true }] },
      { ...valid, sections: [{ ...section(-1) }] },
      { ...valid, sections: [{ ...section(12), instanceId: 'pokemon-invalide' }] },
      { ...valid, sections: [{ ...section(12), method: 'gift' }] },
      { ...valid, sections: [{ ...section(12), speciesId: 0 }] },
      { ...valid, sections: [{ ...section(12), level: 101 }] },
      { ...valid, sections: [{ ...section(12), outcome: 'escaped' }] },
      { ...valid, sections: [new (class Encounter { mapSectionId = 12 })()] },
      { ...valid, sections: [{ ...section(12), level: Number.NaN }] },
    ]

    for (const value of invalidValues) {
      expect(isNuzlockeStateV1(value)).toBe(false)
      expect(() => parseNuzlockeStateV1(value)).toThrow()
    }
  })

  it('refuse les graphes non JSON avant toute restauration', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => parseNuzlockeStateV1(cyclic)).toThrow(/JSON stricte/)
    expect(() => parseNuzlockeStateV1({
      format: nuzlockeStateFormat,
      version: 1,
      sections: [{ ...section(12), speciesId: Number.POSITIVE_INFINITY }],
    })).toThrow(/JSON stricte/)
  })
})
