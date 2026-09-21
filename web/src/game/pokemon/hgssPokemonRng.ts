import type { PokemonStatValues } from './pokemonFormulas'
import { isShinyPersonality } from './pokemonFormulas'

const lcrngMultiplier = 1103515245
const lcrngIncrement = 24691

export type HgssLcrngStep = {
  seed: number
  value: number
}

export type HgssLcrng = {
  getSeed: () => number
  nextU16: () => number
}

export type PokemonPersonalitySource =
  | { kind: 'random' }
  | { kind: 'fixed', value: number }

export type PokemonOriginalTrainerSource =
  | { kind: 'none' }
  | { kind: 'fixed', value: number }
  | { kind: 'randomNonShiny' }

export type PokemonIndividualValueSource =
  | { kind: 'random' }
  | { kind: 'fixed', value: number }

export type BoxPokemonRandomValues = {
  personality: number
  originalTrainerId: number
  individualValues: PokemonStatValues
}

function validateUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} ${value} est invalide.`)
  }
}

function combineLcrngWords(rng: HgssLcrng): number {
  const low = rng.nextU16()
  const high = rng.nextU16()
  return (low | (high << 16)) >>> 0
}

export function advanceHgssLcrng(seed: number): HgssLcrngStep {
  validateUint32(seed, 'La graine LCRNG')
  const nextSeed = (Math.imul(seed, lcrngMultiplier) + lcrngIncrement) >>> 0
  return { seed: nextSeed, value: nextSeed >>> 16 }
}

export function createHgssLcrng(initialSeed: number): HgssLcrng {
  validateUint32(initialSeed, 'La graine LCRNG')
  let seed = initialSeed
  return {
    getSeed: () => seed,
    nextU16: () => {
      const step = advanceHgssLcrng(seed)
      seed = step.seed
      return step.value
    },
  }
}

/** Port exact de GenerateShinyPersonality : les 13 bits hauts sont répartis
 * entre les deux moitiés du PID pour conserver un XOR de chromaticité < 8. */
export function generateHgssShinyPersonality(originalTrainerId: number, rng: HgssLcrng): number {
  validateUint32(originalTrainerId, 'L’identifiant du Dresseur d’origine')
  const trainerXor = (((originalTrainerId >>> 16) ^ (originalTrainerId & 0xffff)) >>> 3) & 0x1fff
  let low = rng.nextU16() & 7
  let high = rng.nextU16() & 7
  for (let bit = 0; bit < 13; bit += 1) {
    const mask = 1 << bit
    const personalityMask = 1 << (bit + 3)
    if ((trainerXor & mask) !== 0) {
      if ((rng.nextU16() & 1) !== 0) low |= personalityMask
      else high |= personalityMask
    } else if ((rng.nextU16() & 1) !== 0) {
      low |= personalityMask
      high |= personalityMask
    }
  }
  return ((high << 16) | low) >>> 0
}

export function createBoxPokemonRandomValues(
  rng: HgssLcrng,
  personalitySource: PokemonPersonalitySource,
  originalTrainerSource: PokemonOriginalTrainerSource,
  individualValueSource: PokemonIndividualValueSource,
): BoxPokemonRandomValues {
  const personality = personalitySource.kind === 'random'
    ? combineLcrngWords(rng)
    : personalitySource.value
  validateUint32(personality, 'La personnalite Pokemon')

  let originalTrainerId = 0
  if (originalTrainerSource.kind === 'fixed') {
    originalTrainerId = originalTrainerSource.value
    validateUint32(originalTrainerId, 'L’identifiant du Dresseur d’origine')
  } else if (originalTrainerSource.kind === 'randomNonShiny') {
    do {
      originalTrainerId = combineLcrngWords(rng)
    } while (isShinyPersonality(originalTrainerId, personality))
  }

  let individualValues: PokemonStatValues
  if (individualValueSource.kind === 'fixed') {
    const value = individualValueSource.value
    if (!Number.isInteger(value) || value < 0 || value >= 32) {
      throw new Error(`L’IV Pokemon fixe ${value} est invalide.`)
    }
    individualValues = {
      hp: value,
      attack: value,
      defense: value,
      speed: value,
      specialAttack: value,
      specialDefense: value,
    }
  } else {
    const firstWord = rng.nextU16()
    const secondWord = rng.nextU16()
    individualValues = {
      hp: firstWord & 0x1f,
      attack: (firstWord >>> 5) & 0x1f,
      defense: (firstWord >>> 10) & 0x1f,
      speed: secondWord & 0x1f,
      specialAttack: (secondWord >>> 5) & 0x1f,
      specialDefense: (secondWord >>> 10) & 0x1f,
    }
  }

  return { personality, originalTrainerId, individualValues }
}
