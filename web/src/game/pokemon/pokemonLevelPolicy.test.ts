import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from './canonicalPokemon'
import { createHgssLcrng } from './hgssPokemonRng'
import { createPokemonTestCatalog } from './pokemonTestCatalog'
import {
  basePokemonLevelPolicy,
  composePokemonLevelPolicies,
  pokemonLevelPolicySources,
  resolvePokemonLevelCap,
  type PokemonLevelPolicy,
} from './pokemonLevelPolicy'

function createPokemon() {
  return createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId: 152,
    level: 5,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 1 },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 1 },
    ballId: 4,
  })
}

describe('pokemon level policy', () => {
  it('conserve le plafond natif 100 pour chaque source avec un contexte fige', () => {
    const pokemon = createPokemon()
    const contexts: unknown[] = []
    const policy: PokemonLevelPolicy = {
      resolveLevelCap(context) {
        contexts.push(context)
        return basePokemonLevelPolicy.resolveLevelCap(context)
      },
    }

    expect(pokemonLevelPolicySources.map((source) => resolvePokemonLevelCap(pokemon, source, policy)))
      .toEqual([100, 100, 100])
    expect(contexts.every((context) => Object.isFrozen(context))).toBe(true)
    expect(contexts.every((context) => Object.isFrozen((context as { pokemon: object }).pokemon))).toBe(true)
  })

  it('compose les politiques par minimum et capture leur ordre', () => {
    const calls: string[] = []
    const policies: PokemonLevelPolicy[] = [
      { resolveLevelCap: () => { calls.push('first'); return 42 } },
      { resolveLevelCap: () => { calls.push('second'); return 30 } },
      { resolveLevelCap: () => { calls.push('third'); return 35 } },
    ]
    const composite = composePokemonLevelPolicies(policies)
    policies.reverse()

    expect(resolvePokemonLevelCap(createPokemon(), 'battle', composite)).toBe(30)
    expect(calls).toEqual(['first', 'second', 'third'])
  })

  it.each([0, 101, 1.5, Number.NaN])('refuse le plafond invalide %s', (levelCap) => {
    expect(() => resolvePokemonLevelCap(createPokemon(), 'daycare', {
      resolveLevelCap: () => levelCap,
    })).toThrow(/entier compris entre 1 et 100/)
  })
})
