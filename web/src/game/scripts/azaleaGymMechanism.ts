import type { PlayerDirection } from '../../ndsTypes'

export type AzaleaGymRouteNode = Readonly<{ x: number, z: number }>

export type AzaleaGymRide = {
  sourceNode: number
  destinationNode: number
  spiderIndex: number
  switchState: number
  direction: Extract<PlayerDirection, 'north' | 'south'>
  route: readonly AzaleaGymRouteNode[]
  destination: { x: number, z: number, direction: PlayerDirection }
  followerDestination: { x: number, z: number, direction: PlayerDirection }
}

export const azaleaGymInitialSpiderNodes = [0, 1, 2, 7] as const

export const azaleaGymNodePositions: readonly AzaleaGymRouteNode[] = [
  { x: 3, z: 31 }, { x: 9, z: 31 }, { x: 15, z: 31 },
  { x: 3, z: 24 }, { x: 9, z: 24 }, { x: 15, z: 24 },
  { x: 3, z: 16 }, { x: 9, z: 16 }, { x: 15, z: 16 },
  { x: 3, z: 9 }, { x: 9, z: 9 }, { x: 15, z: 9 },
]

// Tables sSpinarakRoute_* de l'overlay 04. Les points intermédiaires sont
// indispensables : le chariot, le joueur, le follower et la caméra suivent
// ces diagonales dans la ROM au lieu de sauter directement à l'arrivée.
const route1to5 = [[3, 31], [3, 29], [9, 29], [9, 27], [15, 28], [15, 25], [9, 25], [9, 24]] as const
const route2to6 = [[9, 31], [9, 29], [3, 29], [3, 27], [9, 26], [9, 25], [15, 25], [15, 24]] as const
const route3to4 = [[15, 31], [15, 28], [9, 27], [9, 26], [3, 27], [3, 24]] as const
const route7to10 = [[3, 16], [3, 12], [9, 13], [9, 10], [3, 10], [3, 9]] as const
const route7to11 = [[3, 16], [3, 12], [9, 13], [9, 9]] as const
const route8to10 = [[9, 16], [9, 14], [15, 14], [15, 11], [9, 12], [9, 10], [3, 10], [3, 9]] as const
const route8to12 = [[9, 16], [9, 14], [15, 14], [15, 9]] as const
const route8to11 = [[9, 16], [9, 14], [15, 14], [15, 11], [9, 12], [9, 9]] as const

type RouteDefinition = { destination: number, nodes: readonly (readonly [number, number])[], reverse?: boolean }
const repeated = (definition: RouteDefinition): readonly RouteDefinition[] => [definition, definition, definition, definition]
const routeDefinitions: readonly (readonly (RouteDefinition | undefined)[])[] = [
  repeated({ destination: 4, nodes: route1to5 }),
  repeated({ destination: 5, nodes: route2to6 }),
  repeated({ destination: 3, nodes: route3to4 }),
  repeated({ destination: 2, nodes: route3to4, reverse: true }),
  repeated({ destination: 0, nodes: route1to5, reverse: true }),
  repeated({ destination: 1, nodes: route2to6, reverse: true }),
  [undefined, { destination: 9, nodes: route7to10 }, undefined, { destination: 10, nodes: route7to11 }],
  [
    { destination: 9, nodes: route8to10 },
    { destination: 11, nodes: route8to12 },
    { destination: 10, nodes: route8to11 },
    { destination: 11, nodes: route8to12 },
  ],
  [undefined, undefined, undefined, undefined],
  [{ destination: 7, nodes: route8to10, reverse: true }, { destination: 6, nodes: route7to10, reverse: true }, undefined, undefined],
  [undefined, undefined, { destination: 7, nodes: route8to11, reverse: true }, { destination: 6, nodes: route7to11, reverse: true }],
  [undefined, { destination: 7, nodes: route8to12, reverse: true }, undefined, { destination: 7, nodes: route8to12, reverse: true }],
]

function requireAzaleaData(data: Uint8Array): DataView {
  if (data.byteLength < 8) throw new Error("L'état ROM de l'Arène d'Écorcia est tronqué.")
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
}

export function initializeAzaleaGymData(data: Uint8Array): void {
  requireAzaleaData(data)
  data.fill(0)
  data.set(azaleaGymInitialSpiderNodes)
}

export function getAzaleaGymSwitchState(data: Uint8Array): number {
  return requireAzaleaData(data).getUint32(4, true) & 3
}

export function getAzaleaGymSpiderNodes(data: Uint8Array): number[] {
  requireAzaleaData(data)
  return [...data.subarray(0, 4)]
}

/**
 * Répare uniquement un ancien bloc web impossible à produire par Save_Gymmick.
 * Un état natif valide est conservé tel quel, y compris au milieu du puzzle.
 */
export function repairAzaleaGymData(data: Uint8Array): boolean {
  const view = requireAzaleaData(data)
  const nodes = getAzaleaGymSpiderNodes(data)
  const validNodes = nodes.every((node) => node >= 0 && node < azaleaGymNodePositions.length)
    && new Set(nodes).size === nodes.length
  const validSwitches = (view.getUint32(4, true) & ~3) === 0
  if (validNodes && validSwitches) return false
  initializeAzaleaGymData(data)
  return true
}

export function flipAzaleaGymSwitch(data: Uint8Array, switchNumber: number): number {
  if (switchNumber !== 0 && switchNumber !== 1) throw new Error(`AzaleaGymSwitch HGSS invalide (${switchNumber}).`)
  const view = requireAzaleaData(data)
  const state = (view.getUint32(4, true) ^ (1 << switchNumber)) & 3
  view.setUint32(4, state, true)
  return state
}

export function beginAzaleaGymRide(data: Uint8Array, sourceNode: number): AzaleaGymRide | undefined {
  if (!Number.isInteger(sourceNode) || sourceNode < 0 || sourceNode >= routeDefinitions.length) {
    throw new Error(`AzaleaGymSpinarak HGSS invalide (${sourceNode}).`)
  }
  const spiderIndex = getAzaleaGymSpiderNodes(data).findIndex((node) => node === sourceNode)
  if (spiderIndex < 0) return undefined
  const switchState = getAzaleaGymSwitchState(data)
  const definition = routeDefinitions[sourceNode]?.[switchState]
  // La géométrie animée de la ROM rend ces entrées nulles inaccessibles. Une
  // collision web imprécise ne doit toutefois jamais bloquer le script.
  if (!definition) return undefined
  const direction = definition.reverse ? 'south' : 'north'
  const route = definition.nodes.map(([x, z]) => ({ x, z }))
  if (definition.reverse) route.reverse()
  const cartDestination = azaleaGymNodePositions[definition.destination]
  if (!cartDestination) throw new Error(`Destination Spinarak HGSS ${definition.destination} absente.`)
  data[spiderIndex] = definition.destination
  // Après le trajet, le moteur DS replace les deux MapObjects de part et
  // d'autre du chariot puis joue un dernier pas de descente.
  const playerZ = cartDestination.z + (definition.reverse ? 2 : -1)
  const followerZ = cartDestination.z + (definition.reverse ? 1 : 0)
  return {
    sourceNode,
    destinationNode: definition.destination,
    spiderIndex,
    switchState,
    direction,
    route,
    destination: { x: cartDestination.x, z: playerZ, direction },
    followerDestination: { x: cartDestination.x, z: followerZ, direction },
  }
}
