import type { CanonicalPokemon } from './canonicalPokemon'

const hgssFieldPoisonStatusMask = 0x08 | 0x80

export function isHgssFieldPoisoned(pokemon: Pick<CanonicalPokemon, 'status'>): boolean {
  return (pokemon.status & hgssFieldPoisonStatusMask) !== 0
}

/** Porte la primitive native SurvivePoisoning appelée par le script standard 2003. */
export function surviveHgssFieldPoisoning(pokemon: CanonicalPokemon): boolean {
  if (pokemon.currentHp !== 1 || !isHgssFieldPoisoned(pokemon)) return false
  pokemon.status = 0
  return true
}
