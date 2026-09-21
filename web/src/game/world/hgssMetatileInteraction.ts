import type { PlayerDirection } from '../../ndsTypes'
import { isWaterfallMetatile, isWhirlpoolMetatile, type PlayerLocomotionMode } from '../player/hgssPlayerMovement'

export type HgssMetatileInteractionContext = {
  standingBehavior: number
  facingBehavior: number
  direction: PlayerDirection
  locomotion: PlayerLocomotionMode
}

export const hgssFieldMetatileScriptIds = {
  waterfall: 10005,
  whirlpool: 10016,
} as const

const staticInteractionScripts = new Map<number, number>([
  [224, 2500], // Small bookshelf: picture books
  [234, 2501], // Small bookshelf: books for Pokemon
  [225, 2502], // Bookshelf: chock-full of books
  [226, 2503], // Bookshelf: magazines
  [228, 2504], // Empty trash can
  [229, 2505], // Mart shelf: vibrant Pokemon goods
  [235, 2506], // Mart shelf: convenient items
  [236, 2507], // Mart shelf: Pokemon merchandise
  [133, 2508], // Town map
  [6, 10014], // Headbutt tree
])

/**
 * Reproduit GetInteractedMetatileScript de HGSS pour les interactions qui ne
 * dependent que du terrain et de l'etat local du joueur. Les services, objets
 * et PNJ explicites restent prioritaires dans WorldSession, comme dans la ROM.
 */
export function resolveHgssMetatileInteractionScript({
  standingBehavior,
  facingBehavior,
  direction,
  locomotion,
}: HgssMetatileInteractionContext): number | undefined {
  if (standingBehavior === 34) return undefined
  if (facingBehavior === 131 && direction === 'north') return 2010
  const staticScript = staticInteractionScripts.get(facingBehavior)
  if (staticScript !== undefined) return staticScript
  if (facingBehavior === 134 && direction === 'north') return 10100
  if (facingBehavior === 75 && (direction === 'north' || direction === 'south')) return 10003
  if (facingBehavior === 76 && (direction === 'east' || direction === 'west')) return 10003
  // La tache native Cascade ne possede que des trajectoires nord/sud. Ne pas
  // exposer son script depuis un cote evite qu'un hote tente ensuite de
  // fabriquer un mouvement horizontal incoherent.
  if (locomotion === 'surfing'
    && (direction === 'north' || direction === 'south')
    && isWaterfallMetatile(facingBehavior)) return hgssFieldMetatileScriptIds.waterfall
  if (locomotion === 'surfing' && isWhirlpoolMetatile(facingBehavior)) return hgssFieldMetatileScriptIds.whirlpool
  return undefined
}
