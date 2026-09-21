import { describe, expect, it } from 'vitest'
import type { PokemonCatalog } from '../../ndsTypes'
import { createHgssLcrng } from './hgssPokemonRng'
import { createCanonicalPokemon } from './canonicalPokemon'

const catalog: PokemonCatalog = {
  speciesNames: Array.from({ length: 153 }, (_, speciesId) => speciesId === 152 ? 'GERMIGNON' : `ESPECE ${speciesId}`),
  moveNames: Array.from({ length: 46 }, (_, moveId) => `CAPACITE ${moveId}`),
  personalData: Array.from({ length: 153 }, (_, speciesId) => ({
    speciesId,
    baseStats: speciesId === 152
      ? { hp: 45, attack: 49, defense: 65, speed: 45, specialAttack: 49, specialDefense: 65 }
      : { hp: 1, attack: 1, defense: 1, speed: 1, specialAttack: 1, specialDefense: 1 },
    types: [12, 12] as const,
    catchRate: 45,
    experienceYield: 64,
    evYield: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    heldItems: [0, 0] as const,
    genderRatio: 31,
    eggCycles: 20,
    baseFriendship: 70,
    growthRate: 0,
    eggGroups: [1, 7] as const,
    abilities: [65, 0] as const,
    greatMarshFleeRate: 0,
    bodyColor: 5,
    flipSprite: false,
    tmHmCompatibility: [0, 0, 0, 0] as const,
  })),
  growthTables: [{ growthRate: 0, experienceByLevel: Array.from({ length: 101 }, (_, level) => level ** 3) }],
  moves: Array.from({ length: 46 }, (_, moveId) => ({
    moveId,
    effect: 0,
    category: 0,
    power: 0,
    type: 0,
    accuracy: 100,
    pp: moveId === 33 ? 35 : 40,
    effectChance: 0,
    range: 0,
    priority: 0,
    flags: 0,
    contestEffect: 0,
    contestType: 0,
    contestUnknown: 0,
  })),
  levelUpLearnsets: Array.from({ length: 153 }, (_, speciesId) => speciesId === 152
    ? [{ level: 1, moveId: 33 }, { level: 1, moveId: 45 }]
    : []),
  evolutions: Array.from({ length: 153 }, () => []),
  followers: {
    parameters: Array.from({ length: 153 }, (_, modelIndex) => ({ modelIndex, size: 0, values: [0, 0, 0, 0] as const })),
    modelIndexBySpecies: Array.from({ length: 153 }, (_, speciesId) => speciesId),
  },
}

describe('canonical Pokemon construction', () => {
  it('derives every initial gameplay value from ROM catalogs and the HGSS RNG', () => {
    const rng = createHgssLcrng(0)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152,
      level: 5,
      rng,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 0x12345678, name: 'JO', gender: 'female' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    })

    expect(pokemon).toMatchObject({
      speciesId: 152,
      speciesName: 'GERMIGNON',
      level: 5,
      experience: 125,
      personality: 0xe97e0000,
      individualValues: { hp: 17, attack: 19, defense: 20, speed: 16, specialAttack: 13, specialDefense: 12 },
      effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
      nature: 14,
      gender: 'female',
      abilityId: 65,
      friendship: 70,
      moves: [{ moveId: 33, pp: 35, maxPp: 35, ppUps: 0 }, { moveId: 45, pp: 40, maxPp: 40, ppUps: 0 }],
      currentHp: 20,
      status: 0,
      heldItemId: 0,
      ballId: 4,
      isEgg: false,
      fatefulEncounter: false,
      ribbonIds: [],
    })
    expect(rng.getSeed()).toBe(0x31b0dde4)
  })

  it('accepts the native fixed values used by trainer Pokemon', () => {
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152,
      level: 5,
      rng: createHgssLcrng(495),
      personality: { kind: 'fixed', value: 0x123488 },
      individualValues: { kind: 'fixed', value: 12 },
      originalTrainer: { id: 0, name: 'SILVER', gender: 'male' },
      originalTrainerId: { kind: 'randomNonShiny' },
      origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
      moveIds: [33, 0, 45, 0],
      friendship: 255,
      ballId: 4,
    })

    expect(pokemon).toMatchObject({
      personality: 0x123488,
      individualValues: { hp: 12, attack: 12, defense: 12, speed: 12, specialAttack: 12, specialDefense: 12 },
      moves: [{ moveId: 33 }, { moveId: 45 }],
      friendship: 255,
      shiny: false,
    })
    expect(pokemon.originalTrainer.id).not.toBe(0)
  })
})
