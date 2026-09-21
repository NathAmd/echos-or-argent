import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import { getMapOrigin, usesWorldMatrixCoordinates } from './mapCoordinates'
import { createWorldSession, type WorldSession, type WorldState } from './worldSession'

export type ReachableWorldMapTile = Readonly<{
  tileX: number
  tileZ: number
}>

export type WorldMapEntryReachability = Readonly<{
  mapId: number
  entryTiles: readonly ReachableWorldMapTile[]
  reachableTiles: readonly ReachableWorldMapTile[]
  isReachable: (tileX: number, tileZ: number) => boolean
}>

type TraversalState = Pick<WorldState, 'tileX' | 'tileZ' | 'locomotion' | 'groundHeight'>

const movements: ReadonlyArray<Readonly<{
  deltaX: number
  deltaZ: number
  direction: PlayerDirection
}>> = Object.freeze([
  Object.freeze({ deltaX: 0, deltaZ: -1, direction: 'north' }),
  Object.freeze({ deltaX: 0, deltaZ: 1, direction: 'south' }),
  Object.freeze({ deltaX: -1, deltaZ: 0, direction: 'west' }),
  Object.freeze({ deltaX: 1, deltaZ: 0, direction: 'east' }),
])

function tileKey(tileX: number, tileZ: number): string {
  return `${tileX}:${tileZ}`
}

function stateKey(state: TraversalState): string {
  const height = state.groundHeight === undefined ? '-' : state.groundHeight.toFixed(4)
  return `${tileKey(state.tileX, state.tileZ)}:${state.locomotion}:${height}`
}

function isInsideTerrain(map: OpeningMapPreview, tileX: number, tileZ: number): boolean {
  return Boolean(map.terrain)
    && tileX >= 0
    && tileZ >= 0
    && tileX < map.terrain!.width
    && tileZ < map.terrain!.height
}

function asTraversalState(state: WorldState): TraversalState {
  return Object.freeze({
    tileX: state.tileX,
    tileZ: state.tileZ,
    locomotion: state.locomotion,
    groundHeight: state.groundHeight,
  })
}

/**
 * Rejoue les arrivées déclarées par la ROM au lieu de supposer que la case du
 * WarpEvent est elle-même le point de départ. Les portes HGSS décalent par
 * exemple l'arrivée d'une case vers le sud.
 */
function collectWarpEntries(
  maps: readonly OpeningMapPreview[],
  map: OpeningMapPreview,
): TraversalState[] {
  const session = createWorldSession([...maps])
  const entries: TraversalState[] = []
  for (const anchor of (map.events?.warps ?? []).keys()) {
    session.loadMap(map.id, 0, 0)
    const transition = session.transitionTo(map.id, anchor)
    if (transition.kind === 'transitioned'
      && transition.state.map.id === map.id
      && isInsideTerrain(map, transition.state.tileX, transition.state.tileZ)) {
      entries.push(asTraversalState(transition.state))
    }
  }
  return entries
}

/** Les routes extérieures peuvent être rejointes par une matrice sans warp. */
function collectMatrixEntries(
  maps: readonly OpeningMapPreview[],
  map: OpeningMapPreview,
): TraversalState[] {
  const terrain = map.terrain
  if (!terrain || !usesWorldMatrixCoordinates(map)) return []
  const mapsById = new Map(maps.map((candidate) => [candidate.id, candidate]))
  const origin = getMapOrigin(map)
  const session = createWorldSession([...maps])
  const entries: TraversalState[] = []
  const boundaries: Array<Readonly<{
    targetX: number
    targetZ: number
    sourceWorldX: number
    sourceWorldZ: number
    direction: PlayerDirection
    deltaX: number
    deltaZ: number
  }>> = []
  for (let tileX = 0; tileX < terrain.width; tileX += 1) {
    boundaries.push(
      { targetX: tileX, targetZ: 0, sourceWorldX: origin.x + tileX, sourceWorldZ: origin.z - 1, direction: 'south', deltaX: 0, deltaZ: 1 },
      { targetX: tileX, targetZ: terrain.height - 1, sourceWorldX: origin.x + tileX, sourceWorldZ: origin.z + terrain.height, direction: 'north', deltaX: 0, deltaZ: -1 },
    )
  }
  for (let tileZ = 0; tileZ < terrain.height; tileZ += 1) {
    boundaries.push(
      { targetX: 0, targetZ: tileZ, sourceWorldX: origin.x - 1, sourceWorldZ: origin.z + tileZ, direction: 'east', deltaX: 1, deltaZ: 0 },
      { targetX: terrain.width - 1, targetZ: tileZ, sourceWorldX: origin.x + terrain.width, sourceWorldZ: origin.z + tileZ, direction: 'west', deltaX: -1, deltaZ: 0 },
    )
  }
  for (const boundary of boundaries) {
    const cellX = Math.floor(boundary.sourceWorldX / 32)
    const cellZ = Math.floor(boundary.sourceWorldZ / 32)
    if (cellX < 0 || cellX >= map.matrix.width || cellZ < 0 || cellZ >= map.matrix.height) continue
    const sourceMap = mapsById.get(map.matrix.headers[cellZ * map.matrix.width + cellX]!)
    if (!sourceMap || sourceMap.id === map.id || sourceMap.matrix.matrixIndex !== map.matrix.matrixIndex) continue
    const sourceOrigin = getMapOrigin(sourceMap)
    session.loadMap(
      sourceMap.id,
      boundary.sourceWorldX - sourceOrigin.x,
      boundary.sourceWorldZ - sourceOrigin.z,
      boundary.direction,
    )
    const result = session.tryMove(boundary.deltaX, boundary.deltaZ, boundary.direction)
    if (result?.kind === 'moved'
      && result.state.map.id === map.id
      && result.state.tileX === boundary.targetX
      && result.state.tileZ === boundary.targetZ) {
      entries.push(asTraversalState(result.state))
    }
  }
  return entries
}

