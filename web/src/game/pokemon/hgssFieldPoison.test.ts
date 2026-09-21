import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from './canonicalPokemon'
import { surviveHgssFieldPoisoning } from './hgssFieldPoison'
import { createHgssLcrng } from './hgssPokemonRng'
import { createPokemonTestCatalog } from './pokemonTestCatalog'

function pokemon(currentHp: number, status: number) {
  const result = createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId: 155,
    level: 20,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 1 },
    individualValues: { kind: 'fixed', value: 10 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 42, metLevel: 20, metTerrain: 0 },
    ballId: 4,
  })
  result.currentHp = currentHp
  result.status = status
  return result
}

describe('HGSS field poison survival', () => {
  it.each([0x08, 0x80 | 0x500])('clears poison %#x from a survivor at one HP', (status) => {
    const survivor = pokemon(1, status)
    expect(surviveHgssFieldPoisoning(survivor)).toBe(true)
    expect(survivor.status).toBe(0)
  })

  it('leaves poison and other statuses unchanged outside the native survival condition', () => {
    const healthyHp = pokemon(2, 0x08)
    const burned = pokemon(1, 0x10)
    expect(surviveHgssFieldPoisoning(healthyHp)).toBe(false)
    expect(surviveHgssFieldPoisoning(burned)).toBe(false)
    expect(healthyHp.status).toBe(0x08)
    expect(burned.status).toBe(0x10)
  })
})
