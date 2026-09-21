import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import { beginAzaleaGymRide } from '../scripts/azaleaGymMechanism'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { getMapGroundHeights, getMapOrigin } from '../world/mapCoordinates'
import { createWorldSession } from '../world/worldSession'
import type { FieldInput } from './fieldInputSimulator'

export type JohtoJourneyPosition = {
  mapId: number
  tileX: number
  tileZ: number
  direction: PlayerDirection
  groundHeight?: number
}

export type JohtoJourneyMapTransition = {
  kind: 'warp' | 'adjacent-map'
  targetMapId: number
}

export type JohtoJourneyTarget = {
  id: string
  label: string
  routeStartMapId: number
  route: readonly JohtoJourneyMapTransition[]
  destinationMapId: number
  leader: { spriteId: number, scriptId: number }
  badgeIndex: number
  /** Identité du combat que l'audit doit avoir réellement gagné. */
  trainerId: number
}

export type JohtoJourneyMilestone = {
  id: string
  label: string
  reached: boolean
}

export type JohtoJourneyPlanner = {
  target: JohtoJourneyTarget
  getMilestone: (state: FieldScriptState) => JohtoJourneyMilestone
  planInputs: (position: JohtoJourneyPosition, state: FieldScriptState) => FieldInput[] | undefined
}

/**
 * Stable ROM facts for the first-badge headless gate. The route starts after
 * the Mystery Egg has been returned to Elm, which is the last mandatory story
 * event before the journey can head directly to Violet Gym.
 */
export const ZEPHYR_BADGE_TARGET = {
  id: 'zephyr-badge',
  label: 'Battre Albert et recevoir le Badge Zéphyr',
  routeStartMapId: 61,
  route: [
    { kind: 'warp', targetMapId: 60 },
    { kind: 'adjacent-map', targetMapId: 33 },
    { kind: 'adjacent-map', targetMapId: 67 },
    { kind: 'adjacent-map', targetMapId: 34 },
    { kind: 'adjacent-map', targetMapId: 35 },
    { kind: 'warp', targetMapId: 97 },
    { kind: 'warp', targetMapId: 73 },
    { kind: 'warp', targetMapId: 135 },
  ],
  destinationMapId: 135,
  leader: { spriteId: 352, scriptId: 2 },
  badgeIndex: 0,
  trainerId: 20,
} as const satisfies JohtoJourneyTarget

export function isJohtoJourneyTargetReached(
  state: FieldScriptState,
  target: JohtoJourneyTarget,
): boolean {
  // Le script ROM d'Albert ne pose pas son TrainerFlag 20 : il attribue le
  // badge puis marque seulement les deux élèves (29/50). La preuve stricte du
  // combat 20 appartient donc à l'audit de bataille, pas à l'état planifiable.
  return state.badges.has(target.badgeIndex)
}

const directions: { input: Exclude<FieldInput, 'confirm'>, x: number, z: number, direction: PlayerDirection }[] = [
  { input: 'up', x: 0, z: -1, direction: 'north' },
  { input: 'down', x: 0, z: 1, direction: 'south' },
  { input: 'left', x: -1, z: 0, direction: 'west' },
  { input: 'right', x: 1, z: 0, direction: 'east' },
]

function findMap(maps: OpeningMapPreview[], mapId: number): OpeningMapPreview {
  const map = maps.find((candidate) => candidate.id === mapId)
  if (!map) throw new Error(`La carte ${mapId} est absente du catalogue ROM.`)
  return map
}

function createPlanner(
  maps: OpeningMapPreview[],
  state: FieldScriptState,
  position: JohtoJourneyPosition,
): ReturnType<typeof createWorldSession> {
  const planner = createWorldSession(
    maps,
    new Set(state.flags),
    new Set(state.hiddenObjectIds),
    new Map(state.variables),
    undefined,
    new Set(state.trainerFlags),
    () => state.dynamicWarp,
  )
  planner.loadMap(position.mapId, position.tileX, position.tileZ, position.direction, 'walking', position.groundHeight)
  for (const [objectId, object] of state.objects) {
    planner.setObjectState(objectId, object.x, object.z, object.direction)
  }
  return planner
}

/**
 * Plans ordinary field inputs to one exact local tile without crossing a warp.
 * Story agents use it when the side from which an object is approached is part
 * of the native puzzle, such as the two Farfetch'd in Ilex Forest.
 */
