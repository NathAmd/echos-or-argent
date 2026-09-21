import type { PlayerDirection } from '../../ndsTypes'
import type { FieldMovementAction } from './fieldMovement'

/** La tâche native franchit la tuile Cascade et rejoint l'eau opposée. */
export const hgssWaterfallTraversalDistance = 2
export const hgssWaterfallTraversalDurationFrames = 96

const waterfallPhaseFrames = [32, 64] as const

/**
 * Traduit CallFieldTask_Waterfall en phases consommables par tous les hôtes
 * du protocole terrain (rendu, simulation et WorldSession).
 */
export function createHgssWaterfallMovement(direction: PlayerDirection): FieldMovementAction[] {
  if (direction !== 'north' && direction !== 'south') {
    throw new Error(`La Cascade HGSS ne peut pas être franchie vers ${direction}.`)
  }
  const action = direction === 'north' ? 4 : 5
  return waterfallPhaseFrames.map((durationFrames) => ({
    action,
    repetitions: 1,
    direction,
    tileDistance: 0,
    kind: 'walk',
    durationFrames,
  }))
}

type HgssWaterfallScriptState = {
  party: { members: readonly unknown[] }
  player: { x: number, z: number, direction: PlayerDirection }
}

/** Exécute ScrCmd_Waterfall (179) et produit l'étape protocolaire partagée. */
export function runHgssWaterfallScriptCommand(
  state: HgssWaterfallScriptState,
  partySlot: number,
  consumeOperand: () => void,
) {
  consumeOperand()
  if (!state.party.members[partySlot]) {
    throw new Error(`Le slot ${partySlot} demandé par Waterfall est absent de l’équipe.`)
  }
  const actions = createHgssWaterfallMovement(state.player.direction)
  state.player.z += (state.player.direction === 'north' ? -1 : 1) * hgssWaterfallTraversalDistance
  return { kind: 'movement' as const, objectId: 255, actions }
}
