import type { MapCoordinateEventPreview, OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { getMapOrigin } from '../world/mapCoordinates'
import { createWorldSession } from '../world/worldSession'
import type { FieldInput } from './fieldInputSimulator'

type PlayerPosition = { mapId: number, tileX: number, tileZ: number, direction: PlayerDirection, groundHeight?: number }
type JourneyGoal = { id: string, label: string, reached: (position: PlayerPosition, state: FieldScriptState) => boolean, plan: (position: PlayerPosition, state: FieldScriptState) => FieldInput[] }

const directions: { input: Exclude<FieldInput, 'confirm'>, x: number, z: number, direction: PlayerDirection }[] = [
  { input: 'up', x: 0, z: -1, direction: 'north' },
  { input: 'down', x: 0, z: 1, direction: 'south' },
  { input: 'left', x: -1, z: 0, direction: 'west' },
  { input: 'right', x: 1, z: 0, direction: 'east' },
]

type Planner = ReturnType<typeof createWorldSession>
type PlannedMovement = typeof directions[number]
type PlannedInteraction = {
  movement: PlannedMovement
  interaction: ReturnType<Planner['interact']>
}
type PlannedStep = PlannedInteraction & {
  result: ReturnType<Planner['tryMove']>
}
type PathTarget =
  | { phase: 'before-move', reached: (interaction: PlannedInteraction) => boolean }
  | { phase: 'after-move', reached: (step: PlannedStep) => boolean }

export type OpeningJourneyAgent = {
  nextInput: (position: PlayerPosition, state: FieldScriptState) => FieldInput | undefined
  getCheckpoint: () => { id: string, label: string }
  getChoiceIndex: (state: FieldScriptState) => number
}

function findMap(maps: OpeningMapPreview[], mapId: number): OpeningMapPreview {
  const map = maps.find((candidate) => candidate.id === mapId)
  if (!map) throw new Error(`Carte ROM ${mapId} absente du parcours joueur.`)
  return map
}

function createPlanner(maps: OpeningMapPreview[], state: FieldScriptState, position: PlayerPosition): Planner {
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

function findPath(
  map: OpeningMapPreview,
  start: PlayerPosition,
  state: FieldScriptState,
  target: PathTarget,
  targetTiles: readonly { x: number, z: number }[] = [],
): FieldInput[] {
  type Node = PlayerPosition & { inputs: FieldInput[] }
  const queue: Node[] = [{ ...start, inputs: [] }]
  const visited = new Set<string>([`${start.tileX}:${start.tileZ}:${start.groundHeight ?? 'none'}`])
  const priority = (node: Node): number => node.inputs.length + (targetTiles.length === 0 ? 0 : Math.min(
    ...targetTiles.map((target) => Math.max(0, Math.abs(node.tileX - target.x) + Math.abs(node.tileZ - target.z) - 1)),
  ))
  for (let visitedNodes = 0; queue.length > 0 && visitedNodes < 256; visitedNodes += 1) {
    let bestIndex = 0
    for (let index = 1; index < queue.length; index += 1) {
      if (priority(queue[index]!) < priority(queue[bestIndex]!)) bestIndex = index
    }
    const [node] = queue.splice(bestIndex, 1)
    if (!node) break
    for (const movement of directions) {
      const planner = createPlanner([map], state, node)
      planner.setDirection(movement.direction)
      // Les interactions sont resolues avant le pas comme dans la ROM. Les
      // warps et coordonnees se fondent ensuite uniquement sur le tryMove reel.
      const interaction = planner.interact()
      if (target.phase === 'before-move' && target.reached({ movement, interaction })) {
        return [...node.inputs, movement.input]
      }
      const result = planner.tryMove(movement.x, movement.z, movement.direction)
      if (target.phase === 'after-move' && target.reached({ movement, interaction, result })) {
        return [...node.inputs, movement.input]
      }
      if (!result || result.kind === 'blocked' || result.warp || result.state.map.id !== start.mapId) continue
      const inputs = [...node.inputs, movement.input]
      const next: PlayerPosition = { mapId: start.mapId, tileX: result.state.tileX, tileZ: result.state.tileZ, direction: movement.direction, groundHeight: result.state.groundHeight }
      const key = `${next.tileX}:${next.tileZ}:${next.groundHeight ?? 'none'}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({ ...next, inputs })
    }
  }
  throw new Error(`Aucun chemin joueur ROM depuis ${start.mapId}:${start.tileX},${start.tileZ} vers ${JSON.stringify(targetTiles)}.`)
}

function pathToWarp(maps: OpeningMapPreview[], start: PlayerPosition, state: FieldScriptState, targetMapId: number): FieldInput[] {
  const map = findMap(maps, start.mapId)
  const origin = getMapOrigin(map)
  const targets = (map.events?.warps ?? [])
    .filter((warp) => warp.header === targetMapId)
    .map((warp) => ({ x: warp.x - origin.x, z: warp.z - origin.z }))
  return findPath(map, start, state, {
    phase: 'after-move',
    reached: ({ result }) => result?.kind === 'moved' && result.warp?.header === targetMapId,
  }, targets)
}

function pathToBackground(maps: OpeningMapPreview[], start: PlayerPosition, state: FieldScriptState, scriptId: number): FieldInput[] {
  const map = findMap(maps, start.mapId)
  const origin = getMapOrigin(map)
  const targets = (map.events?.backgrounds ?? [])
    .filter((background) => background.scriptId === scriptId)
    .map((background) => ({ x: background.x - origin.x, z: background.z - origin.z }))
  return findPath(map, start, state, {
    phase: 'before-move',
    reached: ({ interaction }) => interaction?.kind === 'background' && interaction.scriptId === scriptId,
  }, targets).concat('confirm')
}

function pathToNpc(maps: OpeningMapPreview[], start: PlayerPosition, state: FieldScriptState, objectId: number): FieldInput[] {
  const map = findMap(maps, start.mapId)
  const origin = getMapOrigin(map)
  const object = state.objects.get(objectId) ?? map.events?.objects.find((candidate) => candidate.id === objectId)
  const targets = object ? [{ x: object.x - origin.x, z: object.z - origin.z }] : []
  return findPath(map, start, state, {
    phase: 'before-move',
    reached: ({ interaction }) => interaction?.kind === 'npc' && interaction.id === objectId,
  }, targets).concat('confirm')
}

function pathToCoordinate(maps: OpeningMapPreview[], start: PlayerPosition, state: FieldScriptState, coordinate: MapCoordinateEventPreview): FieldInput[] {
  const map = findMap(maps, start.mapId)
  const origin = getMapOrigin(map)
  return findPath(map, start, state, {
    phase: 'after-move',
    reached: ({ result }) => {
      const reached = result?.kind === 'moved' ? result.coordinate : undefined
      return reached?.scriptId === coordinate.scriptId
        && reached.x === coordinate.x
        && reached.z === coordinate.z
        && reached.width === coordinate.width
        && reached.height === coordinate.height
    },
  }, [{ x: coordinate.x - origin.x, z: coordinate.z - origin.z }])
}

export function createOpeningJourneyAgent(maps: OpeningMapPreview[], starterChoice: 0 | 1 | 2 = 1): OpeningJourneyAgent {
  const starterMap = findMap(maps, 61)
  const starter = starterMap.events?.backgrounds.find((event) => event.x === 8 && event.z === 4)
  const newBarkTown = findMap(maps, 60)
  const elmPhone = newBarkTown.events?.coordinateEvents.find((event) => event.scriptId === 3)
  if (!starter || !elmPhone) throw new Error('Les événements ROM du starter ou du numéro d’Orme sont absents.')
  const goals: JourneyGoal[] = [
    { id: 'leave-bedroom', label: 'Quitter la chambre', reached: (p) => p.mapId === 63, plan: (p, s) => pathToWarp(maps, p, s, 63) },
    { id: 'leave-home', label: 'Quitter la maison', reached: (p) => p.mapId === 60, plan: (p, s) => pathToWarp(maps, p, s, 60) },
    { id: 'meet-elm', label: 'Atteindre le laboratoire Orme', reached: (p) => p.mapId === 61, plan: (p, s) => pathToWarp(maps, p, s, 61) },
    {
      id: 'choose-starter',
      label: 'Choisir le Pokémon de départ',
      reached: (_p, s) => s.party.members.length > 0
        && s.flags.has(0x6a)
        && !s.flags.has(0x160)
        && s.variables.get(0x4108) === 1,
      plan: (p, s) => pathToBackground(maps, p, s, starter.scriptId),
    },
    { id: 'leave-lab', label: 'Quitter le laboratoire', reached: (p) => p.mapId === 60, plan: (p, s) => pathToWarp(maps, p, s, 60) },
    { id: 'visit-mom', label: 'Repasser voir Maman', reached: (p) => p.mapId === 63, plan: (p, s) => pathToWarp(maps, p, s, 63) },
    { id: 'talk-to-mom', label: 'Recevoir le Pokématos', reached: (_p, s) => s.flags.has(0x9c), plan: (p, s) => pathToNpc(maps, p, s, 0) },
    { id: 'leave-home-again', label: 'Quitter la maison après le Pokématos', reached: (p) => p.mapId === 60, plan: (p, s) => pathToWarp(maps, p, s, 60) },
    {
      id: 'receive-elm-number',
      label: 'Recevoir le numéro du Professeur Orme',
      reached: (_p, s) => s.phoneContacts.has(1),
      plan: (p, s) => pathToCoordinate(maps, p, s, elmPhone),
    },
  ]
  let goalIndex = 0
  let inputQueue: FieldInput[] = []
  let queuedMapId: number | undefined
  let expectedPosition: string | undefined

  function updateGoal(position: PlayerPosition, state: FieldScriptState): void {
    while (goals[goalIndex]?.reached(position, state)) {
      goalIndex += 1
      inputQueue = []
      queuedMapId = undefined
      expectedPosition = undefined
    }
  }

  return {
    nextInput(position, state) {
      updateGoal(position, state)
      const goal = goals[goalIndex]
      if (!goal) return undefined
      const positionKey = `${position.mapId}:${position.tileX}:${position.tileZ}`
      if (expectedPosition !== undefined && expectedPosition !== positionKey) inputQueue = []
      expectedPosition = undefined
      if (queuedMapId !== position.mapId || inputQueue.length === 0) {
        inputQueue = goal.plan(position, state)
        queuedMapId = position.mapId
      }
      const input = inputQueue.shift()
      const movement = directions.find((candidate) => candidate.input === input)
      // Devant un NPC ou un décor interactif, la dernière direction sert à
      // regarder l'objet. La collision ROM bloque volontairement le pas ; la
      // confirmation qui suit doit donc rester dans la file au même endroit.
      const isFacingInteraction = movement !== undefined && inputQueue[0] === 'confirm'
      expectedPosition = movement && !isFacingInteraction
        ? `${position.mapId}:${position.tileX + movement.x}:${position.tileZ + movement.z}`
        : positionKey
      return input
    },
    getCheckpoint() {
      const goal = goals[goalIndex]
      return goal ? { id: goal.id, label: goal.label } : { id: 'pre-wild-complete', label: 'Parcours avant combats sauvages terminé' }
    },
    getChoiceIndex(state) {
      if (goalIndex !== 3) return 0
      return state.party.members.length === 0 ? starterChoice : 1
    },
  }
}