function traverseMovement(
  session: WorldSession,
  map: OpeningMapPreview,
  state: TraversalState,
  movement: typeof movements[number],
  startSurfing: boolean,
): TraversalState | undefined {
  session.loadMap(
    map.id,
    state.tileX,
    state.tileZ,
    movement.direction,
    startSurfing ? 'surfing' : state.locomotion,
    state.groundHeight,
  )
  let result = session.tryMove(movement.deltaX, movement.deltaZ, movement.direction)
  const forcedStates = new Set<string>()
  while (result?.kind === 'moved' && result.state.map.id === map.id) {
    if (result.coordinate || result.warp?.kind === 'warp' && result.warpActivation?.trigger === 'completed-step') return undefined
    if (!result.continuationDirection) return asTraversalState(result.state)
    const continuationDirection = result.continuationDirection
    const forcedKey = `${stateKey(result.state)}:${continuationDirection}`
    if (forcedStates.has(forcedKey)) return undefined
    forcedStates.add(forcedKey)
    const forced = movements.find(({ direction }) => direction === continuationDirection)!
    result = session.tryMove(forced.deltaX, forced.deltaZ, forced.direction, { forced: true })
    if (result?.kind === 'blocked') {
      const stopped = session.getState()
      return stopped?.map.id === map.id ? asTraversalState(stopped) : undefined
    }
  }
  return undefined
}

/**
 * Calcule les cases où le joueur peut réellement s'arrêter en partant d'une
 * arrivée/connexion ROM. Tous les arcs passent par `WorldSession`, donc les
 * collisions, hauteurs, PNJ, rebords et mouvements forcés restent ceux du jeu.
 * Le second essai en surf représente l'accès obtenu une fois Surf débloqué.
 */
export function createWorldMapEntryReachability(
  maps: readonly OpeningMapPreview[],
  mapId: number,
): WorldMapEntryReachability {
  const map = maps.find((candidate) => candidate.id === mapId)
  if (!map?.terrain) throw new Error(`La carte ${mapId} ne peut pas être auditée pour son accessibilité.`)
  const rawEntries = [...collectWarpEntries(maps, map), ...collectMatrixEntries(maps, map)]
  const traversalSession = createWorldSession([...maps])
  const queue: TraversalState[] = []
  const visitedStates = new Set<string>()
  const entryKeys = new Set<string>()
  const reachableKeys = new Set<string>()
  const enqueue = (state: TraversalState, entry = false): void => {
    if (!isInsideTerrain(map, state.tileX, state.tileZ)) return
    const key = stateKey(state)
    if (!visitedStates.has(key)) {
      visitedStates.add(key)
      queue.push(state)
    }
    const positionKey = tileKey(state.tileX, state.tileZ)
    reachableKeys.add(positionKey)
    if (entry) entryKeys.add(positionKey)
  }
  rawEntries.forEach((entry) => enqueue(entry, true))
  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index]!
    for (const movement of movements) {
      const walking = traverseMovement(traversalSession, map, state, movement, false)
      if (walking) enqueue(walking)
      if (state.locomotion === 'walking') {
        const surfing = traverseMovement(traversalSession, map, state, movement, true)
        if (surfing) enqueue(surfing)
      }
    }
  }
  const toTiles = (keys: ReadonlySet<string>): readonly ReachableWorldMapTile[] => Object.freeze(
    [...keys].map((key) => {
      const [tileX, tileZ] = key.split(':').map(Number)
      return Object.freeze({ tileX: tileX!, tileZ: tileZ! })
    }).sort((left, right) => left.tileZ - right.tileZ || left.tileX - right.tileX),
  )
  const entryTiles = toTiles(entryKeys)
  const reachableTiles = toTiles(reachableKeys)
  return Object.freeze({
    mapId,
    entryTiles,
    reachableTiles,
    isReachable: (tileX: number, tileZ: number) => reachableKeys.has(tileKey(tileX, tileZ)),
  })
}
