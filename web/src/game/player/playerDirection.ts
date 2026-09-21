import type { PlayerDirection } from '../../ndsTypes'

/**
 * Ordre cardinal natif utilisé par les événements et commandes HGSS.
 *
 * Cet ordre est une règle de format partagée. Le conserver ici évite que les
 * scripts, les mouvements et la session du monde divergent silencieusement.
 */
export const hgssPlayerDirections = ['north', 'south', 'west', 'east'] as const satisfies readonly PlayerDirection[]

export function decodeHgssPlayerDirection(value: number, fallback: PlayerDirection = 'south'): PlayerDirection {
  return hgssPlayerDirections[value] ?? fallback
}

export function encodeHgssPlayerDirection(direction: PlayerDirection): number {
  return hgssPlayerDirections.indexOf(direction)
}
