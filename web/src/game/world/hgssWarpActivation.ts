import type { PlayerDirection } from '../../ndsTypes'

export const hgssWarpMetatileBehaviors = {
  ladderNorth: 60,
  ladderSouth: 61,
  ladderDown: 62,
  stairsEast: 94,
  stairsWest: 95,
  entranceEast: 98,
  entranceWest: 99,
  entranceNorth: 100,
  entranceSouth: 101,
  panel: 103,
  door: 105,
  escalatorFlipFace: 106,
  escalator: 107,
  warpEast: 108,
  warpWest: 109,
  warpNorth: 110,
  warpSouth: 111,
} as const

export type HgssWarpCheckPhase = 'facing-door' | 'current-held' | 'completed-step'
export type HgssWarpTrigger = HgssWarpCheckPhase | 'completed-step-held'
export type HgssWarpTransitionKind = 'door' | 'direct' | 'stairs' | 'ladder' | 'ladder-down' | 'escalator' | 'panel'

export type HgssWarpActivation = {
  trigger: HgssWarpTrigger
  behavior: number
  transition: HgssWarpTransitionKind
  /** Orientation transmise par HGSS au chargement de la carte destination. */
  direction: PlayerDirection
  /** Direction qui doit encore être tenue à la fin du pas, le cas échéant. */
  heldDirection?: PlayerDirection
}

const heldActivationByBehavior: Readonly<Partial<Record<number, Pick<HgssWarpActivation, 'direction' | 'transition'>>>> = {
  [hgssWarpMetatileBehaviors.ladderNorth]: { direction: 'north', transition: 'ladder' },
  [hgssWarpMetatileBehaviors.ladderSouth]: { direction: 'south', transition: 'ladder' },
  [hgssWarpMetatileBehaviors.stairsEast]: { direction: 'east', transition: 'stairs' },
  [hgssWarpMetatileBehaviors.stairsWest]: { direction: 'west', transition: 'stairs' },
  [hgssWarpMetatileBehaviors.entranceEast]: { direction: 'east', transition: 'direct' },
  [hgssWarpMetatileBehaviors.entranceWest]: { direction: 'west', transition: 'direct' },
  [hgssWarpMetatileBehaviors.entranceSouth]: { direction: 'south', transition: 'direct' },
  [hgssWarpMetatileBehaviors.warpEast]: { direction: 'east', transition: 'direct' },
  [hgssWarpMetatileBehaviors.warpWest]: { direction: 'west', transition: 'direct' },
  [hgssWarpMetatileBehaviors.warpSouth]: { direction: 'south', transition: 'direct' },
}

/**
 * Reproduit les trois points où HGSS consulte un WarpEvent. La présence d'un
 * WarpEvent ne suffit jamais : sa permission BDHC choisit la phase, le type de
 * transition et l'orientation chargée sur la carte destination.
 */
export function resolveHgssWarpActivation(
  terrainAttribute: number | undefined,
  direction: PlayerDirection,
  phase: HgssWarpCheckPhase,
): HgssWarpActivation | undefined {
  if (terrainAttribute === undefined) return undefined
  const behavior = terrainAttribute & 0xff

  if (phase === 'facing-door') {
    return behavior === hgssWarpMetatileBehaviors.door && (terrainAttribute & 0x8000) !== 0
      ? { trigger: phase, behavior, transition: 'door', direction }
      : undefined
  }

  if (phase === 'current-held') {
    const activation = heldActivationByBehavior[behavior]
    return activation?.direction === direction
      ? { trigger: phase, behavior, ...activation, heldDirection: direction }
      : undefined
  }

  if (behavior === hgssWarpMetatileBehaviors.ladderDown) {
    return { trigger: phase, behavior, transition: 'ladder-down', direction: 'north' }
  }
  if (behavior === hgssWarpMetatileBehaviors.entranceNorth || behavior === hgssWarpMetatileBehaviors.warpNorth) {
    return { trigger: phase, behavior, transition: 'direct', direction: 'north' }
  }
  if (behavior === hgssWarpMetatileBehaviors.panel) {
    // Le chargement conserve cette orientation; la routine d'arrivée force
    // ensuite le joueur et son follower face au sud.
    return { trigger: phase, behavior, transition: 'panel', direction }
  }
  if (behavior === hgssWarpMetatileBehaviors.escalatorFlipFace || behavior === hgssWarpMetatileBehaviors.escalator) {
    if (direction !== 'east' && direction !== 'west') return undefined
    const destinationDirection = behavior === hgssWarpMetatileBehaviors.escalatorFlipFace
      ? direction === 'east' ? 'west' : 'east'
      : direction
    return { trigger: phase, behavior, transition: 'escalator', direction: destinationDirection }
  }

  // Les entrées E/O/S, escaliers et échelles sont examinés plus tard dans
  // FieldSystem_CheckMapTransition, seulement si la direction reste tenue.
  const heldActivation = heldActivationByBehavior[behavior]
  return heldActivation?.direction === direction
    ? { trigger: 'completed-step-held', behavior, ...heldActivation, heldDirection: direction }
    : undefined
}
