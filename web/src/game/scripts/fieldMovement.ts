import type { PlayerDirection } from '../../ndsTypes'
import { hgssPlayerDirections } from '../player/playerDirection'

export type FieldMovementAction = {
  action: number
  repetitions: number
  direction?: PlayerDirection
  tileDistance: number
  kind: 'face' | 'walk' | 'walkInPlace' | 'jump' | 'delay' | 'effect'
  /** Duree d'une phase de tâche terrain sans commande MapObject equivalente. */
  durationFrames?: number
}

const delayFrames = [1, 2, 4, 8, 15, 16, 32] as const

/**
 * Duree native d'une repetition de commande de mouvement HGSS.
 *
 * Les commandes 4..43 utilisent les compteurs visibles dans
 * MapObjectMovementCmdXXX du moteur ARM9 : 32, 16, 8, 4 ou 2 VBlanks.
 * Les sauts emploient leurs compteurs propres. Conserver cette information
 * ici evite que le renderer remplace toutes les cinematiques par une meme
 * vitesse arbitraire.
 */
export function getFieldMovementDurationFrames(action: FieldMovementAction): number {
  if (action.durationFrames !== undefined) return action.durationFrames
  if (action.kind === 'delay') return delayFrames[action.action - 60] ?? 1
  if (action.action >= 4 && action.action <= 43) {
    const speedBand = Math.floor((action.action - (action.action >= 24 ? 24 : 4)) / 4)
    return [32, 16, 8, 4, 2][speedBand] ?? 8
  }
  if (action.action >= 44 && action.action <= 47) return 16
  if (action.action >= 48 && action.action <= 55) return 8
  if (action.action >= 56 && action.action <= 59) return 16
  if (action.action >= 76 && action.action <= 79) return 6
  if (action.action >= 80 && action.action <= 83) return 3
  if (action.action >= 84 && action.action <= 87) return 1
  if (action.action >= 88 && action.action <= 91) return 4
  if (action.action >= 92 && action.action <= 95) return 16
  if (action.action >= 96 && action.action <= 99) return 7
  if (action.kind === 'face') return 1
  return 1
}

function classifyMovement(action: number): FieldMovementAction['kind'] {
  if (action <= 3) return 'face'
  if ((action >= 4 && action <= 23) || (action >= 76 && action <= 91) || (action >= 96 && action <= 99)) return 'walk'
  if (action >= 24 && action <= 43) return 'walkInPlace'
  if ((action >= 44 && action <= 59) || (action >= 92 && action <= 95)) return 'jump'
  if (action >= 60 && action <= 66) return 'delay'
  return 'effect'
}

function movementDirection(action: number): PlayerDirection | undefined {
  if (action <= 59) return hgssPlayerDirections[action % 4]
  if (action >= 76 && action <= 91) return hgssPlayerDirections[action % 4]
  if (action === 92 || action === 94) return 'west'
  if (action === 93 || action === 95) return 'east'
  if (action >= 96 && action <= 99) return hgssPlayerDirections[action % 4]
  return undefined
}

function movementTileDistance(action: number): number {
  if (action >= 52 && action <= 55) return 1
  if (action >= 56 && action <= 59) return 2
  if (action === 92 || action === 93) return 1
  if (action === 94 || action === 95) return 2
  return 0
}

export function createFieldMovementAction(action: number, repetitions = 1): FieldMovementAction {
  if (!Number.isInteger(action) || action < 0 || action >= 254) throw new Error(`La commande de mouvement HGSS ${action} est invalide.`)
  if (!Number.isInteger(repetitions) || repetitions < 0 || repetitions > 0xffff) throw new Error(`Le nombre de répétitions HGSS ${repetitions} est invalide.`)
  return { action, repetitions, direction: movementDirection(action), tileDistance: movementTileDistance(action), kind: classifyMovement(action) }
}

export function decodeFieldMovement(bytes: Uint8Array, offset: number): FieldMovementAction[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const actions: FieldMovementAction[] = []
  let cursor = offset
  for (let count = 0; count < 256; count += 1) {
    if (cursor < 0 || cursor + 4 > bytes.byteLength) {
      throw new Error(`Le mouvement HGSS est tronque a l’offset ${cursor}.`)
    }
    const action = view.getUint16(cursor, true)
    const repetitions = view.getUint16(cursor + 2, true)
    cursor += 4
    if (action === 254) return actions
    actions.push(createFieldMovementAction(action, repetitions))
  }
  throw new Error(`Le mouvement HGSS a l’offset ${offset} ne contient pas de terminateur.`)
}
