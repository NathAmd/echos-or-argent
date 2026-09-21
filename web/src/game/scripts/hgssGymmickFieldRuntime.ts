import type { PlayerDirection } from '../../ndsTypes'
import {
  beginAzaleaGymRide,
  flipAzaleaGymSwitch,
  getAzaleaGymSpiderNodes,
  getAzaleaGymSwitchState,
  initializeAzaleaGymData,
  type AzaleaGymRide,
} from './azaleaGymMechanism'

/** Discriminant exact de Save_Gymmick dans HGSS. */
export type HgssGymmickType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Miroir du type natif suivi de son union brute de 0x20 octets. */
export type HgssGymmickState = {
  type: HgssGymmickType
  data: Uint8Array
}

export type HgssGymmickFieldStep = {
  kind: 'gymMechanism'
  gymType: HgssGymmickType
  action: string
  parameter?: number
  destination?: { x: number, z: number, direction: PlayerDirection }
  followerDestination?: { x: number, z: number, direction: PlayerDirection }
  ride?: AzaleaGymRide
  spiderNodes?: number[]
  switchState?: number
}

export type HgssGymmickCommandState = {
  gymmick: HgssGymmickState
  variables: Map<number, number>
  badges: ReadonlySet<number>
  player: { x: number, z: number, direction: PlayerDirection, groundHeight?: number }
}

export type HgssGymmickCommandDependencies = {
  readVariable: (variableId: number) => number
  nextRandomU16: () => number
}

export type HgssGymmickCommandResult = {
  cursor: number
  step?: HgssGymmickFieldStep
}

const vermilionTrashCanNeighbors: readonly (readonly number[])[] = [
  [1, 5], [0, 2, 6], [1, 3, 7], [2, 4, 8], [3, 9],
  [0, 6, 10], [1, 5, 7, 11], [2, 6, 8, 12], [3, 7, 9, 13], [4, 8, 14],
  [5, 11], [6, 10, 12], [7, 11, 13], [8, 12, 14], [9, 13],
]

export function createHgssGymmickState(type: HgssGymmickType = 0): HgssGymmickState {
  return { type, data: new Uint8Array(0x20) }
}

export function initializeHgssGymmickState(
  state: Pick<HgssGymmickCommandState, 'gymmick'>,
  type: HgssGymmickType,
): void {
  state.gymmick = createHgssGymmickState(type)
}

function requireCommandBytes(bytes: Uint8Array, cursor: number, size: number, opcode: number): void {
  if (cursor < 0 || cursor + size > bytes.byteLength) {
    throw new Error(`La commande script ${opcode} est tronquee a l’offset ${cursor}.`)
  }
}

function placeVermilionGymSwitches(
  state: Pick<HgssGymmickCommandState, 'gymmick'>,
  nextRandomU16: () => number,
): void {
  const first = nextRandomU16() % vermilionTrashCanNeighbors.length
  const neighbors = vermilionTrashCanNeighbors[first]!
  state.gymmick.data[0] = first
  state.gymmick.data[1] = neighbors[nextRandomU16() % neighbors.length]!
}

function ensureVermilionGymState(
  state: HgssGymmickCommandState,
  nextRandomU16: () => number,
): void {
  if (state.gymmick.type === 3) return
  initializeHgssGymmickState(state, 3)
  placeVermilionGymSwitches(state, nextRandomU16)
}

function ensureAzaleaGymState(state: HgssGymmickCommandState): void {
  if (state.gymmick.type === 5) return
  initializeHgssGymmickState(state, 5)
  initializeAzaleaGymData(state.gymmick.data)
}

/**
 * Decode et applique exclusivement les ScrCmd 314..331 qui pilotent
 * Save_Gymmick. Le curseur rendu pointe juste apres les operandes consommees.
 */
