import { describe, expect, it } from 'vitest'
import { decodeHgssPokemonSummaryNames } from './pokemonSummaryMessages'

describe('HGSS Pokémon summary message banks', () => {
  it('refuse un catalogue de noms absent au lieu d’inventer des libellés', () => {
    expect(() => decodeHgssPokemonSummaryNames(new Uint8Array(), [])).toThrow('banque ROM 34')
  })
})