export function findInputsToTile(
  maps: OpeningMapPreview[],
  start: JohtoJourneyPosition,
  target: Readonly<{ tileX: number, tileZ: number }>,
  state: FieldScriptState,
  options: Readonly<{ avoidCoordinateScriptIds?: ReadonlySet<number> }> = {},
): FieldInput[] {
  const sourceMap = findMap(maps, start.mapId)
  if (start.tileX === target.tileX && start.tileZ === target.tileZ) return []
  type Node = typeof start & { inputs: FieldInput[] }
  const queue: Node[] = [{ ...start, inputs: [] }]
  const visited = new Set<string>([`${start.tileX}:${start.tileZ}:${start.groundHeight ?? 'none'}`])
  for (let cursor = 0; cursor < queue.length && cursor < 4096; cursor += 1) {
    const node = queue[cursor]!
    for (const movement of directions) {
      const planner = createPlanner([sourceMap], state, node)
      const result = planner.tryMove(movement.x, movement.z, movement.direction)
      if (!result || result.kind === 'blocked' || result.warp || result.state.map.id !== start.mapId) continue
      if (result.coordinate && options.avoidCoordinateScriptIds?.has(result.coordinate.scriptId)) continue
      const inputs = [...node.inputs, movement.input]
      if (result.state.tileX === target.tileX && result.state.tileZ === target.tileZ) return inputs
      const key = `${result.state.tileX}:${result.state.tileZ}:${result.state.groundHeight ?? 'none'}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({
        mapId: start.mapId,
        tileX: result.state.tileX,
        tileZ: result.state.tileZ,
        direction: movement.direction,
        groundHeight: result.state.groundHeight,
        inputs,
      })
    }
  }
  throw new Error(`Aucun chemin d'inputs ROM vers la case ${target.tileX},${target.tileZ} de la carte ${start.mapId}.`)
}

export function findInputsToWarp(
  maps: OpeningMapPreview[],
  start: JohtoJourneyPosition,
  targetMapId: number,
  state: FieldScriptState,
): FieldInput[] {
  const sourceMap = findMap(maps, start.mapId)
  type Node = typeof start & { inputs: FieldInput[] }
  const queue: Node[] = [{ ...start, inputs: [] }]
  const visited = new Set<string>([`${start.mapId}:${start.tileX}:${start.tileZ}:${start.groundHeight ?? 'none'}`])
  for (let cursor = 0; cursor < queue.length && cursor < 4096; cursor += 1) {
    const node = queue[cursor]!
    for (const movement of directions) {
      const planner = createPlanner([sourceMap], state, node)
      planner.setDirection(movement.direction)
      const result = planner.tryMove(movement.x, movement.z, movement.direction)
      if (!result || result.kind === 'blocked') continue
      const inputs = [...node.inputs, movement.input]
      if (result.warp?.header === targetMapId) return inputs
      if (result.warp) continue
      if (result.state.map.id !== node.mapId) continue
      const key = `${node.mapId}:${result.state.tileX}:${result.state.tileZ}:${result.state.groundHeight ?? 'none'}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({ mapId: node.mapId, tileX: result.state.tileX, tileZ: result.state.tileZ, direction: movement.direction, groundHeight: result.state.groundHeight, inputs })
    }
  }
  const targetWarps = sourceMap.events?.warps.filter((warp) => warp.header === targetMapId) ?? []
  const origin = getMapOrigin(sourceMap)
  const nearby = targetWarps.flatMap((warp) => [
    `${start.mapId}:${warp.x}:${warp.z}`,
    `${start.mapId}:${warp.x - 1}:${warp.z}`,
    `${start.mapId}:${warp.x + 1}:${warp.z}`,
    `${start.mapId}:${warp.x}:${warp.z - 1}`,
    `${start.mapId}:${warp.x}:${warp.z + 1}`,
  ].map((position) => {
    const [, xText, zText] = position.split(':')
    const localX = Number(xText) - origin.x
    const localZ = Number(zText) - origin.z
    const attribute = sourceMap.terrain && localX >= 0 && localX < sourceMap.terrain.width && localZ >= 0 && localZ < sourceMap.terrain.height
      ? sourceMap.terrain.attributes[localZ * sourceMap.terrain.width + localX]
      : undefined
    const transposedAttribute = sourceMap.terrain && localX >= 0 && localX < sourceMap.terrain.width && localZ >= 0 && localZ < sourceMap.terrain.height
      ? sourceMap.terrain.attributes[localX * sourceMap.terrain.width + localZ]
      : undefined
    return { position, localX, localZ, attribute, transposedAttribute, reachable: visited.has(`${start.mapId}:${localX}:${localZ}`) }
  }))
  const doorBehaviors = sourceMap.terrain
    ? Array.from(sourceMap.terrain.attributes.entries())
      .filter(([, attribute]) => (attribute & 0xff) === 105)
      .map(([index, attribute]) => ({ x: index % sourceMap.terrain!.width, z: Math.floor(index / sourceMap.terrain!.width), attribute }))
    : []
  const nearestReachable = targetWarps.flatMap((warp) => Array.from(visited)
    .map((key) => {
      const [, xText, zText] = key.split(':')
      const x = Number(xText)
      const z = Number(zText)
      return { x, z, distance: Math.abs(x - (warp.x - origin.x)) + Math.abs(z - (warp.z - origin.z)) }
    })
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 6))
  throw new Error(`Aucun chemin d'inputs ROM vers la carte ${targetMapId}. Cases atteignables: ${visited.size}. Porte: ${JSON.stringify(nearby)}. Comportements porte: ${JSON.stringify(doorBehaviors)}. Plus proches: ${JSON.stringify(nearestReachable)}.`)
}

export function findInputsToBackground(
  maps: OpeningMapPreview[],
  start: JohtoJourneyPosition,
  scriptId: number,
  state: FieldScriptState,
): FieldInput[] {
  const sourceMap = findMap(maps, start.mapId)
  type Node = typeof start & { inputs: FieldInput[] }
  const queue: Node[] = [{ ...start, inputs: [] }]
  const visited = new Set<string>([`${start.mapId}:${start.tileX}:${start.tileZ}`])
  for (let cursor = 0; cursor < queue.length && cursor < 4096; cursor += 1) {
    const node = queue[cursor]!
    for (const movement of directions) {
      const planner = createPlanner([sourceMap], state, { ...node, direction: movement.direction })
      const interaction = planner.interact()
      if (interaction?.kind === 'background' && interaction.scriptId === scriptId) return [...node.inputs, movement.input, 'confirm']
      const result = planner.tryMove(movement.x, movement.z, movement.direction)
      if (!result || result.kind === 'blocked' || result.warp || result.state.map.id !== node.mapId) continue
      const key = `${node.mapId}:${result.state.tileX}:${result.state.tileZ}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({ mapId: node.mapId, tileX: result.state.tileX, tileZ: result.state.tileZ, direction: movement.direction, groundHeight: result.state.groundHeight, inputs: [...node.inputs, movement.input] })
    }
  }
  throw new Error(`Aucun chemin d'inputs ROM vers le script decor ${scriptId} de la carte ${start.mapId}.`)
}

export function findInputsToNpc(
  maps: OpeningMapPreview[],
  start: JohtoJourneyPosition,
  objectId: number,
  state: FieldScriptState,
): FieldInput[] {
  const sourceMap = findMap(maps, start.mapId)
  type Node = typeof start & { inputs: FieldInput[] }
  const queue: Node[] = [{ ...start, inputs: [] }]
  const visited = new Set<string>([`${start.tileX}:${start.tileZ}`])
  for (let cursor = 0; cursor < queue.length && cursor < 4096; cursor += 1) {
    const node = queue[cursor]!
    for (const movement of directions) {
      const planner = createPlanner([sourceMap], state, { ...node, direction: movement.direction })
      const interaction = planner.interact()
      if (interaction?.kind === 'npc' && interaction.id === objectId) return [...node.inputs, movement.input, 'confirm']
      const result = planner.tryMove(movement.x, movement.z, movement.direction)
      if (!result || result.kind === 'blocked' || result.warp || result.state.map.id !== node.mapId) continue
      const key = `${result.state.tileX}:${result.state.tileZ}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({ mapId: node.mapId, tileX: result.state.tileX, tileZ: result.state.tileZ, direction: movement.direction, groundHeight: result.state.groundHeight, inputs: [...node.inputs, movement.input] })
    }
  }
  throw new Error(`Aucun chemin d'inputs ROM vers le PNJ ${objectId} de la carte ${start.mapId}.`)
}

export function findInputsToProgressEvent(
  maps: OpeningMapPreview[],
  start: JohtoJourneyPosition,
  state: FieldScriptState,
  excluded: ReadonlySet<string>,
  target: { x: number, z: number },
  visitedMechanismStates: ReadonlySet<string>,
): { key: string, inputs: FieldInput[] } {
  const sourceMap = findMap(maps, start.mapId)
  type Node = JohtoJourneyPosition & { inputs: FieldInput[] }
  const queue: Node[] = [{ ...start, inputs: [] }]
  const visited = new Set<string>([`${start.tileX}:${start.tileZ}:${start.groundHeight ?? 'none'}`])
  const candidates: Array<{ key: string, inputs: FieldInput[], priority: number, distance: number }> = []
  const origin = getMapOrigin(sourceMap)
  const currentDistance = Math.abs(origin.x + start.tileX - target.x) + Math.abs(origin.z + start.tileZ - target.z)
  for (let cursor = 0; cursor < queue.length && cursor < 4096; cursor += 1) {
    const node = queue[cursor]!
    for (const movement of directions) {
      const planner = createPlanner([sourceMap], state, { ...node, direction: movement.direction })
      const interaction = planner.interact()
      const worldX = origin.x + node.tileX + movement.x
      const worldZ = origin.z + node.tileZ + movement.z
      const background = interaction?.kind === 'background'
        ? sourceMap.events?.backgrounds.find((event) => event.x === worldX && event.z === worldZ && event.scriptId === interaction.scriptId)
        : undefined
      if (background) {
        const key = `background:${background.x}:${background.z}:${background.scriptId}`
        if (!excluded.has(key)) candidates.push({
          key,
          inputs: [...node.inputs, movement.input, 'confirm'],
          priority: 1,
          distance: Math.abs(background.x - target.x) + Math.abs(background.z - target.z),
        })
      }
      const result = planner.tryMove(movement.x, movement.z, movement.direction)
      if (!result || result.kind === 'blocked' || result.warp || result.state.map.id !== node.mapId) continue
      const inputs = [...node.inputs, movement.input]
      if (result.coordinate) {
        const key = `coordinate:${result.coordinate.x}:${result.coordinate.z}:${result.coordinate.scriptId}`
        const gymData = new Uint8Array(state.gymmick.data)
        const ride = state.gymmick.type === 5 && result.coordinate.scriptId >= 3 && result.coordinate.scriptId <= 14
          ? beginAzaleaGymRide(gymData, result.coordinate.scriptId - 3)
          : undefined
        const destinationDistance = ride
          ? Math.abs(ride.destination.x - target.x) + Math.abs(ride.destination.z - target.z)
          : Number.POSITIVE_INFINITY
        const destinationKey = ride ? [...gymData].join(',') : undefined
        if (!excluded.has(key)) candidates.push({
          key,
          inputs,
          priority: ride && destinationDistance < currentDistance && !visitedMechanismStates.has(destinationKey!) ? 0 : 2,
          distance: Math.abs(result.coordinate.x - target.x) + Math.abs(result.coordinate.z - target.z),
        })
        continue
      }
      const key = `${result.state.tileX}:${result.state.tileZ}:${result.state.groundHeight ?? 'none'}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({ mapId: node.mapId, tileX: result.state.tileX, tileZ: result.state.tileZ, direction: movement.direction, groundHeight: result.state.groundHeight, inputs })
    }
  }
  const selected = candidates.sort((left, right) => left.priority - right.priority || left.distance - right.distance || left.inputs.length - right.inputs.length)[0]
  if (!selected) throw new Error(`Aucun événement ROM de progression n'est accessible: ${JSON.stringify({ start, visited: visited.size, excluded: [...excluded], gymmick: [...state.gymmick.data] })}.`)
  return selected
}

export function findInputsToAdjacentMap(
  maps: OpeningMapPreview[],
  start: JohtoJourneyPosition,
  targetMapId: number,
  state: FieldScriptState,
): FieldInput[] {
  const sourceMap = findMap(maps, start.mapId)
  const targetMap = findMap(maps, targetMapId)
  type Node = typeof start & { inputs: FieldInput[] }
  const queue: Node[] = [{ ...start, inputs: [] }]
  const visited = new Set<string>([`${start.tileX}:${start.tileZ}`])
  for (let cursor = 0; cursor < queue.length && cursor < 4096; cursor += 1) {
    const node = queue[cursor]!
    for (const movement of directions) {
      const planner = createPlanner([sourceMap, targetMap], state, node)
      const result = planner.tryMove(movement.x, movement.z, movement.direction)
      if (!result || result.kind === 'blocked') continue
      if (result.warp) continue
      const inputs = [...node.inputs, movement.input]
      if (result.state.map.id === targetMapId) return inputs
      if (result.state.map.id !== start.mapId) continue
      const key = `${result.state.tileX}:${result.state.tileZ}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({ mapId: start.mapId, tileX: result.state.tileX, tileZ: result.state.tileZ, direction: movement.direction, groundHeight: result.state.groundHeight, inputs })
    }
  }
  const reachable = [...visited].map((key) => {
    const [x, z] = key.split(':').map(Number)
    return { x, z }
  })
  const range = reachable.reduce((current, position) => ({
    minX: Math.min(current.minX, position.x),
    maxX: Math.max(current.maxX, position.x),
    minZ: Math.min(current.minZ, position.z),
    maxZ: Math.max(current.maxZ, position.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity })
  const activeObjects = [...state.objects].filter(([id]) => !state.hiddenObjectIds.has(id)).map(([id, object]) => ({ id, ...object }))
  const frontier = reachable.flatMap((position) => directions.flatMap((movement) => {
    const nextKey = `${position.x + movement.x}:${position.z + movement.z}`
    if (visited.has(nextKey)) return []
    const planner = createPlanner([sourceMap, targetMap], state, { mapId: start.mapId, tileX: position.x, tileZ: position.z, direction: movement.direction })
    const result = planner.tryMove(movement.x, movement.z, movement.direction)
    const summary = result?.kind === 'moved'
      ? { kind: result.kind, mapId: result.state.map.id, tileX: result.state.tileX, tileZ: result.state.tileZ, warp: result.warp }
      : result
    return [{
      from: position,
      input: movement.input,
      fromHeights: getMapGroundHeights(sourceMap, position.x, position.z),
      toHeights: getMapGroundHeights(sourceMap, position.x + movement.x, position.z + movement.z),
      result: summary,
    }]
  })).slice(0, 64)
  throw new Error(`Aucun chemin d'inputs ROM direct de la carte ${start.mapId} vers la carte ${targetMapId}: ${JSON.stringify({ start, sourceOrigin: getMapOrigin(sourceMap), targetOrigin: getMapOrigin(targetMap), visited: visited.size, range, activeObjects, flags: state.flags.size, hidden: [...state.hiddenObjectIds], frontier })}.`)
}

/**
 * Browser-safe objective planner. It is deliberately stateless: callers may
 * discard an interrupted plan after a script, trainer battle, or wild battle
 * and ask for fresh inputs from the resulting field position.
 */
export function createJohtoJourneyPlanner(
  maps: OpeningMapPreview[],
  target: JohtoJourneyTarget = ZEPHYR_BADGE_TARGET,
): JohtoJourneyPlanner {
  const routeMapIds = [target.routeStartMapId, ...target.route.map((transition) => transition.targetMapId)]

  return {
    target,
    getMilestone(state) {
      return { id: target.id, label: target.label, reached: isJohtoJourneyTargetReached(state, target) }
    },
    planInputs(position, state) {
      if (isJohtoJourneyTargetReached(state, target)) return undefined
      const routeIndex = routeMapIds.indexOf(position.mapId)
      if (routeIndex < 0) {
        throw new Error(`La carte ${position.mapId} ne fait pas partie de la route vers le jalon ${target.id}.`)
      }
      const transition = target.route[routeIndex]
      if (transition) {
        return transition.kind === 'warp'
          ? findInputsToWarp(maps, position, transition.targetMapId, state)
          : findInputsToAdjacentMap(maps, position, transition.targetMapId, state)
      }
      if (position.mapId !== target.destinationMapId) {
        throw new Error(`La route vers le jalon ${target.id} se termine sur une carte inattendue (${position.mapId}).`)
      }
      const map = findMap(maps, position.mapId)
      const leader = map.events?.objects.find((object) => (
        object.spriteId === target.leader.spriteId && object.scriptId === target.leader.scriptId
      ))
      if (!leader) throw new Error(`Le champion du jalon ${target.id} est absent de la carte ${position.mapId}.`)
      return findInputsToNpc(maps, position, leader.id, state)
    },
  }
}
