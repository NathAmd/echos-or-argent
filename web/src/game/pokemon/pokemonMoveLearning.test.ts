import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from './canonicalPokemon'
import { createHgssLcrng } from './hgssPokemonRng'
import { replacePokemonMoveAfterChoice } from './pokemonMoveLearning'
import { createPokemonTestCatalog } from './pokemonTestCatalog'

function pokemon() {
  const catalog = createPokemonTestCatalog()
  const value = createCanonicalPokemon(catalog, {
    speciesId: 152,
    level: 5,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 1 },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    ballId: 4,
  })
  value.moves = [10, 33, 43, 44].map((moveId) => ({ moveId, pp: catalog.moves[moveId]!.pp, maxPp: catalog.moves[moveId]!.pp, ppUps: 0, data: catalog.moves[moveId]! }))
  return { catalog, value }
}

describe('choix de capacité à oublier', () => {
  it("ne modifie rien lorsqu'aucun emplacement n'est confirmé", () => {
    const { catalog, value } = pokemon()
    const before = value.moves.map(({ moveId }) => moveId)
    expect(replacePokemonMoveAfterChoice(value, 45, -1, catalog)).toEqual({ kind: 'cancelled' })
    expect(value.moves.map(({ moveId }) => moveId)).toEqual(before)
  })

  it('remplace uniquement la capacité explicitement choisie', () => {
    const { catalog, value } = pokemon()
    const result = replacePokemonMoveAfterChoice(value, 45, 2, catalog)
    expect(result.kind).toBe('replaced')
    expect(value.moves.map(({ moveId }) => moveId)).toEqual([10, 33, 45, 44])
  })

  it('ignore une commande répétée qui tenterait de dupliquer la capacité apprise', () => {
    const { catalog, value } = pokemon()
    replacePokemonMoveAfterChoice(value, 45, 2, catalog)
    expect(replacePokemonMoveAfterChoice(value, 45, 1, catalog)).toEqual({ kind: 'cancelled' })
    expect(value.moves.map(({ moveId }) => moveId)).toEqual([10, 33, 45, 44])
  })
})
