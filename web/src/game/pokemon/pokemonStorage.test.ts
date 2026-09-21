import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from './canonicalPokemon'
import { createHgssSessionRng } from './hgssSessionRng'
import { createPokemonTestCatalog } from './pokemonTestCatalog'
import {
  createPokemonStorage,
  findFirstPokemonStorageSlot,
  hgssStorageBoxCapacity,
  hgssStorageBoxCount,
  placePokemonInFirstStorageSlot,
} from './pokemonStorage'

function createPokemon(speciesId = 155) {
  const rng = createHgssSessionRng(speciesId)
  return createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId,
    level: 5,
    rng: rng.lc,
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
}

describe('HGSS Pokemon storage', () => {
  it('uses 18 boxes of 30 slots and starts in box 1', () => {
    const storage = createPokemonStorage()
    expect(storage.currentBox).toBe(0)
    expect(storage.boxes).toHaveLength(hgssStorageBoxCount)
    expect(storage.boxes.every((box) => box.length === hgssStorageBoxCapacity)).toBe(true)
    expect(findFirstPokemonStorageSlot(storage)).toEqual({ box: 0, slot: 0 })
  })

  it('wraps from the active box and restores PP when boxing a capture', () => {
    const pokemon = createPokemon()
    pokemon.moves[0]!.pp = 1
    const fullBox = Array.from({ length: hgssStorageBoxCapacity }, () => createPokemon(152))
    const storage = createPokemonStorage([[], [], fullBox], 2)

    expect(placePokemonInFirstStorageSlot(storage, pokemon)).toEqual({ previousBox: 2, box: 3, slot: 0 })
    expect(storage.currentBox).toBe(3)
    expect(storage.boxes[3]![0]?.moves[0]?.pp).toBe(pokemon.moves[0]!.maxPp)
    expect(storage.boxes[3]![0]).not.toBe(pokemon)
  })

  it('reports a completely full PC', () => {
    const pokemon = createPokemon()
    const boxes = Array.from({ length: hgssStorageBoxCount }, () => (
      Array.from({ length: hgssStorageBoxCapacity }, () => pokemon)
    ))
    expect(findFirstPokemonStorageSlot(createPokemonStorage(boxes))).toBeUndefined()
  })
})
