import { describe, expect, it } from 'vitest'
import {
  advanceHgssLcrng,
  createBoxPokemonRandomValues,
  createHgssLcrng,
} from './hgssPokemonRng'

describe('HGSS Pokemon LCRNG', () => {
  it('matches the 32-bit LCRandom recurrence and upper-word outputs', () => {
    const expected = [
      { seed: 0x00006073, value: 0x0000 },
      { seed: 0xe97e7b6a, value: 0xe97e },
      { seed: 0x52713895, value: 0x5271 },
      { seed: 0x31b0dde4, value: 0x31b0 },
    ]
    let seed = 0

    for (const step of expected) {
      const result = advanceHgssLcrng(seed)
      expect(result).toEqual(step)
      seed = result.seed
    }
  })

  it('consumes PID low/high words before the two packed IV words', () => {
    const rng = createHgssLcrng(0)

    expect(createBoxPokemonRandomValues(
      rng,
      { kind: 'random' },
      { kind: 'none' },
      { kind: 'random' },
    )).toEqual({
      personality: 0xe97e0000,
      originalTrainerId: 0,
      individualValues: {
        hp: 17,
        attack: 19,
        defense: 20,
        speed: 16,
        specialAttack: 13,
        specialDefense: 12,
      },
    })
    expect(rng.getSeed()).toBe(0x31b0dde4)
  })

  it('does not consume RNG words for fixed personality, trainer, or IVs', () => {
    const rng = createHgssLcrng(0x12345678)

    expect(createBoxPokemonRandomValues(
      rng,
      { kind: 'fixed', value: 0x87654321 },
      { kind: 'fixed', value: 0x10203040 },
      { kind: 'fixed', value: 31 },
    )).toEqual({
      personality: 0x87654321,
      originalTrainerId: 0x10203040,
      individualValues: {
        hp: 31,
        attack: 31,
        defense: 31,
        speed: 31,
        specialAttack: 31,
        specialDefense: 31,
      },
    })
    expect(rng.getSeed()).toBe(0x12345678)
  })

  it('rejects random trainer IDs that would make the fixed personality shiny', () => {
    const rng = createHgssLcrng(0x2e01)

    const values = createBoxPokemonRandomValues(
      rng,
      { kind: 'fixed', value: 0 },
      { kind: 'randomNonShiny' },
      { kind: 'fixed', value: 0 },
    )

    expect(values.originalTrainerId).toBe(0x4a8c6ad7)
    expect(rng.getSeed()).toBe(0x4a8c6af5)
  })
})