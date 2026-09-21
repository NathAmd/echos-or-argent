import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonStorage } from '../pokemon/pokemonStorage'
import { attemptFieldWildCapture } from './fieldWildCaptureAttempt'

function pokemon(speciesId: number, seed: number) {
  return createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId,
    level: 10,
    rng: createHgssLcrng(seed),
    personality: { kind: 'fixed', value: seed },
    individualValues: { kind: 'fixed', value: 10 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 },
    ballId: 4,
  })
}

describe('transaction de capture sauvage commune', () => {
  it('capture avec une Master Ball et publie une seule instance dans l’équipe', () => {
    const inventory = new Map([[1, 1]])
    const party = { members: [pokemon(152, 1)] }
    const result = attemptFieldWildCapture({
      item: { itemId: 1, name: 'Master Ball' },
      player: party.members[0]!,
      target: pokemon(155, 2),
      party,
      storage: createPokemonStorage(),
      inventory,
      catalog: createPokemonTestCatalog(),
      rng: createHgssLcrng(3),
      turnCount: 0,
      alreadyCaught: false,
      isNight: false,
      terrain: 'normal',
    })

    expect(result.kind).toBe('caught')
    expect(party.members).toHaveLength(2)
    expect(party.members[1]?.speciesId).toBe(155)
    expect(inventory.has(1)).toBe(false)
  })

  it('ne consomme rien si la politique refuse l’équipe et que le PC est plein', () => {
    const inventory = new Map([[1, 1]])
    const storage = createPokemonStorage()
    for (const box of storage.boxes) for (let slot = 0; slot < box.length; slot += 1) box[slot] = pokemon(158, 10 + slot)
    const party = { members: Array.from({ length: 6 }, (_, index) => pokemon(152, index + 1)) }
    const result = attemptFieldWildCapture({
      item: { itemId: 1, name: 'Master Ball' }, player: party.members[0]!, target: pokemon(155, 90),
      party, storage, inventory, catalog: createPokemonTestCatalog(), rng: createHgssLcrng(3),
      turnCount: 0, alreadyCaught: false, isNight: false, terrain: 'normal',
    })
    expect(result).toEqual({ kind: 'blocked', reason: "L'Équipe et toutes les Boîtes PC sont pleines." })
    expect(inventory.get(1)).toBe(1)
  })
})
