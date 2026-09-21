import type { CanonicalPokemon } from './canonicalPokemon'

export const hgssPokemonNicknameMaxLength = 10

/** `NamingScreenArgs::noInput == FALSE` pour le clavier Pokémon HGSS. */
export function hasHgssPokemonNicknameInput(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  for (const character of value.slice(0, hgssPokemonNicknameMaxLength)) {
    if (character !== ' ') return true
  }
  return false
}

export function normalizePokemonNickname(value: string): string | undefined {
  return hasHgssPokemonNicknameInput(value) ? value.slice(0, hgssPokemonNicknameMaxLength) : undefined
}

export function setPokemonNickname(pokemon: CanonicalPokemon, value: string): boolean {
  const nickname = normalizePokemonNickname(value)
  const nicknameSource = nickname === undefined ? undefined : 'user-text' as const
  if (pokemon.nickname === nickname && pokemon.nicknameSource === nicknameSource) return false
  pokemon.nickname = nickname
  pokemon.nicknameSource = nicknameSource
  pokemon.nicknameLocalRef = undefined
  return true
}
