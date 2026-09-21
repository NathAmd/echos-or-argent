import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon, CanonicalPokemonMove } from './canonicalPokemon'

export type PokemonMoveLearningOutcome = {
  learnedMoveIds: number[]
  skippedMoveIds: number[]
}

export type HgssFriendshipGainContext = {
  currentLocationId?: number
  holdEffect?: number
}

const hgssLuxuryBallId = 11
const hgssFriendshipUpHoldEffect = 53

function createMove(catalog: PokemonCatalog, moveId: number): CanonicalPokemonMove {
  const data = catalog.moves[moveId]
  if (!data) throw new Error(`La capacite Pokemon ${moveId} est absente du catalogue ROM.`)
  return { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
}

/**
 * Applique les modificateurs communs de gain d'amitie HGSS dans leur ordre natif :
 * Ball Luxe, lieu de rencontre, puis Grelot Zen et enfin plafonnement.
 */
export function applyHgssFriendshipGain(
  pokemon: CanonicalPokemon,
  baseGain: number,
  context: HgssFriendshipGainContext = {},
): number {
  if (!Number.isInteger(baseGain) || baseGain <= 0 || pokemon.friendship >= 255) return 0
  let gain = baseGain
  if (pokemon.ballId === hgssLuxuryBallId) gain += 1
  if (context.currentLocationId !== undefined && context.currentLocationId === pokemon.origin.metLocation) gain += 1
  if (context.holdEffect === hgssFriendshipUpHoldEffect) gain = Math.floor(gain * 150 / 100)
  const previous = pokemon.friendship
  pokemon.friendship = Math.min(255, previous + gain)
  return pokemon.friendship - previous
}

/** Gain FRIENDSHIP_EVENT_GROW_LEVEL : +5 / +3 / +2 selon le palier courant. */
export function applyHgssLevelUpFriendship(
  pokemon: CanonicalPokemon,
  context: HgssFriendshipGainContext = {},
): number {
  const baseGain = pokemon.friendship < 100 ? 5 : pokemon.friendship < 200 ? 3 : 2
  return applyHgssFriendshipGain(pokemon, baseGain, context)
}

/**
 * Applique une seule fois les capacites du learnset d'une espece pour un niveau.
 * Les choix qui exigent l'interface sont retournes sans supprimer arbitrairement
 * une capacite existante.
 */
export function applyPokemonMovesAtLevel(
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
  level = pokemon.level,
  speciesId = pokemon.speciesId,
): PokemonMoveLearningOutcome {
  const learnset = catalog.levelUpLearnsets[speciesId]
  if (!learnset) throw new Error(`Le learnset Pokemon ${speciesId} est absent du catalogue ROM.`)
  const learnedMoveIds: number[] = []
  const skippedMoveIds: number[] = []
  for (const entry of learnset) {
    if (entry.level !== level || pokemon.moves.some((move) => move.moveId === entry.moveId)) continue
    if (pokemon.moves.length < 4) {
      pokemon.moves.push(createMove(catalog, entry.moveId))
      learnedMoveIds.push(entry.moveId)
    } else {
      skippedMoveIds.push(entry.moveId)
    }
  }
  return { learnedMoveIds, skippedMoveIds }
}
