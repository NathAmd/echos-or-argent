import type { MapCoordinateEventPreview, NitroMapPropPreview, OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import { resolveDoorTransitionDescriptor, type DoorTransitionDescriptor, type MapPropAnimationMetadata } from '../../rom/maps/doorTransition'
import type { FieldMovementAction } from '../scripts/fieldMovement'
import {
  getForcedSlideDirection,
  getLedgeDirection,
  isIceMetatile,
  isSurfableMetatile,
  isWaterfallMetatile,
  resolvePlayerMovementKind,
  type PlayerLocomotionMode,
  type PlayerMovementKind,
} from '../player/hgssPlayerMovement'
import { decodeHgssPlayerDirection, hgssPlayerDirections } from '../player/playerDirection'
import { advanceHgssBridgeLayer, isHgssBridgeMetatile, restoreHgssBridgeLayer } from '../player/hgssBridgeLayer'
import { resolveFollowerScriptMovement, type FollowerScriptMovement } from './followerScriptMovement'
import type { DynamicWorldActor, DynamicWorldActorRegistry } from './dynamicWorldActorRegistry'
import { hgssFieldMetatileScriptIds, resolveHgssMetatileInteractionScript } from './hgssMetatileInteraction'
import { resolveHgssWarpActivation, type HgssWarpActivation } from './hgssWarpActivation'
import { getMapOrigin, getMapTileBounds, isMapLowestGroundLayer, resolveMapGroundLayer, usesWorldMatrixCoordinates } from './mapCoordinates'
import { findStrengthHoleTiles, isPushableStrengthBoulder, resolveStrengthBoulderFall } from './strengthBoulderMechanism'
const tileBehaviorMask = 0x00ff
const counterTileBehavior = 0x80
export const hgssDynamicWarpSentinelMapId = 0x0fff as const
export const hgssDynamicWarpSentinelAnchor = 0x0100 as const
const indoorMapPropTileSize = 16
export const hgssFollowerObjectId = 0xfd
const hgssStrengthActiveFlag = 0x962
const hgssSlidingIceBlockSpriteId = 406

type DynamicWarpLocation = {
  mapId: number
  warpId: number
  x: number
  z: number
  direction: number
}

function resolveDoorMetadataForMap(
  map: OpeningMapPreview,
  resolveMapPropAnimationMetadata: (modelId: number, domain?: 'field' | 'room', areaDataBank?: number) => MapPropAnimationMetadata | undefined,
  modelId: number,
): MapPropAnimationMetadata | undefined {
  const domain = usesWorldMatrixCoordinates(map) ? 'field' : 'room'
  return resolveMapPropAnimationMetadata(modelId, domain, map.header.areaDataBank)
    ?? resolveMapPropAnimationMetadata(modelId, domain === 'field' ? 'room' : 'field', map.header.areaDataBank)
}

function usesRoomScenePropCoordinates(map: OpeningMapPreview): boolean {
  if (usesWorldMatrixCoordinates(map) || !map.terrain) return false
  return (map.model?.mapProps ?? []).some((prop) => (
    prop.position[0] < 0
    || prop.position[2] < 0
    || prop.position[0] > map.terrain!.width
    || prop.position[2] > map.terrain!.height
  ))
}

function resolveDoorPropPosition(map: OpeningMapPreview, prop: NitroMapPropPreview): { x: number, z: number } {
  if (!usesRoomScenePropCoordinates(map) || !map.terrain) return { x: prop.position[0], z: prop.position[2] }
  return {
    x: prop.position[0] / indoorMapPropTileSize + map.terrain.width / 2,
    z: prop.position[2] / indoorMapPropTileSize + map.terrain.height / 2,
  }
}

export type WorldEvent =
  | { kind: 'npc', id: number, scriptId: number }
  | { kind: 'follower' }
  | { kind: 'background', scriptId: number, type: number, direction: number }
  | { kind: 'metatile', scriptId: number, behavior: number }
  | ({ kind: 'coordinate' } & MapCoordinateEventPreview)
  | { kind: 'warp', header: number, anchor: number }

export type WorldInteraction = Extract<WorldEvent, { kind: 'npc' | 'follower' | 'background' | 'metatile' }>

/** Cible exacte d'une interaction, y compris au bord de deux headers de matrice. */
export type WorldInteractionResolution = Readonly<{
  map: OpeningMapPreview
  worldX: number
  worldZ: number
  event: WorldInteraction
}>

export type WorldState = {
  map: OpeningMapPreview
  tileX: number
  tileZ: number
  direction: PlayerDirection
  locomotion: PlayerLocomotionMode
  groundHeight?: number
}

export type FollowerWorldState = {
  map: OpeningMapPreview
  tileX: number
  tileZ: number
  direction: PlayerDirection
  groundHeight?: number
  movement?: number
}

export type ObjectMovementResult = {
  follower: FollowerWorldState
  /** Chemin case par case dérivé des anciennes positions du joueur. */
  followerActions: FieldMovementAction[]
}

export type SavedFollowerWorldState = Pick<FollowerWorldState, 'tileX' | 'tileZ' | 'direction' | 'movement'>

export type WorldObjectMovement = {
  objectId: number
  kind: 'strength-push' | 'strength-fall' | 'ice-block-slide'
  /** Direction de l'animation; l'orientation finale peut differer. */
  direction: PlayerDirection
  finalDirection: PlayerDirection
  distance: number
  worldX: number
  worldZ: number
  tileX: number
  tileZ: number
}

export type WorldMoveResult =
  | { kind: 'turned', state: WorldState, movement: 'turn', coordinate?: undefined, warp?: undefined, warpActivation?: undefined, door?: undefined, continuationDirection?: undefined, objectMovements?: undefined }
  | { kind: 'moved', state: WorldState, movement: PlayerMovementKind, continuationDirection?: PlayerDirection, coordinate?: Extract<WorldEvent, { kind: 'coordinate' }>, warp?: Extract<WorldEvent, { kind: 'warp' }>, warpActivation?: HgssWarpActivation, door?: DoorTransitionDescriptor, objectMovements?: WorldObjectMovement[] }
  | { kind: 'blocked', reason: 'bounds' | 'terrain' | 'npc' | 'follower' | 'dynamic-actor', tileX: number, tileZ: number, attribute?: number, event?: Extract<WorldEvent, { kind: 'npc' }>, dynamicActor?: DynamicWorldActor, objectMovements?: WorldObjectMovement[] }

export type PlayerMoveContext = {
  running?: boolean
  /** Le moteur natif consomme une première entrée pour tourner sur place. */
  enforceTurn?: boolean
  /** Glace, tapis roulants et scripts ne repassent pas par l'état de rotation. */
  forced?: boolean
}

export type AuthoritativePlayerStepPosition = Readonly<{
  mapId: number
  x: number
  z: number
  direction: PlayerDirection
}>

/**
 * Pas déjà décidé par l'autorité Coop. Cette projection locale reste limitée
 * aux déplacements ordinaires de la V1 et ne réévalue aucun effet du terrain.
 */
export type AuthoritativePlayerStep = Readonly<{
  from: AuthoritativePlayerStepPosition
  to: AuthoritativePlayerStepPosition
  movement: 'walk' | 'run'
}>

export type AuthoritativePlayerMoveResult = Extract<WorldMoveResult, { kind: 'moved' }>

/**
 * Projection exacte d'un warp deja resolu par l'autorite ROM de la campagne.
 * Contrairement a `transitionTo`, la destination ne se resout plus depuis un
 * anchor local : elle doit correspondre au snapshot autoritaire acquitte.
 */
export type AuthoritativePlayerTransition = Readonly<{
  from: AuthoritativePlayerStepPosition
  to: AuthoritativePlayerStepPosition
  movement: 'walk' | 'run'
}>

export type AuthoritativePlayerTransitionResult = Readonly<{
  kind: 'transitioned'
  state: WorldState
  movement: AuthoritativePlayerTransition['movement']
}>

export type PlayerTileInspectionOptions = Readonly<{
  locomotion?: PlayerLocomotionMode
  referenceGroundHeight?: number
}>

export type PlayerTileBlockedReason = 'bounds' | 'terrain' | 'npc' | 'dynamic-actor'

export type PlayerTileInspection = Readonly<{
  mapId: number
  tileX: number
  tileZ: number
  insideBounds: boolean
  terrainAttribute?: number
  groundHeight?: number
  terrainBlocked: boolean
  npcOccupied: boolean
  dynamicActorOccupied: boolean
  blocked: boolean
  blockedReason?: PlayerTileBlockedReason
}>

export type WorldTransitionResult =
  | { kind: 'transitioned', state: WorldState, arrival?: { fromTileX: number, fromTileZ: number, door?: DoorTransitionDescriptor } }
  | { kind: 'missing-map', mapId: number }
  | { kind: 'missing-anchor', map: OpeningMapPreview }

export type WorldGymmickCollisionResolver = (
  mapId: number,
  tileX: number,
  tileZ: number,
  metatileBehavior: number,
) => boolean | undefined
export type WorldGymmickHeightResolver = (mapId: number, tileX: number, tileZ: number) => number | undefined
export type WorldGymmickResolvers = { collision?: WorldGymmickCollisionResolver, height?: WorldGymmickHeightResolver }

export type WorldDynamicActorProvider = Pick<
  DynamicWorldActorRegistry,
  'getBlockingActorsAt' | 'getInteractableActorsAt'
>

const emptyDynamicWorldActors: readonly DynamicWorldActor[] = Object.freeze([])

export const emptyWorldDynamicActorProvider: WorldDynamicActorProvider = Object.freeze({
  getBlockingActorsAt: () => emptyDynamicWorldActors,
  getInteractableActorsAt: () => emptyDynamicWorldActors,
})

export type WorldSessionExtensionPorts = Readonly<{
  dynamicActors: WorldDynamicActorProvider
}>

export const baseWorldSessionExtensionPorts: WorldSessionExtensionPorts = Object.freeze({
  dynamicActors: emptyWorldDynamicActorProvider,
})

export type FollowerInteractionEnvironment = {
  mapId: number
  mapSection: number
  weather: number
  metatileBehavior: number
  nearbyObjectCount: number
  hiddenItemCount: number
  facingDirection: PlayerDirection
}

export type TrainerEngagement = {
  objectId: number
  trainerId: number
  scriptId: number
  direction: PlayerDirection
  distance: number
  encounterType: 0 | 1 | 2
}

export type WorldSession = {
  loadMap: (mapId: number, tileX: number, tileZ: number, direction?: PlayerDirection, locomotion?: PlayerLocomotionMode, referenceGroundHeight?: number) => WorldState | undefined
  /** Recalcule la variante dynamique courante sans simuler une transition de carte. */
  refreshMapVariant: () => WorldState | undefined
  getState: () => WorldState | undefined
  /** Applique uniquement la projection d'un pas déjà validé par l'autorité Coop. */
  applyAuthoritativePlayerStep: (step: AuthoritativePlayerStep) => AuthoritativePlayerMoveResult | undefined
  /** Applique un warp acquitte sans rejouer anchor, scripts, progression ni collision. */
  applyAuthoritativePlayerTransition: (
    transition: AuthoritativePlayerTransition,
  ) => AuthoritativePlayerTransitionResult | undefined
  /** Inspecte une case de la carte chargée sans modifier le monde ni ses objets. */
  inspectPlayerTile: (
    mapId: number,
    tileX: number,
    tileZ: number,
    options?: PlayerTileInspectionOptions,
  ) => PlayerTileInspection | undefined
  setLocomotion: (locomotion: PlayerLocomotionMode) => WorldState | undefined
  getTerrainAttributeAt: (tileX: number, tileZ: number) => number | undefined
  getFacingTerrainAttribute: () => number | undefined
  /** Eau réellement accessible sur la couche BDHC face au joueur. */
  isFacingSurfableSurface: () => boolean
  setFollowerEnabled: (enabled: boolean) => void
  getFollowerState: () => FollowerWorldState | undefined
  getFollowerInteractionEnvironment: () => FollowerInteractionEnvironment | undefined
  restoreFollowerState: (saved: SavedFollowerWorldState) => FollowerWorldState | undefined
  configureFollower: (offsetDirection: number, facingDirection: number) => FollowerWorldState | undefined
  applyFollowerScriptMovement: (movement: number) => { state: FollowerWorldState, movement: FollowerScriptMovement } | undefined
  completeDoorArrival: () => FollowerWorldState | undefined
  resolveScriptDoor: (worldX: number, worldZ: number) => DoorTransitionDescriptor | undefined
  setDirection: (direction: PlayerDirection) => void
  setObjectState: (objectId: number, x?: number, z?: number, direction?: PlayerDirection) => void
  syncDaycareObjects: (objects: Array<{ objectId: 250 | 251, x: number, z: number }>) => void
  tryMoveObject: (objectId: number, direction: PlayerDirection) => { tileX: number, tileZ: number } | undefined
  tryMove: (deltaX: number, deltaZ: number, direction: PlayerDirection, context?: PlayerMoveContext) => WorldMoveResult | undefined
  findEventAt: (tileX: number, tileZ: number) => WorldEvent | undefined
  /** Projection de TryGetSeenByNpcTrainers, appelée après la fin d'un pas. */
  findEngagingTrainers: () => TrainerEngagement[]
  /** Résout l'événement et son header propriétaire sans modifier le monde. */
  resolveInteraction: () => WorldInteractionResolution | undefined
  /** Cherche uniquement un événement activable par le bouton d'action. */
  interact: () => WorldInteraction | undefined
  /** Expose la cible dynamique sans lui inventer de script ou d'effet de domaine. */
  findDynamicActorInteraction: () => DynamicWorldActor | undefined
  applyObjectMovement: (objectId: number, actions: FieldMovementAction[], followPlayer?: boolean) => ObjectMovementResult | undefined
  faceObjectAtPlayer: (objectId: number) => PlayerDirection | undefined
  faceFollowerAtPlayer: () => FollowerWorldState | undefined
  transitionTo: (mapId: number, anchor?: number, direction?: PlayerDirection) => WorldTransitionResult
  scriptWarpTo: (mapId: number, x: number, z: number, direction: PlayerDirection) => WorldTransitionResult
}

export function createWorldSession(
  maps: OpeningMapPreview[],
  flags: Set<number> = new Set(),
  hiddenObjectIds: Set<number> = new Set(),
  variables: Map<number, number> = new Map(),
  resolveMapPropAnimationMetadata?: (modelId: number, domain?: 'field' | 'room', areaDataBank?: number) => MapPropAnimationMetadata | undefined,
  trainerFlags: Set<number> = new Set(),
  resolveDynamicWarp?: () => DynamicWarpLocation | undefined,
  resolveMapVariant?: (map: OpeningMapPreview) => OpeningMapPreview,
  resolveGymmick?: WorldGymmickCollisionResolver | WorldGymmickResolvers,
  extensionPorts: WorldSessionExtensionPorts = baseWorldSessionExtensionPorts,
): WorldSession {
  const resolveGymmickCollision = typeof resolveGymmick === 'function' ? resolveGymmick : resolveGymmick?.collision
  const resolveGymmickHeight = typeof resolveGymmick === 'function' ? undefined : resolveGymmick?.height
  let state: WorldState | undefined
  let playerOnRaisedBridge = false
  let followerEnabled = false
  let followerState: FollowerWorldState | undefined
  let followerYieldTarget: string | undefined
  const mapsById = new Map(maps.map((map) => [map.id, map]))
  const resolveMap = (mapId: number): OpeningMapPreview | undefined => {
    const map = mapsById.get(mapId)
    return map && resolveMapVariant ? resolveMapVariant(map) : map
  }
  const objectPositions = new Map<number, { x: number, z: number, direction: PlayerDirection }>()
  const daycareObjectIds = new Set<number>()

  const initializeObjectPositions = (map: OpeningMapPreview): void => {
    objectPositions.clear()
    daycareObjectIds.clear()
    for (const object of map.events?.objects ?? []) {
      objectPositions.set(object.id, { x: object.x, z: object.z, direction: decodeHgssPlayerDirection(object.facingDirection) })
    }
  }

  const getMovementBounds = (map: OpeningMapPreview): { minX: number, maxX: number, minZ: number, maxZ: number } => {
    const worldTileBounds = usesWorldMatrixCoordinates(map) ? getMapTileBounds(map) : undefined
    if (worldTileBounds) return worldTileBounds
    if (map.model?.tileBounds) return map.model.tileBounds
    if (map.terrain) {
      return { minX: 0, maxX: map.terrain.width, minZ: 0, maxZ: map.terrain.height }
    }
    throw new Error(`La carte ROM ${map.id} ne contient aucune limite de tuiles ni terrain.`)
  }

  const isInsideMovementBounds = (map: OpeningMapPreview, tileX: number, tileZ: number): boolean => {
    const bounds = getMovementBounds(map)
    return tileX >= Math.floor(bounds.minX)
      && tileX < Math.ceil(bounds.maxX)
      && tileZ >= Math.floor(bounds.minZ)
      && tileZ < Math.ceil(bounds.maxZ)
  }

  const getTerrainAttribute = (map: OpeningMapPreview, tileX: number, tileZ: number): number | undefined => {
    const terrain = map.terrain
    if (!terrain || tileX < 0 || tileZ < 0 || tileX >= terrain.width || tileZ >= terrain.height) return undefined
    return terrain.attributes[tileZ * terrain.width + tileX]
  }

  const getGroundHeight = (map: OpeningMapPreview, tileX: number, tileZ: number, referenceHeight?: number, raisedBridge = false): number | undefined => {
    const gymmickHeight = resolveGymmickHeight?.(map.id, tileX, tileZ)
    if (gymmickHeight !== undefined) return gymmickHeight
    if (!(map.terrain?.collisionPlates?.length) && !(map.model?.surfaces?.length)) return undefined
    const layer = resolveMapGroundLayer(map, tileX, tileZ, referenceHeight)
    return raisedBridge ? layer?.highestHeight : layer?.height
  }

  const positionFollowerBehindPlayer = (): void => {
    if (!followerEnabled || !state) {
      followerState = undefined
      return
    }
    const behindOffsets: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0],
    }
    const [offsetX, offsetZ] = behindOffsets[state.direction]
    const tileX = state.tileX + offsetX
    const tileZ = state.tileZ + offsetZ
    // À la frontière de deux parcelles extérieures, la case « derrière » est
    // exprimée dans le repère de la nouvelle carte mais sa BDHC appartient
    // encore à la parcelle voisine. La ROM résout d'abord la coordonnée monde.
    const resolvedGround = resolveLocalPosition(tileX, tileZ)
    followerState = {
      map: state.map,
      tileX,
      tileZ,
      direction: state.direction,
      groundHeight: resolvedGround
        ? getGroundHeight(resolvedGround.map, resolvedGround.tileX, resolvedGround.tileZ, state.groundHeight)
        : getGroundHeight(state.map, tileX, tileZ, state.groundHeight),
    }
  }

  const completeDoorArrival = (): FollowerWorldState | undefined => {
    if (!state || !followerEnabled) return undefined
    // `transitionTo` l'a déjà placé sur la case de porte, donc derrière la
    // position finale du joueur. Le recopier sur `state` superposait les deux.
    if (!followerState) positionFollowerBehindPlayer()
    return followerState
  }

  const resolveScriptDoor = (worldX: number, worldZ: number): DoorTransitionDescriptor | undefined => {
    if (!state || !resolveMapPropAnimationMetadata) return undefined
    const origin = getMapOrigin(state.map)
    return resolveDoorTransitionDescriptor(
      worldX - origin.x,
      worldZ - origin.z,
      state.map.model?.mapProps ?? [],
      (modelId) => resolveDoorMetadataForMap(state!.map, resolveMapPropAnimationMetadata, modelId),
      'script',
      (prop) => resolveDoorPropPosition(state!.map, prop),
    )
  }

  const isBlockedTerrainAttribute = (attribute: number | undefined, locomotion: PlayerLocomotionMode = 'walking'): boolean => {
    if (attribute === undefined) return false
    if (isSurfableMetatile(attribute)) return locomotion !== 'surfing'
    // Les plaques de glace et les tapis de glisse HGSS gardent souvent le bit
    // 0x8000 dans les données ROM tout en restant franchissables.
    if (isIceMetatile(attribute) || getForcedSlideDirection(attribute)) return false
    return (attribute & 0x8000) !== 0
  }

  const isWaterfallSurfaceAt = (
    map: OpeningMapPreview,
    tileX: number,
    tileZ: number,
    attribute: number | undefined,
    referenceGroundHeight?: number,
    raisedBridge = false,
  ): boolean => isWaterfallMetatile(attribute)
    && !raisedBridge
    && isMapLowestGroundLayer(map, tileX, tileZ, referenceGroundHeight)

  const resolveWorldPosition = (worldX: number, worldZ: number): { map: OpeningMapPreview, tileX: number, tileZ: number, worldX: number, worldZ: number } | undefined => {
    if (!state) return undefined
    const activeMap = state.map
    if (!usesWorldMatrixCoordinates(activeMap)) {
      return { map: activeMap, tileX: worldX, tileZ: worldZ, worldX, worldZ }
    }
    const cellX = Math.floor(worldX / 32)
    const cellZ = Math.floor(worldZ / 32)
    if (cellX < 0 || cellX >= activeMap.matrix.width || cellZ < 0 || cellZ >= activeMap.matrix.height) return undefined
    const mapId = activeMap.matrix.headers[cellZ * activeMap.matrix.width + cellX]
    const map = resolveMap(mapId)
    if (!map || !usesWorldMatrixCoordinates(map) || map.matrix.matrixIndex !== activeMap.matrix.matrixIndex) return undefined
    const origin = getMapOrigin(map)
    return {
      map,
      tileX: worldX - origin.x,
      tileZ: worldZ - origin.z,
      worldX,
      worldZ,
    }
  }

  const resolveLocalPosition = (tileX: number, tileZ: number): { map: OpeningMapPreview, tileX: number, tileZ: number, worldX: number, worldZ: number } | undefined => {
    if (!state) return undefined
    const origin = getMapOrigin(state.map)
    return resolveWorldPosition(origin.x + tileX, origin.z + tileZ)
  }

  const isHiddenObjectAtWorld = (map: OpeningMapPreview, worldX: number, worldZ: number): boolean => {
    if (state?.map.id !== map.id) return false
    for (const object of map.events?.objects ?? []) {
      if (!hiddenObjectIds.has(object.id)) continue
      const position = objectPositions.get(object.id) ?? object
      if (position.x === worldX && position.z === worldZ) return true
    }
    return false
  }

  const isBlockedTerrainAtWorld = (
    map: OpeningMapPreview,
    tileX: number,
    tileZ: number,
    worldX: number,
    worldZ: number,
    locomotion: PlayerLocomotionMode = 'walking',
    referenceGroundHeight?: number,
    raisedBridge = false,
  ): boolean => {
    const attribute = getTerrainAttribute(map, tileX, tileZ)
    const gymmickCollision = resolveGymmickCollision?.(map.id, tileX, tileZ, (attribute ?? 0) & tileBehaviorMask)
    if (gymmickCollision !== undefined) return gymmickCollision
    const surfableMetatile = isSurfableMetatile(attribute)
    const surfableLayer = surfableMetatile && !raisedBridge && isMapLowestGroundLayer(map, tileX, tileZ, referenceGroundHeight)
    const effectiveAttribute = !surfableMetatile || surfableLayer || attribute === undefined
      ? attribute
      : attribute & ~tileBehaviorMask
    return isBlockedTerrainAttribute(effectiveAttribute, locomotion)
      && !isHiddenObjectAtWorld(map, worldX, worldZ)
  }

  const findMapObjectAtWorld = (map: OpeningMapPreview, worldX: number, worldZ: number, excludedObjectId?: number): NonNullable<OpeningMapPreview['events']>['objects'][number] | undefined => {
    return map.events?.objects.find((candidate) => {
      if (candidate.id === excludedObjectId) return false
      const position = state?.map.id === map.id ? objectPositions.get(candidate.id) ?? candidate : candidate
      return position.x === worldX
        && position.z === worldZ
        && (candidate.eventFlag === 0 || !flags.has(candidate.eventFlag))
        && !hiddenObjectIds.has(candidate.id)
    })
  }

  const findWarpAtWorld = (map: OpeningMapPreview, worldX: number, worldZ: number): Extract<WorldEvent, { kind: 'warp' }> | undefined => {
    const warp = map.events?.warps.find((candidate) => candidate.x === worldX && candidate.z === worldZ)
    return warp ? { kind: 'warp', header: warp.header, anchor: warp.anchor } : undefined
  }

  const findNpcAtWorld = (map: OpeningMapPreview, worldX: number, worldZ: number): Extract<WorldEvent, { kind: 'npc' }> | undefined => {
    const object = findMapObjectAtWorld(map, worldX, worldZ)
    if (object) return { kind: 'npc', id: object.id, scriptId: object.scriptId }
    if (state?.map.id !== map.id) return undefined
    for (const objectId of daycareObjectIds) {
      const position = objectPositions.get(objectId)
      if (position?.x === worldX && position.z === worldZ) return { kind: 'npc', id: objectId, scriptId: 0 }
    }
    return undefined
  }

  const findEventAtWorld = (map: OpeningMapPreview, worldX: number, worldZ: number): WorldEvent | undefined => {
    const warp = findWarpAtWorld(map, worldX, worldZ)
    if (warp) return warp
    const npc = findNpcAtWorld(map, worldX, worldZ)
    if (npc) return npc
    const background = map.events?.backgrounds.find((candidate) => candidate.x === worldX && candidate.z === worldZ)
    return background ? { kind: 'background', scriptId: background.scriptId, type: background.type, direction: background.direction } : undefined
  }

  const findEventAt = (tileX: number, tileZ: number): WorldEvent | undefined => {
    const resolved = resolveLocalPosition(tileX, tileZ)
    if (!resolved) return undefined
    return findEventAtWorld(resolved.map, resolved.worldX, resolved.worldZ)
  }

  const findDynamicActorInteraction = (): DynamicWorldActor | undefined => {
    if (!state) return undefined
    const offset = state.direction === 'north' ? [0, -1]
      : state.direction === 'south' ? [0, 1]
      : state.direction === 'west' ? [-1, 0]
      : [1, 0]
    const adjacent = resolveLocalPosition(state.tileX + offset[0], state.tileZ + offset[1])
    return adjacent
      ? extensionPorts.dynamicActors.getInteractableActorsAt(adjacent.map.id, adjacent.tileX, adjacent.tileZ)[0]
      : undefined
  }

  const findNpcOrBackgroundAtWorld = (map: OpeningMapPreview, worldX: number, worldZ: number): Extract<WorldEvent, { kind: 'npc' | 'background' }> | undefined => {
    const npc = findNpcAtWorld(map, worldX, worldZ)
    if (npc) return npc
    const background = map.events?.backgrounds.find((candidate) => candidate.x === worldX && candidate.z === worldZ)
    return background ? { kind: 'background', scriptId: background.scriptId, type: background.type, direction: background.direction } : undefined
  }

  const findEngagingTrainers = (): TrainerEngagement[] => {
    if (!state) return []
    const map = state.map
    const origin = getMapOrigin(map)
    const playerWorldX = origin.x + state.tileX
    const playerWorldZ = origin.z + state.tileZ
    const deltas: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }
    const directions = hgssPlayerDirections
    const engagements: TrainerEngagement[] = []

    for (const object of map.events?.objects ?? []) {
      if ((object.eventFlag !== 0 && flags.has(object.eventFlag)) || hiddenObjectIds.has(object.id)) continue
      // sub_02064298: type 1 et 4..8 regardent dans leur orientation; le
      // type 2 (Dresseur pivotant) vérifie les quatre directions.
      const position = objectPositions.get(object.id) ?? { x: object.x, z: object.z, direction: directions[object.facingDirection] ?? 'south' }
      const candidateDirections = object.type === 2
        ? directions
        : object.type === 1 || (object.type >= 4 && object.type <= 8)
          ? [position.direction]
          : []
      if (candidateDirections.length === 0) continue
      const trainerId = object.scriptId < 5000
        ? object.scriptId - 2999
        : object.scriptId <= 5739 ? object.scriptId - 4999 : 0
      if (trainerId < 1 || trainerId > 740 || trainerFlags.has(trainerId)) continue
      const sightRange = object.parameters?.[0] ?? 0
      if (sightRange < 1) continue

      for (const direction of candidateDirections) {
        const [deltaX, deltaZ] = deltas[direction]
        const offsetX = playerWorldX - position.x
        const offsetZ = playerWorldZ - position.z
        const distance = deltaX === 0
          ? offsetX === 0 && Math.sign(offsetZ) === Math.sign(deltaZ) ? Math.abs(offsetZ) : -1
          : offsetZ === 0 && Math.sign(offsetX) === Math.sign(deltaX) ? Math.abs(offsetX) : -1
        if (distance < 1 || distance > sightRange) continue

        let blocked = false
        for (let step = 1; step < distance; step += 1) {
          const worldX = position.x + deltaX * step
          const worldZ = position.z + deltaZ * step
          const resolved = resolveWorldPosition(worldX, worldZ)
          if (!resolved || isBlockedTerrainAtWorld(resolved.map, resolved.tileX, resolved.tileZ, worldX, worldZ, state.locomotion, state.groundHeight)) {
            blocked = true
            break
          }
          const event = findEventAtWorld(resolved.map, worldX, worldZ)
          if (event?.kind === 'npc') {
            blocked = true
            break
          }
        }
        if (blocked) continue
        engagements.push({ objectId: object.id, trainerId, scriptId: object.scriptId, direction, distance, encounterType: 0 })
        break
      }
    }

    // Le moteur natif conserve au maximum deux Dresseurs engagés. Deux
    // Dresseurs indépendants voyant simultanément le joueur utilisent le type 2.
    return engagements.slice(0, 2).map((engagement) => ({
      ...engagement,
      encounterType: engagements.length > 1 ? 2 : engagement.encounterType,
    }))
  }

  const findCoordinateEventAtWorld = (map: OpeningMapPreview, worldX: number, worldZ: number): Extract<WorldEvent, { kind: 'coordinate' }> | undefined => {
    const coordinateEvent = map.events?.coordinateEvents.find((candidate) => {
      if (worldX < candidate.x || worldX >= candidate.x + candidate.width) return false
      if (worldZ < candidate.z || worldZ >= candidate.z + candidate.height) return false
      return (variables.get(candidate.variableId) ?? 0) === candidate.expectedValue
    })
    return coordinateEvent ? { kind: 'coordinate', ...coordinateEvent } : undefined
  }

  const loadMap = (
    mapId: number,
    tileX: number,
    tileZ: number,
    direction: PlayerDirection = 'south',
    locomotion: PlayerLocomotionMode = 'walking',
    referenceGroundHeight?: number,
  ): WorldState | undefined => {
    const map = resolveMap(mapId)
    if (!map) return undefined
    const restoredLocomotion = locomotion === 'cycling' && !map.header.bikeAllowed ? 'walking' : locomotion
    playerOnRaisedBridge = restoreHgssBridgeLayer(getTerrainAttribute(map, tileX, tileZ), restoredLocomotion)
    const restoredGroundHeight = getGroundHeight(map, tileX, tileZ, referenceGroundHeight, playerOnRaisedBridge)
    const nativeGroundLayer = referenceGroundHeight === undefined && resolveGymmickHeight?.(map.id, tileX, tileZ) === undefined
      ? resolveMapGroundLayer(map, tileX, tileZ)
      : undefined
    const groundHeight = referenceGroundHeight === undefined
      && restoredLocomotion === 'surfing'
      && isSurfableMetatile(getTerrainAttribute(map, tileX, tileZ))
      ? nativeGroundLayer?.lowestHeight ?? restoredGroundHeight
      : restoredGroundHeight
    state = { map, tileX, tileZ, direction, locomotion: restoredLocomotion, groundHeight }
    followerYieldTarget = undefined
    initializeObjectPositions(map)
    positionFollowerBehindPlayer()
    return state
  }

  const getState = (): WorldState | undefined => state

  const inspectPlayerTile = (
    mapId: number,
    tileX: number,
    tileZ: number,
    options: PlayerTileInspectionOptions = {},
  ): PlayerTileInspection | undefined => {
    if (!state
      || state.map.id !== mapId
      || !Number.isSafeInteger(mapId)
      || !Number.isSafeInteger(tileX)
      || !Number.isSafeInteger(tileZ)) return undefined
    const locomotion = options.locomotion ?? state.locomotion
    if (locomotion !== 'walking' && locomotion !== 'cycling' && locomotion !== 'surfing') return undefined
    if (options.referenceGroundHeight !== undefined && !Number.isFinite(options.referenceGroundHeight)) return undefined

    try {
      const map = state.map
      const insideBounds = isInsideMovementBounds(map, tileX, tileZ)
      if (!insideBounds) {
        return Object.freeze({
          mapId,
          tileX,
          tileZ,
          insideBounds: false,
          terrainBlocked: false,
          npcOccupied: false,
          dynamicActorOccupied: false,
          blocked: true,
          blockedReason: 'bounds' as const,
        })
      }

      const origin = getMapOrigin(map)
      const worldX = origin.x + tileX
      const worldZ = origin.z + tileZ
      const terrainAttribute = getTerrainAttribute(map, tileX, tileZ)
      const referenceGroundHeight = options.referenceGroundHeight ?? state.groundHeight
      const raisedBridge = restoreHgssBridgeLayer(terrainAttribute, locomotion)
      const groundHeight = getGroundHeight(map, tileX, tileZ, referenceGroundHeight, raisedBridge)
      const terrainBlocked = isBlockedTerrainAtWorld(
        map,
        tileX,
        tileZ,
        worldX,
        worldZ,
        locomotion,
        referenceGroundHeight,
        raisedBridge,
      )
      const npcOccupied = findNpcAtWorld(map, worldX, worldZ) !== undefined
      const dynamicActorOccupied = extensionPorts.dynamicActors.getBlockingActorsAt(mapId, tileX, tileZ).length > 0
      const blockedReason: PlayerTileBlockedReason | undefined = terrainBlocked
        ? 'terrain'
        : npcOccupied
          ? 'npc'
          : dynamicActorOccupied ? 'dynamic-actor' : undefined
      return Object.freeze({
        mapId,
        tileX,
        tileZ,
        insideBounds: true,
        ...(terrainAttribute !== undefined ? { terrainAttribute } : {}),
        ...(groundHeight !== undefined ? { groundHeight } : {}),
        terrainBlocked,
        npcOccupied,
        dynamicActorOccupied,
        blocked: blockedReason !== undefined,
        ...(blockedReason ? { blockedReason } : {}),
      })
    } catch {
      return undefined
    }
  }

  const isAuthoritativePosition = (value: unknown): value is AuthoritativePlayerStepPosition => {
    if (!value || typeof value !== 'object') return false
    const position = value as Partial<AuthoritativePlayerStepPosition>
    return Number.isSafeInteger(position.mapId)
      && Number.isSafeInteger(position.x)
      && Number.isSafeInteger(position.z)
      && hgssPlayerDirections.includes(position.direction as PlayerDirection)
  }

  const applyAuthoritativePlayerStep = (
    step: AuthoritativePlayerStep,
  ): AuthoritativePlayerMoveResult | undefined => {
    if (!state || state.locomotion !== 'walking' || !step || typeof step !== 'object') return undefined
    if (!isAuthoritativePosition(step.from)
      || !isAuthoritativePosition(step.to)
      || step.movement !== 'walk' && step.movement !== 'run'
      || step.from.mapId !== state.map.id
      || step.to.mapId !== state.map.id
      || step.from.mapId !== step.to.mapId
      || step.from.x !== state.tileX
      || step.from.z !== state.tileZ
      || step.from.direction !== state.direction) return undefined

    const deltaX = step.to.x - step.from.x
    const deltaZ = step.to.z - step.from.z
    const expectedDelta = ({
      north: [0, -1],
      south: [0, 1],
      west: [-1, 0],
      east: [1, 0],
    } satisfies Record<PlayerDirection, readonly [number, number]>)[step.to.direction]
    if (Math.abs(deltaX) + Math.abs(deltaZ) !== 1
      || deltaX !== expectedDelta[0]
      || deltaZ !== expectedDelta[1]) return undefined

    let targetGroundHeight: number | undefined
    let targetRaisedBridge: boolean
    try {
      if (!isInsideMovementBounds(state.map, step.to.x, step.to.z)) return undefined
      const targetAttribute = getTerrainAttribute(state.map, step.to.x, step.to.z)
      targetRaisedBridge = advanceHgssBridgeLayer(playerOnRaisedBridge, targetAttribute)
      targetGroundHeight = getGroundHeight(
        state.map,
        step.to.x,
        step.to.z,
        state.groundHeight,
        targetRaisedBridge,
      )
    } catch {
      return undefined
    }

    const previousState = state
    const nextState: WorldState = {
      map: previousState.map,
      tileX: step.to.x,
      tileZ: step.to.z,
      direction: step.to.direction,
      locomotion: previousState.locomotion,
      groundHeight: targetGroundHeight,
    }
    const nextFollower: FollowerWorldState | undefined = followerEnabled
      ? {
          map: previousState.map,
          tileX: previousState.tileX,
          tileZ: previousState.tileZ,
          direction: step.to.direction,
          groundHeight: previousState.groundHeight,
        }
      : followerState

    state = nextState
    playerOnRaisedBridge = targetRaisedBridge
    if (followerEnabled) followerState = nextFollower
    followerYieldTarget = undefined
    return { kind: 'moved', state: nextState, movement: step.movement }
  }

  const applyAuthoritativePlayerTransition = (
    transition: AuthoritativePlayerTransition,
  ): AuthoritativePlayerTransitionResult | undefined => {
    if (!state || state.locomotion !== 'walking' || !transition || typeof transition !== 'object') return undefined
    if (!isAuthoritativePosition(transition.from)
      || !isAuthoritativePosition(transition.to)
      || transition.movement !== 'walk' && transition.movement !== 'run'
      || transition.from.mapId !== state.map.id
      || transition.from.x !== state.tileX
      || transition.from.z !== state.tileZ
      || transition.from.direction !== state.direction) return undefined

    const destination = resolveMap(transition.to.mapId)
    if (!destination) return undefined
    let targetGroundHeight: number | undefined
    let targetRaisedBridge: boolean
    try {
      if (!isInsideMovementBounds(destination, transition.to.x, transition.to.z)) return undefined
      const targetAttribute = getTerrainAttribute(destination, transition.to.x, transition.to.z)
      targetRaisedBridge = restoreHgssBridgeLayer(targetAttribute, 'walking')
      targetGroundHeight = getGroundHeight(
        destination,
        transition.to.x,
        transition.to.z,
        state.groundHeight,
        targetRaisedBridge,
      )
    } catch {
      return undefined
    }

    const nextState: WorldState = {
      map: destination,
      tileX: transition.to.x,
      tileZ: transition.to.z,
      direction: transition.to.direction,
      locomotion: 'walking',
      groundHeight: targetGroundHeight,
    }
    state = nextState
    playerOnRaisedBridge = targetRaisedBridge
    initializeObjectPositions(destination)
    positionFollowerBehindPlayer()
    followerYieldTarget = undefined
    return { kind: 'transitioned', state: nextState, movement: transition.movement }
  }

  const refreshMapVariant = (): WorldState | undefined => {
    if (!state) return undefined
    const map = resolveMap(state.map.id)
    if (!map) return undefined
    state = {
      ...state,
      map,
      groundHeight: getGroundHeight(map, state.tileX, state.tileZ, state.groundHeight),
    }
    if (followerState?.map.id === map.id) {
      followerState = {
        ...followerState,
        map,
        groundHeight: getGroundHeight(map, followerState.tileX, followerState.tileZ, followerState.groundHeight),
      }
    }
    return state
  }

  const setLocomotion = (locomotion: PlayerLocomotionMode): WorldState | undefined => {
    if (!state) return undefined
    if (locomotion === 'cycling' && !state.map.header.bikeAllowed) return state
    state = { ...state, locomotion }
    return state
  }

  const getTerrainAttributeAt = (tileX: number, tileZ: number): number | undefined => {
    if (!state) return undefined
    const resolved = resolveLocalPosition(tileX, tileZ)
    return resolved ? getTerrainAttribute(resolved.map, resolved.tileX, resolved.tileZ) : undefined
  }

  const getFacingTerrainAttribute = (): number | undefined => {
    if (!state) return undefined
    const delta: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }
    const [deltaX, deltaZ] = delta[state.direction]
    return getTerrainAttributeAt(state.tileX + deltaX, state.tileZ + deltaZ)
  }

  const isFacingSurfableSurface = (): boolean => {
    if (!state) return false
    const standingAttribute = getTerrainAttribute(state.map, state.tileX, state.tileZ)
    if ((playerOnRaisedBridge && isHgssBridgeMetatile(standingAttribute))
      || (isSurfableMetatile(standingAttribute) && !isMapLowestGroundLayer(state.map, state.tileX, state.tileZ, state.groundHeight))) return false
    const delta: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }
    const [deltaX, deltaZ] = delta[state.direction]
    const facing = resolveLocalPosition(state.tileX + deltaX, state.tileZ + deltaZ)
    if (!facing) return false
    const facingAttribute = getTerrainAttribute(facing.map, facing.tileX, facing.tileZ)
    return !isWaterfallMetatile(facingAttribute)
      && isSurfableMetatile(facingAttribute)
      && isMapLowestGroundLayer(facing.map, facing.tileX, facing.tileZ, state.groundHeight)
  }

  const setFollowerEnabled = (enabled: boolean): void => {
    if (enabled === followerEnabled && (enabled ? followerState !== undefined : followerState === undefined)) return
    followerEnabled = enabled
    followerYieldTarget = undefined
    positionFollowerBehindPlayer()
  }

  const getFollowerState = (): FollowerWorldState | undefined => followerState

  const getFollowerInteractionEnvironment = (): FollowerInteractionEnvironment | undefined => {
    if (!state || !followerState || followerState.map.id !== state.map.id) return undefined
    const origin = getMapOrigin(state.map)
    const playerWorldX = origin.x + state.tileX
    const playerWorldZ = origin.z + state.tileZ
    let nearbyObjectCount = 0
    for (const object of state.map.events?.objects ?? []) {
      if (object.id === hgssFollowerObjectId || object.id === 0xff || [0x54, 0x55, 0x56].includes(object.spriteId)) continue
      if ((object.eventFlag !== 0 && flags.has(object.eventFlag)) || hiddenObjectIds.has(object.id)) continue
      const position = objectPositions.get(object.id) ?? object
      if (Math.abs(playerWorldX - position.x) <= 1 && Math.abs(playerWorldZ - position.z) <= 1) nearbyObjectCount += 1
    }
    const hiddenItemCount = (state.map.events?.backgrounds ?? []).filter((background) => (
      background.type === 2
      && background.scriptId >= 8000
      && !flags.has(background.scriptId - 8000 + 800)
    )).length
    return {
      mapId: state.map.header.mapId,
      mapSection: state.map.header.mapSection,
      weather: state.map.header.weather,
      metatileBehavior: (getTerrainAttribute(followerState.map, followerState.tileX, followerState.tileZ) ?? 0) & tileBehaviorMask,
      nearbyObjectCount,
      hiddenItemCount,
      facingDirection: followerState.direction,
    }
  }

  const restoreFollowerState = (saved: SavedFollowerWorldState): FollowerWorldState | undefined => {
    if (!state) return undefined
    followerEnabled = true
    followerState = {
      map: state.map,
      ...saved,
      groundHeight: getGroundHeight(state.map, saved.tileX, saved.tileZ, state.groundHeight),
    }
    return followerState
  }

  const configureFollower = (offsetDirection: number, facingDirection: number): FollowerWorldState | undefined => {
    if (!state || !followerEnabled) return undefined
    const directions = hgssPlayerDirections
    const offset = directions[offsetDirection]
    const direction = directions[facingDirection]
    if (!offset || !direction) throw new Error(`Parametres follower ROM invalides: ${offsetDirection}, ${facingDirection}.`)
    const deltas: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }
    const [deltaX, deltaZ] = deltas[offset]
    const tileX = state.tileX + deltaX
    const tileZ = state.tileZ + deltaZ
    followerState = {
      map: state.map,
      tileX,
      tileZ,
      direction,
      groundHeight: getGroundHeight(state.map, tileX, tileZ, state.groundHeight),
    }
    return followerState
  }

  const applyFollowerScriptMovement = (movementId: number): { state: FollowerWorldState, movement: FollowerScriptMovement } | undefined => {
    if (!followerState || !followerEnabled) return undefined
    const movement = resolveFollowerScriptMovement(movementId)
    if (!movement) throw new Error(`Mouvement follower ROM ${movementId} non decode.`)
    followerState = {
      ...followerState,
      movement: movementId,
    }
    return { state: followerState, movement }
  }

  const setDirection = (direction: PlayerDirection): void => {
    if (state) state = { ...state, direction }
  }

  const setObjectState = (objectId: number, x?: number, z?: number, direction?: PlayerDirection): void => {
    if (!state) return
    if (objectId === 255) {
      const origin = getMapOrigin(state.map)
      const tileX = x === undefined ? state.tileX : x - origin.x
      const tileZ = z === undefined ? state.tileZ : z - origin.z
      playerOnRaisedBridge = advanceHgssBridgeLayer(playerOnRaisedBridge, getTerrainAttribute(state.map, tileX, tileZ))
      state = {
        ...state,
        tileX,
        tileZ,
        direction: direction ?? state.direction,
        groundHeight: getGroundHeight(state.map, tileX, tileZ, state.groundHeight, playerOnRaisedBridge),
      }
      return
    }
    if (objectId === hgssFollowerObjectId && followerState) {
      const origin = getMapOrigin(followerState.map)
      const tileX = x === undefined ? followerState.tileX : x - origin.x
      const tileZ = z === undefined ? followerState.tileZ : z - origin.z
      followerState = {
        ...followerState,
        tileX,
        tileZ,
        direction: direction ?? followerState.direction,
        groundHeight: getGroundHeight(followerState.map, tileX, tileZ, followerState.groundHeight),
      }
      return
    }
    const object = objectPositions.get(objectId)
    if (!object) return
    if (x !== undefined) object.x = x
    if (z !== undefined) object.z = z
    if (direction !== undefined) object.direction = direction
  }

  const syncDaycareObjects = (objects: Array<{ objectId: 250 | 251, x: number, z: number }>): void => {
    if (!state) return
    for (const objectId of daycareObjectIds) objectPositions.delete(objectId)
    daycareObjectIds.clear()
    const origin = getMapOrigin(state.map)
    for (const object of objects) {
      daycareObjectIds.add(object.objectId)
      objectPositions.set(object.objectId, {
        x: origin.x + object.x,
        z: origin.z + object.z,
        direction: 'south',
      })
    }
  }

  const tryMoveObject = (objectId: number, direction: PlayerDirection): { tileX: number, tileZ: number } | undefined => {
    if (!state) return undefined
    const object = objectPositions.get(objectId)
    if (!object) return undefined
    const delta: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }
    const [deltaX, deltaZ] = delta[direction]
    const worldX = object.x + deltaX
    const worldZ = object.z + deltaZ
    const resolved = resolveWorldPosition(worldX, worldZ)
    object.direction = direction
    if (!resolved || resolved.map.id !== state.map.id || !isInsideMovementBounds(resolved.map, resolved.tileX, resolved.tileZ)) return undefined
    const attribute = getTerrainAttribute(resolved.map, resolved.tileX, resolved.tileZ)
    const ledgeDirection = getLedgeDirection(attribute)
    if (isBlockedTerrainAtWorld(resolved.map, resolved.tileX, resolved.tileZ, worldX, worldZ) || (ledgeDirection !== undefined && ledgeDirection !== direction)) return undefined
    const origin = getMapOrigin(state.map)
    if (origin.x + state.tileX === worldX && origin.z + state.tileZ === worldZ) return undefined
    const occupied = [...objectPositions].some(([candidateId, candidate]) => candidateId !== objectId
      && candidate.x === worldX && candidate.z === worldZ
      && !hiddenObjectIds.has(candidateId))
    if (occupied) return undefined
    object.x = worldX
    object.z = worldZ
    return { tileX: resolved.tileX, tileZ: resolved.tileZ }
  }

  const pushStrengthBoulder = (objectId: number, direction: PlayerDirection): { tileX: number, tileZ: number, fell: boolean } | undefined => {
    if (!state) return undefined
    const source = state.map.events?.objects.find((object) => object.id === objectId)
    const object = objectPositions.get(objectId)
    if (!source || !object || !isPushableStrengthBoulder(source)) return undefined
    const [deltaX, deltaZ] = ({
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    } satisfies Record<PlayerDirection, readonly [number, number]>)[direction]
    const worldX = object.x + deltaX
    const worldZ = object.z + deltaZ
    const resolved = resolveWorldPosition(worldX, worldZ)
    object.direction = direction
    if (!resolved || resolved.map.id !== state.map.id) return undefined
    const isHole = findStrengthHoleTiles(state.map).has(`${resolved.tileX}:${resolved.tileZ}`)
    if (!isHole) {
      const pushed = tryMoveObject(objectId, direction)
      return pushed && { ...pushed, fell: false }
    }
    const fall = resolveStrengthBoulderFall(maps, state.map, source, resolved.tileX, resolved.tileZ)
    if (!fall) return undefined
    const playerOrigin = getMapOrigin(state.map)
    if (playerOrigin.x + state.tileX === worldX && playerOrigin.z + state.tileZ === worldZ) return undefined
    if (findMapObjectAtWorld(state.map, worldX, worldZ, objectId)) return undefined
    object.x = worldX
    object.z = worldZ
    flags.add(fall.sourceEventFlag)
    flags.delete(fall.targetEventFlag)
    return { tileX: resolved.tileX, tileZ: resolved.tileZ, fell: true }
  }

  /**
   * Reproduit le mécanisme global des blocs de glace HGSS (SPRITE_ICE).
   * Un bloc encore orienté au sud glisse jusqu'au dernier carreau de glace;
   * après le choc il passe au nord et ne peut plus être poussé. Deux blocs
   * qui se rencontrent sont tous les deux verrouillés par la même opération.
   */
  const slideIceBlock = (objectId: number, direction: PlayerDirection): WorldObjectMovement[] | undefined => {
    if (!state) return undefined
    const object = objectPositions.get(objectId)
    if (!object || object.direction !== 'south') return undefined
    const [deltaX, deltaZ] = ({
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    } satisfies Record<PlayerDirection, readonly [number, number]>)[direction]
    let distance = 0
    let finalResolved = resolveWorldPosition(object.x, object.z)
    const movements: WorldObjectMovement[] = []

    for (let step = 0; step < 64; step += 1) {
      const worldX = object.x + deltaX
      const worldZ = object.z + deltaZ
      const resolved = resolveWorldPosition(worldX, worldZ)
      if (!resolved || resolved.map.id !== state.map.id || !isInsideMovementBounds(resolved.map, resolved.tileX, resolved.tileZ)) break
      const attribute = getTerrainAttribute(resolved.map, resolved.tileX, resolved.tileZ)
      if (!isIceMetatile(attribute) || isBlockedTerrainAtWorld(resolved.map, resolved.tileX, resolved.tileZ, worldX, worldZ)) break
      const collision = findMapObjectAtWorld(resolved.map, worldX, worldZ, objectId)
      if (collision) {
        if (collision.spriteId === hgssSlidingIceBlockSpriteId) {
          const collidedPosition = objectPositions.get(collision.id)
          if (collidedPosition) {
            collidedPosition.direction = 'north'
            movements.push({
              objectId: collision.id,
              kind: 'ice-block-slide',
              direction,
              finalDirection: 'north',
              distance: 0,
              worldX: collidedPosition.x,
              worldZ: collidedPosition.z,
              tileX: resolved.tileX,
              tileZ: resolved.tileZ,
            })
          }
        }
        break
      }
      const origin = getMapOrigin(state.map)
      if (origin.x + state.tileX === worldX && origin.z + state.tileZ === worldZ) break
      object.x = worldX
      object.z = worldZ
      finalResolved = resolved
      distance += 1
    }

    object.direction = 'north'
    if (!finalResolved) return undefined
    movements.unshift({
      objectId,
      kind: 'ice-block-slide',
      direction,
      finalDirection: 'north',
      distance,
      worldX: object.x,
      worldZ: object.z,
      tileX: finalResolved.tileX,
      tileZ: finalResolved.tileZ,
    })
    return movements
  }

  const tryMove = (deltaX: number, deltaZ: number, direction: PlayerDirection, context: PlayerMoveContext = {}): WorldMoveResult | undefined => {
    if (!state) return undefined
    const previousState = state
    const currentMapId = state.map.id
    setDirection(direction)
    if (context.enforceTurn && !context.forced && previousState.direction !== direction) {
      const turnTarget = resolveLocalPosition(previousState.tileX + deltaX, previousState.tileZ + deltaZ)
      if (turnTarget && followerState?.map.id === turnTarget.map.id
        && followerState.tileX === turnTarget.tileX && followerState.tileZ === turnTarget.tileZ) {
        followerYieldTarget = `${turnTarget.map.id}:${turnTarget.tileX}:${turnTarget.tileZ}`
      } else {
        followerYieldTarget = undefined
      }
      return { kind: 'turned', state: state!, movement: 'turn' }
    }
    const standingAttribute = getTerrainAttribute(previousState.map, previousState.tileX, previousState.tileZ)
    const standingPosition = resolveLocalPosition(previousState.tileX, previousState.tileZ)
    const standingWarp = standingPosition
      ? findWarpAtWorld(standingPosition.map, standingPosition.worldX, standingPosition.worldZ)
      : undefined
    const currentWarpActivation = standingWarp
      ? resolveHgssWarpActivation(standingAttribute, direction, 'current-held')
      : undefined
    if (standingWarp && currentWarpActivation) {
      return {
        kind: 'moved',
        state: state!,
        movement: resolvePlayerMovementKind(previousState.locomotion, standingAttribute, Boolean(context.running), Boolean(context.forced)),
        warp: standingWarp,
        warpActivation: currentWarpActivation,
      }
    }
    const adjacent = resolveLocalPosition(state.tileX + deltaX, state.tileZ + deltaZ)
    if (!adjacent) return { kind: 'blocked', reason: 'bounds', tileX: state.tileX + deltaX, tileZ: state.tileZ + deltaZ }
    const adjacentAttribute = getTerrainAttribute(adjacent.map, adjacent.tileX, adjacent.tileZ)
    // `forced` couvre la glace et les tapis, pas une capacite terrain. Une
    // Cascade n'est franchie qu'ensuite par le mouvement du script standard
    // 10005, apres ses controles de badge, de capacite et de confirmation.
    if (isWaterfallSurfaceAt(previousState.map, previousState.tileX, previousState.tileZ, standingAttribute, previousState.groundHeight, playerOnRaisedBridge)
      || isWaterfallSurfaceAt(adjacent.map, adjacent.tileX, adjacent.tileZ, adjacentAttribute, previousState.groundHeight)) {
      return { kind: 'blocked', reason: 'terrain', tileX: adjacent.tileX, tileZ: adjacent.tileZ, attribute: adjacentAttribute }
    }
    const ledgeDirection = getLedgeDirection(adjacentAttribute)
    if (ledgeDirection !== undefined && ledgeDirection !== direction) {
      return { kind: 'blocked', reason: 'terrain', tileX: adjacent.tileX, tileZ: adjacent.tileZ, attribute: adjacentAttribute }
    }
    const cardinalDelta: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }
    const expectedDelta = cardinalDelta[direction]
    const jumpingLedge = ledgeDirection === direction && deltaX === expectedDelta[0] && deltaZ === expectedDelta[1]
    const resolved = jumpingLedge
      ? resolveLocalPosition(state.tileX + deltaX * 2, state.tileZ + deltaZ * 2)
      : adjacent
    if (!resolved) return { kind: 'blocked', reason: 'bounds', tileX: state.tileX + deltaX * 2, tileZ: state.tileZ + deltaZ * 2 }
    if (!isInsideMovementBounds(resolved.map, resolved.tileX, resolved.tileZ)) {
      return { kind: 'blocked', reason: 'bounds', tileX: resolved.tileX, tileZ: resolved.tileZ }
    }
    const warp = findWarpAtWorld(resolved.map, resolved.worldX, resolved.worldZ)
    const npcEvent = findNpcAtWorld(resolved.map, resolved.worldX, resolved.worldZ)
    const dynamicActor = extensionPorts.dynamicActors.getBlockingActorsAt(resolved.map.id, resolved.tileX, resolved.tileZ)[0]
    const coordinate = findCoordinateEventAtWorld(resolved.map, resolved.worldX, resolved.worldZ)
    const sourceGroundHeight = state.groundHeight ?? getGroundHeight(state.map, state.tileX, state.tileZ)
    const attribute = getTerrainAttribute(resolved.map, resolved.tileX, resolved.tileZ)
    const targetRaisedBridge = advanceHgssBridgeLayer(playerOnRaisedBridge, attribute)
    // Une destination de saut peut differer de la case adjacente inspectee
    // ci-dessus. Elle ne doit pas contourner le meme verrou Cascade.
    if (isWaterfallSurfaceAt(resolved.map, resolved.tileX, resolved.tileZ, attribute, sourceGroundHeight, targetRaisedBridge)) {
      return { kind: 'blocked', reason: 'terrain', tileX: resolved.tileX, tileZ: resolved.tileZ, attribute }
    }
    const followerTargetKey = `${resolved.map.id}:${resolved.tileX}:${resolved.tileZ}`
    const swappingWithFollower = followerState?.map.id === resolved.map.id
      && followerState.tileX === resolved.tileX && followerState.tileZ === resolved.tileZ
    const facingDoorActivation = !jumpingLedge && warp
      ? resolveHgssWarpActivation(attribute, direction, 'facing-door')
      : undefined
    // Seul TILE_BEHAVIOR_DOOR (105) est une transition depuis la case regardee.
    // Les objets de scenario et le suiveur restent prioritaires afin qu'une
    // porte occupee ne puisse jamais servir de raccourci a travers un verrou.
    if (warp && facingDoorActivation) {
      if (npcEvent) return { kind: 'blocked', reason: 'npc', tileX: resolved.tileX, tileZ: resolved.tileZ, event: npcEvent }
      if (dynamicActor) return { kind: 'blocked', reason: 'dynamic-actor', tileX: resolved.tileX, tileZ: resolved.tileZ, dynamicActor }
      if (swappingWithFollower && followerYieldTarget !== followerTargetKey) {
        followerYieldTarget = followerTargetKey
        return { kind: 'blocked', reason: 'follower', tileX: resolved.tileX, tileZ: resolved.tileZ }
      }
      if (!swappingWithFollower) followerYieldTarget = undefined
      const door = resolveMapPropAnimationMetadata
        ? resolveDoorTransitionDescriptor(
          state.tileX,
          state.tileZ,
          state.map.model?.mapProps ?? [],
          (modelId) => resolveDoorMetadataForMap(state!.map, resolveMapPropAnimationMetadata, modelId),
          'entry',
          (prop) => resolveDoorPropPosition(state!.map, prop),
        )
        : undefined
      const movement = resolvePlayerMovementKind(previousState.locomotion, adjacentAttribute, Boolean(context.running), Boolean(context.forced))
      return { kind: 'moved', state: state!, movement, warp, warpActivation: facingDoorActivation, door }
    }
    const hasSceneGround = Boolean(
      resolved.map.terrain?.collisionPlates?.length
      || resolved.map.model?.surfaces?.length,
    )
    const targetGroundHeight = hasSceneGround
      ? getGroundHeight(resolved.map, resolved.tileX, resolved.tileZ, sourceGroundHeight, targetRaisedBridge)
      : undefined
    if (isBlockedTerrainAtWorld(resolved.map, resolved.tileX, resolved.tileZ, resolved.worldX, resolved.worldZ, previousState.locomotion, sourceGroundHeight, targetRaisedBridge)) {
      return { kind: 'blocked', reason: 'terrain', tileX: resolved.tileX, tileZ: resolved.tileZ, attribute }
    }
    let objectMovements: WorldObjectMovement[] | undefined
    if (npcEvent) {
      const objectEvent = findMapObjectAtWorld(resolved.map, resolved.worldX, resolved.worldZ)
      if (objectEvent?.spriteId === hgssSlidingIceBlockSpriteId && context.forced) {
        objectMovements = slideIceBlock(objectEvent.id, direction)
        if (objectMovements) {
          return { kind: 'blocked', reason: 'npc', tileX: resolved.tileX, tileZ: resolved.tileZ, event: npcEvent, objectMovements }
        }
      }
      if (objectEvent && isPushableStrengthBoulder(objectEvent) && flags.has(hgssStrengthActiveFlag) && !jumpingLedge) {
        const object = objectPositions.get(objectEvent.id)
        const startX = object?.x
        const startZ = object?.z
        const pushed = pushStrengthBoulder(objectEvent.id, direction)
        if (pushed && object && startX !== undefined && startZ !== undefined) {
          objectMovements = [{
            objectId: objectEvent.id,
            kind: pushed.fell ? 'strength-fall' : 'strength-push',
            direction,
            finalDirection: direction,
            distance: Math.abs(object.x - startX) + Math.abs(object.z - startZ),
            worldX: object.x,
            worldZ: object.z,
            tileX: pushed.tileX,
            tileZ: pushed.tileZ,
          }]
        } else {
          return { kind: 'blocked', reason: 'npc', tileX: resolved.tileX, tileZ: resolved.tileZ, event: npcEvent }
        }
      } else {
        return { kind: 'blocked', reason: 'npc', tileX: resolved.tileX, tileZ: resolved.tileZ, event: npcEvent }
      }
    }
    if (dynamicActor) return { kind: 'blocked', reason: 'dynamic-actor', tileX: resolved.tileX, tileZ: resolved.tileZ, dynamicActor }
    if (swappingWithFollower && followerYieldTarget !== followerTargetKey) {
      followerYieldTarget = followerTargetKey
      return { kind: 'blocked', reason: 'follower', tileX: resolved.tileX, tileZ: resolved.tileZ }
    }
    if (!swappingWithFollower) followerYieldTarget = undefined
    const targetIsSurfable = isSurfableMetatile(attribute)
      && !targetRaisedBridge
      && isMapLowestGroundLayer(resolved.map, resolved.tileX, resolved.tileZ, sourceGroundHeight)
    const locomotion = previousState.locomotion === 'surfing' && !targetIsSurfable
      ? 'walking'
      : previousState.locomotion
    state = { map: resolved.map, tileX: resolved.tileX, tileZ: resolved.tileZ, direction, locomotion, groundHeight: targetGroundHeight }
    playerOnRaisedBridge = targetRaisedBridge
    if (resolved.map.id !== currentMapId) initializeObjectPositions(resolved.map)
    if (followerEnabled) {
      followerState = swappingWithFollower
        ? { ...previousState, direction }
        : resolved.map.id === previousState.map.id
        ? { ...previousState, direction }
        : undefined
      if (!followerState) positionFollowerBehindPlayer()
    }
    followerYieldTarget = undefined
    const forcedDirection = getForcedSlideDirection(attribute)
    const continuationDirection = forcedDirection ?? (isIceMetatile(attribute) ? direction : undefined)
    const movementAttribute = jumpingLedge ? adjacentAttribute : attribute
    const movement = resolvePlayerMovementKind(previousState.locomotion, movementAttribute, Boolean(context.running), Boolean(context.forced))
    const completedStepWarpActivation = warp && !coordinate
      ? resolveHgssWarpActivation(attribute, direction, 'completed-step')
      : undefined
    return {
      kind: 'moved',
      state,
      movement,
      continuationDirection,
      coordinate,
      warp: completedStepWarpActivation ? warp : undefined,
      warpActivation: completedStepWarpActivation,
      objectMovements,
    }
  }

  const resolveInteraction = (): WorldInteractionResolution | undefined => {
    if (!state) return undefined
    const offsets: Record<PlayerDirection, readonly [number, number]> = {
      north: [0, -1],
      east: [1, 0],
      south: [0, 1],
      west: [-1, 0],
    }
    const [deltaX, deltaZ] = offsets[state.direction]
    const adjacent = resolveLocalPosition(state.tileX + deltaX, state.tileZ + deltaZ)
    const adjacentActionEvent = adjacent ? findNpcOrBackgroundAtWorld(adjacent.map, adjacent.worldX, adjacent.worldZ) : undefined
    // GetMetatileBehavior travaille dans le repere monde. Cette resolution
    // doit donc rester valide au bord de deux headers d'une meme matrice.
    const facingAttribute = getTerrainAttributeAt(state.tileX + deltaX, state.tileZ + deltaZ)
    const facingBehavior = (facingAttribute ?? 0) & tileBehaviorMask
    if (facingBehavior === counterTileBehavior) {
      const counterPosition = resolveLocalPosition(state.tileX + deltaX * 2, state.tileZ + deltaZ * 2)
      const counterTarget = counterPosition
        ? findEventAtWorld(counterPosition.map, counterPosition.worldX, counterPosition.worldZ)
        : undefined
      if (counterPosition && counterTarget?.kind === 'npc') {
        return {
          map: counterPosition.map,
          worldX: counterPosition.worldX,
          worldZ: counterPosition.worldZ,
          event: counterTarget,
        }
      }
    }
    if (adjacent && adjacentActionEvent) {
      return {
        map: adjacent.map,
        worldX: adjacent.worldX,
        worldZ: adjacent.worldZ,
        event: adjacentActionEvent,
      }
    }
    if (followerState && followerState.map.id === state.map.id
      && followerState.tileX === state.tileX + deltaX && followerState.tileZ === state.tileZ + deltaZ) {
      if (!adjacent) return undefined
      return {
        map: adjacent.map,
        worldX: adjacent.worldX,
        worldZ: adjacent.worldZ,
        event: { kind: 'follower' },
      }
    }
    const metatileScriptId = resolveHgssMetatileInteractionScript({
      standingBehavior: (getTerrainAttributeAt(state.tileX, state.tileZ) ?? 0) & tileBehaviorMask,
      facingBehavior,
      direction: state.direction,
      locomotion: state.locomotion,
    })
    if (metatileScriptId !== undefined) {
      // Le comportement BDHC peut decrire de l'eau sous une passerelle. Le
      // code de tuile seul ne suffit donc pas a autoriser Cascade : le joueur
      // et la tuile regardee doivent appartenir a la couche d'eau active.
      // Cette validation reste ici, au seul point qui cree l'interaction, afin
      // qu'une entree de deplacement ou de glisse ne puisse jamais la lancer.
      const waterfallLayerMismatch = metatileScriptId === hgssFieldMetatileScriptIds.waterfall && (!adjacent || !isWaterfallSurfaceAt(
        adjacent.map,
        adjacent.tileX,
        adjacent.tileZ,
        facingAttribute,
        state.groundHeight,
        playerOnRaisedBridge,
      ))
      if (!waterfallLayerMismatch && adjacent) {
        return {
          map: adjacent.map,
          worldX: adjacent.worldX,
          worldZ: adjacent.worldZ,
          event: { kind: 'metatile', scriptId: metatileScriptId, behavior: facingBehavior },
        }
      }
    }
    return undefined
  }

  const interact = (): WorldInteraction | undefined => resolveInteraction()?.event

  const applyObjectMovement = (objectId: number, actions: FieldMovementAction[], followPlayer = true): ObjectMovementResult | undefined => {
    if (!state) return
    const origin = getMapOrigin(state.map)
    const isPlayer = objectId === 255
    const position: { x: number, z: number, direction?: PlayerDirection } | undefined = isPlayer
      ? { x: origin.x + state.tileX, z: origin.z + state.tileZ }
      : objectPositions.get(objectId)
    if (!position) return
    const offsets: Partial<Record<PlayerDirection, readonly [number, number]>> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }
    const followerActions: FieldMovementAction[] = []
    let followerTarget: { x: number, z: number, direction: PlayerDirection } | undefined
    const followerCursor = followerState
      ? {
          x: getMapOrigin(followerState.map).x + followerState.tileX,
          z: getMapOrigin(followerState.map).z + followerState.tileZ,
        }
      : undefined
    const directionIndexes: Record<PlayerDirection, number> = { north: 0, south: 1, west: 2, east: 3 }
    const appendFollowerStep = (targetX: number, targetZ: number, sourceAction: FieldMovementAction): void => {
      if (!followerCursor) return
      while (followerCursor.x !== targetX || followerCursor.z !== targetZ) {
        const direction: PlayerDirection = followerCursor.x < targetX
          ? 'east'
          : followerCursor.x > targetX
            ? 'west'
            : followerCursor.z < targetZ
              ? 'south'
              : 'north'
        const sourceDirectionIndex = sourceAction.direction === undefined ? 0 : directionIndexes[sourceAction.direction]
        const actionBase = sourceAction.action - sourceDirectionIndex
        followerActions.push({
          action: actionBase + directionIndexes[direction],
          repetitions: 1,
          direction,
          tileDistance: 0,
          kind: 'walk',
        })
        const offset = offsets[direction]!
        followerCursor.x += offset[0]
        followerCursor.z += offset[1]
        followerTarget = { x: followerCursor.x, z: followerCursor.z, direction }
      }
    }
    for (const action of actions) {
      if (isPlayer && action.direction && (action.kind === 'face' || action.kind === 'walk' || action.kind === 'walkInPlace' || action.kind === 'jump')) {
        state = { ...state, direction: action.direction }
      } else if (!isPlayer && action.direction && (action.kind === 'face' || action.kind === 'walk' || action.kind === 'walkInPlace' || action.kind === 'jump')) {
        position.direction = action.direction
      }
      if ((action.kind !== 'walk' && action.kind !== 'jump') || !action.direction) continue
      const offset = offsets[action.direction]
      if (!offset) continue
      const tileDistance = action.kind === 'jump' ? action.tileDistance : 1
      if (tileDistance <= 0) continue
      for (let repetition = 0; repetition < action.repetitions; repetition += 1) {
        if (isPlayer && followerEnabled && followerState && followPlayer) {
          appendFollowerStep(position.x, position.z, action)
        }
        position.x += offset[0] * tileDistance
        position.z += offset[1] * tileDistance
        if (isPlayer) playerOnRaisedBridge = advanceHgssBridgeLayer(playerOnRaisedBridge, getTerrainAttribute(state.map, position.x - origin.x, position.z - origin.z))
      }
    }
    if (isPlayer) {
      const tileX = position.x - origin.x
      const tileZ = position.z - origin.z
      state = {
        ...state,
        tileX,
        tileZ,
        groundHeight: getGroundHeight(state.map, tileX, tileZ, state.groundHeight, playerOnRaisedBridge),
      }
      if (followerTarget) {
        const tileX = followerTarget.x - origin.x
        const tileZ = followerTarget.z - origin.z
        followerState = {
          map: state.map,
          tileX,
          tileZ,
          direction: followerTarget.direction,
          groundHeight: getGroundHeight(state.map, tileX, tileZ, followerState?.groundHeight ?? state.groundHeight),
        }
      }
    }
    return followerState && isPlayer && followPlayer
      ? { follower: followerState, followerActions }
      : undefined
  }

  const faceObjectAtPlayer = (objectId: number): PlayerDirection | undefined => {
    if (!state) return undefined
    const object = objectPositions.get(objectId)
    if (!object) return undefined
    const origin = getMapOrigin(state.map)
    const deltaX = origin.x + state.tileX - object.x
    const deltaZ = origin.z + state.tileZ - object.z
    object.direction = Math.abs(deltaX) > Math.abs(deltaZ)
      ? deltaX < 0 ? 'west' : 'east'
      : deltaZ < 0 ? 'north' : 'south'
    return object.direction
  }

  const faceFollowerAtPlayer = (): FollowerWorldState | undefined => {
    if (!state || !followerState || followerState.map.id !== state.map.id) return undefined
    const deltaX = state.tileX - followerState.tileX
    const deltaZ = state.tileZ - followerState.tileZ
    const direction: PlayerDirection = Math.abs(deltaX) > Math.abs(deltaZ)
      ? deltaX < 0 ? 'west' : 'east'
      : deltaZ < 0 ? 'north' : 'south'
    followerState = { ...followerState, direction }
    return followerState
  }

  const transitionTo = (mapId: number, anchor?: number, direction?: PlayerDirection): WorldTransitionResult => {
    const dynamicWarp = mapId === hgssDynamicWarpSentinelMapId && anchor === hgssDynamicWarpSentinelAnchor
      ? resolveDynamicWarp?.()
      : undefined
    const destinationMapId = dynamicWarp?.mapId ?? mapId
    const destination = resolveMap(destinationMapId)
    if (!destination || !state) return { kind: 'missing-map', mapId: destinationMapId }
    const dynamicWarpId = dynamicWarp?.warpId === 0xffff ? undefined : dynamicWarp?.warpId
    const anchoredEntrance = dynamicWarp
      ? dynamicWarpId === undefined ? undefined : destination.events?.warps[dynamicWarpId]
      : anchor === undefined ? undefined : destination.events?.warps[anchor]
    // L'ancre du warp source est l'indice exact de l'entrée de destination.
    // Ne pas la remplacer par la première sortie « retour » : plusieurs portes
    // d'une même carte partagent le même header mais pas le même spawn.
    const entrance = anchoredEntrance
      ?? (!dynamicWarp ? destination.events?.warps.find((warp) => warp.header === state?.map.id) : undefined)
      ?? (dynamicWarp && dynamicWarpId === undefined ? { x: dynamicWarp.x, z: dynamicWarp.z } : undefined)
    if (!entrance) return { kind: 'missing-anchor', map: destination }
    const origin = getMapOrigin(destination)
    const entranceTileX = entrance.x - origin.x
    const entranceTileZ = entrance.z - origin.z
    const entranceAttribute = getTerrainAttribute(destination, entranceTileX, entranceTileZ)
    // TILE_BEHAVIOR_DOOR (105) sélectionne dans HGSS la routine d'entrée qui
    // applique le mouvement tenu 0x0D : le joueur sort d'une case vers le sud.
    // La destination et l'orientation proviennent donc du comportement ROM.
    const isDoorArrival = (entranceAttribute ?? 0) >> 15 === 1
      && (entranceAttribute! & tileBehaviorMask) === 105
    const arrivalTileX = entranceTileX
    const arrivalTileZ = isDoorArrival ? entranceTileZ + 1 : entranceTileZ
    const arrivalAttribute = getTerrainAttribute(destination, arrivalTileX, arrivalTileZ)
    const canApplyDoorArrival = isDoorArrival
      && isInsideMovementBounds(destination, arrivalTileX, arrivalTileZ)
      && !isBlockedTerrainAttribute(arrivalAttribute)
    const arrivalDoor = canApplyDoorArrival && resolveMapPropAnimationMetadata
      ? resolveDoorTransitionDescriptor(
        entranceTileX,
        entranceTileZ,
        destination.model?.mapProps ?? [],
        (modelId) => resolveDoorMetadataForMap(destination, resolveMapPropAnimationMetadata, modelId),
        'arrival',
        (prop) => resolveDoorPropPosition(destination, prop),
      )
      : undefined
    const destinationTileX = canApplyDoorArrival ? arrivalTileX : entranceTileX
    const destinationTileZ = canApplyDoorArrival ? arrivalTileZ : entranceTileZ
    const destinationLocomotion = state.locomotion === 'cycling' && destination.header.bikeAllowed ? 'cycling' : 'walking'
    playerOnRaisedBridge = restoreHgssBridgeLayer(getTerrainAttribute(destination, destinationTileX, destinationTileZ), destinationLocomotion)
    state = {
      map: destination,
      tileX: destinationTileX,
      tileZ: destinationTileZ,
      direction: canApplyDoorArrival
        ? 'south'
        : direction ?? (dynamicWarp ? decodeHgssPlayerDirection(dynamicWarp.direction) : state.direction),
      locomotion: destinationLocomotion,
      groundHeight: getGroundHeight(destination, destinationTileX, destinationTileZ, state.groundHeight, playerOnRaisedBridge),
    }
    initializeObjectPositions(destination)
    positionFollowerBehindPlayer()
    return {
      kind: 'transitioned',
      state,
      arrival: canApplyDoorArrival ? { fromTileX: entranceTileX, fromTileZ: entranceTileZ, door: arrivalDoor } : undefined,
    }
  }

  const scriptWarpTo = (mapId: number, x: number, z: number, direction: PlayerDirection): WorldTransitionResult => {
    const destination = resolveMap(mapId)
    if (!destination || !state) return { kind: 'missing-map', mapId }
    const origin = getMapOrigin(destination)
    const tileX = x - origin.x
    const tileZ = z - origin.z
    const destinationLocomotion = state.locomotion === 'cycling' && destination.header.bikeAllowed ? 'cycling' : 'walking'
    playerOnRaisedBridge = restoreHgssBridgeLayer(getTerrainAttribute(destination, tileX, tileZ), destinationLocomotion)
    state = {
      map: destination,
      tileX,
      tileZ,
      direction,
      locomotion: destinationLocomotion,
      groundHeight: getGroundHeight(destination, tileX, tileZ, state.groundHeight, playerOnRaisedBridge),
    }
    initializeObjectPositions(destination)
    positionFollowerBehindPlayer()
    return { kind: 'transitioned', state }
  }

  return { loadMap, refreshMapVariant, getState, applyAuthoritativePlayerStep, applyAuthoritativePlayerTransition, inspectPlayerTile, setLocomotion, getTerrainAttributeAt, getFacingTerrainAttribute, isFacingSurfableSurface, setFollowerEnabled, getFollowerState, getFollowerInteractionEnvironment, restoreFollowerState, configureFollower, applyFollowerScriptMovement, completeDoorArrival, resolveScriptDoor, setDirection, setObjectState, syncDaycareObjects, tryMoveObject, tryMove, findEventAt, findEngagingTrainers, resolveInteraction, interact, findDynamicActorInteraction, applyObjectMovement, faceObjectAtPlayer, faceFollowerAtPlayer, transitionTo, scriptWarpTo }
}
