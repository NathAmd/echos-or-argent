import { describe, expect, it } from 'vitest'
import { formatPokemonStatus, getPokemonBattleStatusPresentation } from './pokemonStatus'

describe('formatPokemonStatus', () => {
  it('nomme les masques de statut persistants HGSS', () => {
    expect(formatPokemonStatus(0)).toBeUndefined()
    expect(formatPokemonStatus(3)).toBe('Sommeil')
    expect(formatPokemonStatus(0x8)).toBe('Poison')
    expect(formatPokemonStatus(0xf80)).toBe('Poison grave')
    expect(formatPokemonStatus(0x10 | 0x40)).toBe('Brûlure, Paralysie')
  })

  it('produit les badges courts du HUD dans la priorité native', () => {
    expect(getPokemonBattleStatusPresentation(0x80)).toEqual({ kind: 'bad-poison', shortLabel: 'TOX', label: 'Poison grave' })
    expect(getPokemonBattleStatusPresentation(0x10)).toEqual({ kind: 'burn', shortLabel: 'BRÛ', label: 'Brûlure' })
    expect(getPokemonBattleStatusPresentation(0x40)).toEqual({ kind: 'paralysis', shortLabel: 'PAR', label: 'Paralysie' })
    expect(getPokemonBattleStatusPresentation(0)).toBeUndefined()
  })
})
