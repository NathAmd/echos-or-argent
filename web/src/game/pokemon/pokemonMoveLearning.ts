import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon, CanonicalPokemonMove } from './canonicalPokemon'

export type PokemonMoveReplacementResult =
  | { kind: 'cancelled' }
  | { kind: 'replaced', forgotten: CanonicalPokemonMove, learned: CanonicalPokemonMove }

/**
 * Applies a level-up replacement only after an explicit valid slot choice.
 * A cancel or stale UI index is deliberately non-destructive.
 */
export function replacePokemonMoveAfterChoice(
  pokemon: CanonicalPokemon,
  moveId: number,
  forgetIndex: number,
  catalog: PokemonCatalog,
): PokemonMoveReplacementResult {
  const forgotten = pokemon.moves[forgetIndex]
  if (!Number.isInteger(forgetIndex) || forgetIndex < 0 || !forgotten) return { kind: 'cancelled' }
  if (pokemon.moves.some((move) => move.moveId === moveId)) return { kind: 'cancelled' }
  const data = catalog.moves[moveId]
  if (!data) throw new Error(`La capacité ROM ${moveId} à apprendre est absente.`)
  const learned = { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
  pokemon.moves[forgetIndex] = learned
  return { kind: 'replaced', forgotten, learned }
}
