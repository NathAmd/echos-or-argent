import { getMetatileBehavior, type PlayerLocomotionMode } from './hgssPlayerMovement'

// sub_0205BA24 / sub_0205BA30 et sub_02060AB8 : le moteur HGSS ne confond
// pas le tablier avec l'eau qui partage son metatile. Le comportement 112
// active MapObject flag 28, 113..115 le conservent, toute autre case l'efface.
const bridgeEntryBehavior = 112
const bridgeContinuationBehaviors = new Set([113, 114, 115])

export function isHgssBridgeMetatile(attribute: number | undefined): boolean {
  const behavior = getMetatileBehavior(attribute)
  return behavior === bridgeEntryBehavior || (behavior !== undefined && bridgeContinuationBehaviors.has(behavior))
}

export function advanceHgssBridgeLayer(active: boolean, attribute: number | undefined): boolean {
  const behavior = getMetatileBehavior(attribute)
  if (behavior === bridgeEntryBehavior) return true
  return active && behavior !== undefined && bridgeContinuationBehaviors.has(behavior)
}

/** Reconstitue le flag non sauvegardé lors d'une reprise sur un pont. */
export function restoreHgssBridgeLayer(attribute: number | undefined, locomotion: PlayerLocomotionMode): boolean {
  return locomotion !== 'surfing' && isHgssBridgeMetatile(attribute)
}
