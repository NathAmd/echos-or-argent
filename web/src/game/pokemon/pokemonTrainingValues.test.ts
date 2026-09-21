import { describe, expect, it } from 'vitest'
import type { PokemonStatValues } from './pokemonFormulas'
import { calculatePokemonEvTotal, calculatePokemonIvScore, formatPokemonIvScore, resolvePokemonNatureStatModifier } from './pokemonTrainingValues'

function values(value: number): PokemonStatValues {
  return { hp: value, attack: value, defense: value, specialAttack: value, specialDefense: value, speed: value }
}

describe('score IV commun', () => {
  it('normalise la moyenne des six IV immuables sur dix', () => {
    expect(calculatePokemonIvScore(values(0))).toBe(0)
    expect(calculatePokemonIvScore(values(31))).toBe(10)
    expect(calculatePokemonIvScore(values(15.5))).toBe(5)
  })

  it('borne les données invalides sans produire un score hors échelle', () => {
    expect(calculatePokemonIvScore({ ...values(31), hp: 99 })).toBe(10)
    expect(calculatePokemonIvScore({ ...values(0), hp: -20 })).toBe(0)
    expect(formatPokemonIvScore(values(31))).toBe('10,0')
  })

  it('additionne les six EV sans confondre leur total avec les IV', () => {
    expect(calculatePokemonEvTotal({ ...values(0), attack: 252, speed: 252, hp: 6 })).toBe(510)
  })

  it('expose visuellement les deux statistiques réellement modifiées par la nature', () => {
    expect(resolvePokemonNatureStatModifier(3, 'attack')).toBe(1)
    expect(resolvePokemonNatureStatModifier(3, 'specialAttack')).toBe(-1)
    expect(resolvePokemonNatureStatModifier(3, 'speed')).toBe(0)
    expect(resolvePokemonNatureStatModifier(0, 'attack')).toBe(0)
  })
})
