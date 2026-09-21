import type { PokemonCatalog } from '../../ndsTypes'

const starterStats = {
  152: { hp: 45, attack: 49, defense: 65, speed: 45, specialAttack: 49, specialDefense: 65 },
  155: { hp: 39, attack: 52, defense: 43, speed: 65, specialAttack: 60, specialDefense: 50 },
  158: { hp: 50, attack: 65, defense: 64, speed: 43, specialAttack: 44, specialDefense: 48 },
} as const

const starterNames = { 152: 'GERMIGNON', 155: 'HERICENDRE', 158: 'KAIMINUS' } as const
const starterMoves = {
  152: [{ level: 1, moveId: 33 }, { level: 1, moveId: 45 }],
  155: [{ level: 1, moveId: 33 }, { level: 1, moveId: 43 }],
  158: [{ level: 1, moveId: 10 }, { level: 1, moveId: 43 }],
} as const

export function createPokemonTestCatalog(maximumSpeciesId = 158): PokemonCatalog {
  const speciesCount = maximumSpeciesId + 1
  return {
    speciesNames: Array.from({ length: speciesCount }, (_, speciesId) => starterNames[speciesId as keyof typeof starterNames] ?? `ESPECE ${speciesId}`),
    babySpecies: Array.from({ length: speciesCount }, (_, speciesId) => speciesId),
    eggMoves: Array.from({ length: speciesCount }, () => []),
    moveNames: Array.from({ length: 46 }, (_, moveId) => `CAPACITE ${moveId}`),
    weightsTenthsKg: Array.from({ length: speciesCount }, () => 100),
    naturePowerMoveIds: [89, 89, 402, 402, 157, 157, 59, 56, 58, 161, 426, 403, 161],
    camouflageTypeIds: [4, 4, 12, 12, 5, 5, 15, 11, 15, 0, 4, 2, 0],
    secretPowerEffectIds: [0x1b, 0x1b, 1, 1, 8, 8, 4, 0x16, 4, 5, 0x18, 0x1c, 5],
    personalData: Array.from({ length: speciesCount }, (_, speciesId) => ({
      speciesId,
      baseStats: starterStats[speciesId as keyof typeof starterStats]
        ?? { hp: 1, attack: 1, defense: 1, speed: 1, specialAttack: 1, specialDefense: 1 },
      types: [0, 0] as const,
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
      pp: moveId === 10 || moveId === 33 ? 35 : moveId === 43 ? 30 : 40,
      effectChance: 0,
      range: 0,
      priority: 0,
      flags: 0,
      contestEffect: 0,
      contestType: 0,
      contestUnknown: 0,
    })),
    levelUpLearnsets: Array.from({ length: speciesCount }, (_, speciesId) => [...(starterMoves[speciesId as keyof typeof starterMoves] ?? [])]),
    evolutions: Array.from({ length: speciesCount }, () => []),
    followers: {
      parameters: Array.from({ length: speciesCount }, (_, modelIndex) => ({ modelIndex, size: 0, values: [0, 0, 0, 0] as const })),
      modelIndexBySpecies: Array.from({ length: speciesCount }, (_, speciesId) => speciesId),
    },
  }
}