export function runHgssGymmickFieldCommand(
  opcode: number,
  state: HgssGymmickCommandState,
  bytes: Uint8Array,
  cursor: number,
  dependencies: HgssGymmickCommandDependencies,
): HgssGymmickCommandResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (opcode) {
    case 314:
      initializeHgssGymmickState(state, 1)
      return { cursor, step: { kind: 'gymMechanism', gymType: 1, action: 'init' } }
    case 315:
      return state.gymmick.type === 1
        ? {
            cursor,
            step: { kind: 'gymMechanism', gymType: 1, action: 'trackCandle', parameter: dependencies.readVariable(0x800d) },
          }
        : { cursor }
    case 316:
      return state.gymmick.type === 1
        ? { cursor, step: { kind: 'gymMechanism', gymType: 1, action: 'stopCandleTracking' } }
        : { cursor }
    case 317: {
      requireCommandBytes(bytes, cursor, 1, opcode)
      // L'octet indique la provenance de l'interaction (directe ou repérage
      // du Dresseur), pas l'état lumineux demandé. Les deux chemins natifs
      // éteignent la chandelle suivie.
      cursor += 1
      if (state.gymmick.type !== 1) {
        return { cursor, step: { kind: 'gymMechanism', gymType: 1, action: 'ignored' } }
      }
      const objectId = dependencies.readVariable(0x800d)
      if (objectId >= 2 && objectId <= 5) state.gymmick.data[objectId - 2] = 1
      return {
        cursor,
        step: { kind: 'gymMechanism', gymType: 1, action: 'extinguishCandle', parameter: objectId },
      }
    }
    case 318:
      initializeHgssGymmickState(state, 2)
      return { cursor, step: { kind: 'gymMechanism', gymType: 2, action: 'init' } }
    case 319: {
      requireCommandBytes(bytes, cursor, 2, opcode)
      const destination = view.getUint16(cursor, true)
      cursor += 2
      const canTurn = state.gymmick.type === 2
        && new DataView(state.gymmick.data.buffer).getUint32(0, true) === 0
      state.variables.set(destination, canTurn ? 1 : 0)
      if (canTurn) new DataView(state.gymmick.data.buffer).setUint32(0, 1, true)
      return {
        cursor,
        step: { kind: 'gymMechanism', gymType: 2, action: canTurn ? 'turnWinch' : 'ignored' },
      }
    }
    case 320:
      initializeHgssGymmickState(state, 3)
      if (state.badges.has(10)) state.gymmick.data.set([0, 0, 1, 1])
      else placeVermilionGymSwitches(state, dependencies.nextRandomU16)
      return { cursor, step: { kind: 'gymMechanism', gymType: 3, action: 'init' } }
    case 321: {
      requireCommandBytes(bytes, cursor, 2, opcode)
      const lockNumber = bytes[cursor]!
      const relock = bytes[cursor + 1]!
      cursor += 2
      if (lockNumber > 1 || (lockNumber === 1 && relock !== 0)) {
        throw new Error(`VermilionGymLockAction HGSS invalide (${lockNumber}, ${relock}).`)
      }
      ensureVermilionGymState(state, dependencies.nextRandomU16)
      if (lockNumber === 0) state.gymmick.data[2] = relock === 0 ? 1 : 0
      else state.gymmick.data[3] = 1
      return {
        cursor,
        step: { kind: 'gymMechanism', gymType: 3, action: relock ? 'closeGate' : 'openGate', parameter: lockNumber },
      }
    }
    case 322: {
      requireCommandBytes(bytes, cursor, 3, opcode)
      const canId = bytes[cursor]!
      const destination = view.getUint16(cursor + 1, true)
      cursor += 3
      // Un endpoint audite isolement peut ne pas avoir execute l'init de carte.
      ensureVermilionGymState(state, dependencies.nextRandomU16)
      const firstGate = state.gymmick.data[2]!
      const secondGate = state.gymmick.data[3]!
      const result = firstGate !== 0 && secondGate !== 0
        ? 4
        : firstGate !== 0
          ? canId === state.gymmick.data[1] ? 2 : 3
          : canId === state.gymmick.data[0] ? 1 : 0
      state.variables.set(destination, result)
      return { cursor }
    }
    case 323:
      if (state.gymmick.type !== 3) initializeHgssGymmickState(state, 3)
      placeVermilionGymSwitches(state, dependencies.nextRandomU16)
      return { cursor }
    case 324:
      initializeHgssGymmickState(state, 4)
      return { cursor, step: { kind: 'gymMechanism', gymType: 4, action: 'init' } }
    case 325: {
      if (state.gymmick.type !== 4) initializeHgssGymmickState(state, 4)
      const data = new DataView(state.gymmick.data.buffer)
      const raised = data.getUint32(0, true) === 0
      data.setUint32(0, raised ? 1 : 0, true)
      return {
        cursor,
        step: { kind: 'gymMechanism', gymType: 4, action: raised ? 'raiseElevator' : 'lowerElevator' },
      }
    }
    case 326:
      initializeHgssGymmickState(state, 5)
      initializeAzaleaGymData(state.gymmick.data)
      return {
        cursor,
        step: {
          kind: 'gymMechanism',
          gymType: 5,
          action: 'init',
          spiderNodes: getAzaleaGymSpiderNodes(state.gymmick.data),
          switchState: getAzaleaGymSwitchState(state.gymmick.data),
        },
      }
    case 327: {
      requireCommandBytes(bytes, cursor, 1, opcode)
      const spinarak = bytes[cursor++]!
      if (spinarak > 11) throw new Error(`AzaleaGymSpinarak HGSS invalide (${spinarak}).`)
      ensureAzaleaGymState(state)
      const ride = beginAzaleaGymRide(state.gymmick.data, spinarak)
      if (ride) {
        state.player = {
          x: ride.destination.x,
          z: ride.destination.z,
          direction: ride.destination.direction,
        }
      }
      return {
        cursor,
        step: {
          kind: 'gymMechanism',
          gymType: 5,
          action: ride ? 'rideSpinarak' : 'emptySpinarakNode',
          parameter: spinarak,
          ...(ride ? {
            destination: ride.destination,
            followerDestination: ride.followerDestination,
            ride,
            spiderNodes: getAzaleaGymSpiderNodes(state.gymmick.data),
            switchState: getAzaleaGymSwitchState(state.gymmick.data),
          } : {}),
        },
      }
    }
    case 328: {
      requireCommandBytes(bytes, cursor, 1, opcode)
      const switchNumber = bytes[cursor++]!
      if (switchNumber > 1) throw new Error(`AzaleaGymSwitch HGSS invalide (${switchNumber}).`)
      ensureAzaleaGymState(state)
      const switchState = flipAzaleaGymSwitch(state.gymmick.data, switchNumber)
      return {
        cursor,
        step: {
          kind: 'gymMechanism',
          gymType: 5,
          action: 'flipSwitch',
          parameter: switchNumber,
          spiderNodes: getAzaleaGymSpiderNodes(state.gymmick.data),
          switchState,
        },
      }
    }
    case 329: {
      initializeHgssGymmickState(state, 6)
      const data = new DataView(state.gymmick.data.buffer)
      for (const [index, [x, z, rotation]] of [[13, 75, 0], [9, 58, 1], [14, 32, 0]].entries()) {
        data.setUint16(index * 2, x!, true)
        data.setUint16(6 + index * 2, z!, true)
        state.gymmick.data[12 + index] = rotation!
      }
      return { cursor, step: { kind: 'gymMechanism', gymType: 6, action: 'init' } }
    }
    case 330:
      initializeHgssGymmickState(state, 7)
      return { cursor, step: { kind: 'gymMechanism', gymType: 7, action: 'init' } }
    case 331:
      initializeHgssGymmickState(state, 8)
      return { cursor, step: { kind: 'gymMechanism', gymType: 8, action: 'init' } }
    default:
      throw new Error(`Opcode Gymmick HGSS ${opcode} non pris en charge.`)
  }
}
