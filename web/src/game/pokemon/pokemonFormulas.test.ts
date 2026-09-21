import { describe, expect, it } from 'vitest'
import type { PokemonPersonalData } from '../../rom/pokemon/personalData'
import {
  applyNatureToStat,
  calculatePokemonStats,
  getAbilityFromPersonality,
  getGenderFromPersonality,
  getNatureFromPersonality,
  isShinyPersonality,
  type PokemonStatValues,
} from './pokemonFormulas'

function createPersonalData(overrides: Partial<PokemonPersonalData> = {}): PokemonPersonalData {
  return {
    speciesId: 152,
    baseStats: { hp: 45, attack: 49, defense: 65, speed: 45, specialAttack: 49, specialDefense: 65 },
    types: [12, 12],
    catchRate: 45,
    experienceYield: 64,
    evYield: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 1 },
    heldItems: [0, 0],
    genderRatio: 31,
    eggCycles: 20,
    baseFriendship: 70,
    growthRate: 3,
    eggGroups: [1, 7],
    abilities: [65, 102],
    greatMarshFleeRate: 0,
    bodyColor: 5,
    flipSprite: false,
    tmHmCompatibility: [0, 0, 0, 0],
    ...overrides,
  }
}

const zeroValues: PokemonStatValues = { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 }

describe('HGSS Pokemon formulas', () => {
  it('derives nature, ability, gender, and shininess from the personality fields', () => {
    const personalData = createPersonalData()
    expect(getNatureFromPersonality(28)).toBe(3)
    expect(getAbilityFromPersonality(personalData, 2)).toBe(65)
    expect(getAbilityFromPersonality(personalData, 3)).toBe(102)
    expect(getGenderFromPersonality(personalData, 30)).toBe('female')
    expect(getGenderFromPersonality(personalData, 31)).toBe('male')
    expect(getGenderFromPersonality(createPersonalData({ genderRatio: 255 }), 0)).toBe('genderless')
    expect(isShinyPersonality(0x12345678, 0x12345678)).toBe(true)
    expect(isShinyPersonality(0, 8)).toBe(false)
  })

  it('applies nature modifiers and the Gen IV integer stat formulas', () => {
    const individualValues = { ...zeroValues, hp: 31, attack: 31, defense: 31, speed: 31, specialAttack: 31, specialDefense: 31 }
    expect(applyNatureToStat(20, 3, 0)).toBe(22)
    expect(applyNatureToStat(20, 3, 3)).toBe(18)
    expect(calculatePokemonStats(createPersonalData(), 5, individualValues, zeroValues, 3)).toEqual({
      hp: 21,
      attack: 12,
      defense: 13,
      speed: 11,
      specialAttack: 9,
      specialDefense: 13,
    })
  })

  it('preserves Shedinja at one HP and rejects invalid IV or EV state', () => {
    expect(calculatePokemonStats(createPersonalData({ speciesId: 292 }), 100, zeroValues, zeroValues, 0).hp).toBe(1)
    expect(() => calculatePokemonStats(createPersonalData(), 5, { ...zeroValues, hp: 32 }, zeroValues, 0)).toThrow('IV hp=32')
    expect(() => calculatePokemonStats(createPersonalData(), 5, zeroValues, { ...zeroValues, hp: 255, attack: 255, defense: 1 }, 0)).toThrow('depasse 510')
  })
})