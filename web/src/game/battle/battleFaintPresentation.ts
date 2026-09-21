import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

type BattleFaintPokemon = Pick<CanonicalPokemon, 'instanceId' | 'currentHp'>

export function isSameBattlePokemon(
  expected: BattleFaintPokemon,
  current: BattleFaintPokemon,
): boolean {
  return expected.instanceId === current.instanceId
}

/** Une animation de K.O. ne peut viser que le Pokémon vaincu encore présent. */
export function shouldPresentBattleFaint(
  defeated: BattleFaintPokemon,
  current: BattleFaintPokemon,
): boolean {
  return current.currentHp <= 0 && isSameBattlePokemon(defeated, current)
}
