import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from './canonicalPokemon'
import { normalizePokemonNickname, setPokemonNickname } from './pokemonNickname'

describe('Pokemon nickname', () => {
  it('applique la limite HGSS de dix caractères et conserve les espaces saisis', () => {
    expect(normalizePokemonNickname('  ÉCLAIR  ')).toBe('  ÉCLAIR  ')
    expect(normalizePokemonNickname('ABCDEFGHIJK')).toBe('ABCDEFGHIJ')
    expect(normalizePokemonNickname('   ')).toBeUndefined()
  })

  it('conserve le flag surnom quand la saisie est identique au nom d’espèce', () => {
    const pokemon = { speciesName: 'HERICENDRE', nickname: 'FLAMME' } as CanonicalPokemon
    expect(setPokemonNickname(pokemon, 'HERICENDRE')).toBe(true)
    expect(pokemon.nickname).toBe('HERICENDRE')
    expect(pokemon.nicknameSource).toBe('user-text')
    expect(setPokemonNickname(pokemon, 'HERICENDRE')).toBe(false)
  })

  it('reclasse une valeur locale ou legacy seulement après une saisie explicite du joueur', () => {
    const local = {
      speciesName: 'HERICENDRE',
      nickname: 'ROM-NAME',
      nicknameSource: 'local-ref',
    } as CanonicalPokemon
    const legacy = { speciesName: 'HERICENDRE', nickname: 'ANCIEN' } as CanonicalPokemon

    expect(setPokemonNickname(local, 'ROM-NAME')).toBe(true)
    expect(local.nicknameSource).toBe('user-text')
    expect(setPokemonNickname(legacy, 'ANCIEN')).toBe(true)
    expect(legacy.nicknameSource).toBe('user-text')

    expect(setPokemonNickname(legacy, '   ')).toBe(true)
    expect(legacy.nickname).toBeUndefined()
    expect(legacy.nicknameSource).toBeUndefined()
  })
})
