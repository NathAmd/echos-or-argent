import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import { isSurfableMetatile } from '../player/hgssPlayerMovement'
import { getMapGroundHeight, getMapOrigin } from '../world/mapCoordinates'
import {
  HGSS_SAFARI_MAP_ID,
  getHgssSafariObjectConfig,
  resolveHgssSafariAreaCellAtWorldPosition,
} from './hgssSafariMap'
import {
  HGSS_SAFARI_AREA_COUNT,
  HGSS_SAFARI_MAX_OBJECTS_PER_AREA,
  cloneHgssSafariState,
  getHgssSafariObjectCategoryCounts,
  getHgssSafariUnlockedObjectIds,
  placeHgssSafariObject,
  removeHgssSafariObject,
  replaceHgssSafariArea,
  swapHgssSafariAreas,
  type HgssSafariAreaId,
  type HgssSafariAreaSlot,
  type HgssSafariObjectId,
  type HgssSafariObjectCategoryCounts,
  type HgssSafariObjectPlacement,
  type HgssSafariState,
} from './hgssSafariState'

export const HGSS_SAFARI_CUSTOMIZER_CHANGED_FLAG = 0x99d as const
export const HGSS_SAFARI_NO_OBJECT = 0xff as const
export const HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID = 8800 as const
export const HGSS_SAFARI_REMOVE_OBJECT_SCRIPT_ID = 8801 as const

export type HgssSafariCustomizerChange = {
  areas: readonly [HgssSafariAreaId, HgssSafariAreaId, HgssSafariAreaId, HgssSafariAreaId, HgssSafariAreaId, HgssSafariAreaId]
  sourceSlot: HgssSafariAreaSlot
  targetAreaId: HgssSafariAreaId
  operation: 'replace' | 'swap'
  swappedSlot?: HgssSafariAreaSlot
}

/** Codes exacts renvoyés par `ov108_021EA52C`. */
export type HgssSafariDecoratorUnavailableReason = 1 | 2 | 3 | 4

export type HgssSafariDecoratorCandidate = {
  objectId: HgssSafariObjectId
  /** Absente lorsque l'overlay ROM grise ce Bloc. */
  placement?: HgssSafariObjectPlacement
  /** Codes exacts d'overlay 108: empreinte, eau/terre, terre/eau, aire pleine. */
  unavailableReason?: HgssSafariDecoratorUnavailableReason
}

export type HgssSafariFieldStep =
  | {
    kind: 'safariCustomizer'
    areas: HgssSafariCustomizerChange['areas']
    blockCounts: readonly [
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
    ]
    showBlockCounts: boolean
  }
  | { kind: 'safariDecorator', candidates: readonly HgssSafariDecoratorCandidate[] }

export type HgssSafariRunnerControls = {
  submitSafariCustomizerChange: (change: HgssSafariCustomizerChange) => void
  closeSafariCustomizer: () => void
  submitSafariDecoratorSelection: (objectId: number | undefined) => void
}

export type HgssSafariPlayerPosition = {
  x: number
  z: number
  direction: PlayerDirection
  /** Ordonnée de PlayerAvatar_CopyPositionVector, en unités de terrain web. */
  groundHeight?: number
  /** Valeur native de PlayerAvatar_GetState; 2 signifie Surf. */
  state: number
}

const directionOffsets: Readonly<Record<PlayerDirection, readonly [number, number]>> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
}

/**
 * Reproduit les branches Safari de `GetInteractedMetatileScript`.
 *
 * Le script standard 8800 n'est pas porté par un événement de carte : HGSS le
 * synthétise à l'appui sur A à partir de l'état Safari, du terrain et de la
 * hauteur devant l'avatar. Le retrait 8801 est reconnu par le comportement 35
 * que le moteur applique à l'empreinte d'un Bloc placé.
 */
export function resolveHgssSafariMetatileInteractionScript(
  map: OpeningMapPreview,
  state: HgssSafariState,
  player: HgssSafariPlayerPosition,
): typeof HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID | typeof HGSS_SAFARI_REMOVE_OBJECT_SCRIPT_ID | undefined {
  if (!state.session.active || state.activeAreaSet !== 0) return undefined
  const terrain = map.terrain
  if (!terrain) return undefined
  const origin = getMapOrigin(map)
  const playerTileX = player.x - origin.x
  const playerTileZ = player.z - origin.z
  if (playerTileX < 0 || playerTileZ < 0 || playerTileX >= terrain.width || playerTileZ >= terrain.height) return undefined
  const standingAttribute = terrain.attributes[playerTileZ * terrain.width + playerTileX]
  if (standingAttribute === undefined || (standingAttribute & 0xff) === 34) return undefined

  const [deltaX, deltaZ] = directionOffsets[player.direction]
  const facingWorldX = player.x + deltaX
  const facingWorldZ = player.z + deltaZ
  const facingTileX = facingWorldX - origin.x
  const facingTileZ = facingWorldZ - origin.z
  if (facingTileX < 0 || facingTileZ < 0 || facingTileX >= terrain.width || facingTileZ >= terrain.height) return undefined
  const facingAttribute = terrain.attributes[facingTileZ * terrain.width + facingTileX]
  if (facingAttribute === undefined) return undefined
  const facingBehavior = facingAttribute & 0xff

  // ov02_0224E35C limite la pose à la carte intérieure du parc Safari, au
  // rectangle des six parcelles, et exige les deux hauteurs FX32 identiques.
  if (map.id === HGSS_SAFARI_MAP_ID && state.objectUnlockLevel > 0
    && resolveHgssSafariAreaCellAtWorldPosition(state.areaSets[0], facingWorldX, facingWorldZ)) {
    const playerHeight = player.groundHeight ?? getMapGroundHeight(map, playerTileX, playerTileZ)
    const facingHeight = playerHeight === undefined
      ? undefined
      : getMapGroundHeight(map, facingTileX, facingTileZ, playerHeight)
    if (playerHeight !== undefined && facingHeight !== undefined
      && sameNativeGroundHeight(playerHeight, facingHeight)
      && (facingAttribute & 0x8000) === 0) {
      const validSurface = player.state === 2
        ? isSurfableMetatile(facingAttribute)
        : facingBehavior === 0 || facingBehavior === 33 || facingBehavior === 164
      if (validSurface) return HGSS_SAFARI_PLACE_OBJECT_SCRIPT_ID
    }
  }

  // La ROM teste le retrait après la pose et ne le conditionne ni à la carte
  // 357 ni au niveau de déverrouillage : le comportement 35 fait foi.
  return facingBehavior === 35 ? HGSS_SAFARI_REMOVE_OBJECT_SCRIPT_ID : undefined
}

function requireInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} ${value} est hors de la plage HGSS ${minimum}..${maximum}.`)
  }
  return value
}

function copyArrangement(state: HgssSafariState): HgssSafariCustomizerChange['areas'] {
  const areas = state.areaSets[0].areas
  return [areas[0].areaId, areas[1].areaId, areas[2].areaId, areas[3].areaId, areas[4].areaId, areas[5].areaId]
}

function arrangementsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((areaId, index) => areaId === right[index])
}

/** Applique une opération réellement proposée par l'overlay 108, jamais un arrangement arbitraire. */
export function applyHgssSafariCustomizerChange(
  state: HgssSafariState,
  change: HgssSafariCustomizerChange,
): HgssSafariState {
  const sourceSlot = requireInteger(change.sourceSlot, 0, 5, 'L’emplacement source Safari') as HgssSafariAreaSlot
  const targetAreaId = requireInteger(change.targetAreaId, 0, HGSS_SAFARI_AREA_COUNT - 1, 'La zone cible Safari') as HgssSafariAreaId
  const current = copyArrangement(state)
  if (current[sourceSlot] === targetAreaId) throw new Error('Le customizer Safari HGSS a reçu un changement sans effet.')

  let next: HgssSafariState
  if (change.operation === 'swap') {
    const swappedSlot = requireInteger(change.swappedSlot ?? -1, 0, 5, 'L’emplacement échangé Safari') as HgssSafariAreaSlot
    if (current[swappedSlot] !== targetAreaId) {
      throw new Error(`La zone Safari ${targetAreaId} n’occupe pas l’emplacement échangé ${swappedSlot}.`)
    }
    next = swapHgssSafariAreas(state, 0, sourceSlot, swappedSlot)
  } else {
    if (change.swappedSlot !== undefined) {
      throw new Error(`Le remplacement de la zone Safari ${targetAreaId} contient un emplacement échangé inattendu.`)
    }
    next = replaceHgssSafariArea(state, 0, sourceSlot, targetAreaId)
  }
  if (!arrangementsEqual(copyArrangement(next), change.areas)) {
    throw new Error('L’arrangement soumis ne correspond pas à l’opération native du customizer Safari.')
  }
  return next
}

export function createHgssSafariCustomizerStep(state: HgssSafariState): Extract<HgssSafariFieldStep, { kind: 'safariCustomizer' }> {
  const areas = state.areaSets[0].areas
  return {
    kind: 'safariCustomizer',
    areas: copyArrangement(state),
    blockCounts: [
      getHgssSafariObjectCategoryCounts(areas[0]),
      getHgssSafariObjectCategoryCounts(areas[1]),
      getHgssSafariObjectCategoryCounts(areas[2]),
      getHgssSafariObjectCategoryCounts(areas[3]),
      getHgssSafariObjectCategoryCounts(areas[4]),
      getHgssSafariObjectCategoryCounts(areas[5]),
    ],
    showBlockCounts: state.objectUnlockLevel > 0,
  }
}

function getPlayerArea(state: HgssSafariState, player: HgssSafariPlayerPosition) {
  const cell = resolveHgssSafariAreaCellAtWorldPosition(state.areaSets[0], player.x, player.z)
  if (!cell) throw new Error(`La position ${player.x},${player.z} est hors des six parcelles Safari HGSS.`)
  return cell
}

function getAnchorCandidates(
  player: HgssSafariPlayerPosition,
  width: 1 | 2,
  height: 1 | 2,
): readonly (readonly [number, number])[] {
  const [deltaX, deltaZ] = directionOffsets[player.direction]
  const frontX = player.x + deltaX
  const frontZ = player.z + deltaZ
  if (width === 1 && height === 1) return [[frontX, frontZ]]
  if (width === 1) {
    if (player.direction === 'north') return [[frontX, frontZ]]
    if (player.direction === 'south') return [[frontX, frontZ + 1]]
    return [[frontX, player.z], [frontX, player.z + 1]]
  }
  if (height === 1) {
    if (player.direction === 'west') return [[frontX - 1, frontZ]]
    if (player.direction === 'east') return [[frontX, frontZ]]
    return [[player.x, frontZ], [player.x - 1, frontZ]]
  }
  if (player.direction === 'north') return [[player.x, frontZ], [player.x - 1, frontZ]]
  if (player.direction === 'south') return [[player.x, frontZ + 1], [player.x - 1, frontZ + 1]]
  if (player.direction === 'west') return [[frontX - 1, player.z], [frontX - 1, player.z + 1]]
  return [[frontX, player.z], [frontX, player.z + 1]]
}

function placementTiles(anchorX: number, anchorZ: number, width: 1 | 2, height: 1 | 2): Array<readonly [number, number]> {
  const tiles: Array<readonly [number, number]> = []
  for (let z = anchorZ; z > anchorZ - height; z--) {
    for (let x = anchorX; x < anchorX + width; x++) tiles.push([x, z])
  }
  return tiles
}

function overlapsExistingPlacement(
  state: HgssSafariState,
  areaSlot: HgssSafariAreaSlot,
  anchorX: number,
  anchorZ: number,
  width: 1 | 2,
  height: 1 | 2,
): boolean {
  const candidateTiles = new Set(placementTiles(anchorX, anchorZ, width, height).map(([x, z]) => `${x}:${z}`))
  return state.areaSets[0].areas[areaSlot].placements.some((placement) => {
    const config = getHgssSafariObjectConfig(placement.objectId)
    return placementTiles(placement.x, placement.z, config.width, config.height)
      .some(([x, z]) => candidateTiles.has(`${x}:${z}`))
  })
}

function sameNativeGroundHeight(left: number, right: number): boolean {
  // Les helpers ROM comparent les FX32 bit à bit; une unité web vaut 16 unités Nitro.
  return Math.round(left * 0x10000) === Math.round(right * 0x10000)
}

function resolveLocalFootprintPlacement(
  map: OpeningMapPreview,
  state: HgssSafariState,
  player: HgssSafariPlayerPosition,
  width: 1 | 2,
  height: 1 | 2,
): Omit<HgssSafariObjectPlacement, 'objectId'> | undefined {
  const terrain = map.terrain
  if (!terrain) return undefined
  const playerCell = getPlayerArea(state, player)
  const origin = getMapOrigin(map)
  const playerTileX = player.x - origin.x
  const playerTileZ = player.z - origin.z
  const playerHeight = player.groundHeight ?? getMapGroundHeight(map, playerTileX, playerTileZ)
  if (playerHeight === undefined) return undefined
  const surf = player.state === 2

  const tileIsAvailable = (worldX: number, worldZ: number): boolean => {
    const tileX = worldX - origin.x
    const tileZ = worldZ - origin.z
    if (tileX < 0 || tileZ < 0 || tileX >= terrain.width || tileZ >= terrain.height) return false
    const attribute = terrain.attributes[tileZ * terrain.width + tileX]
    const behavior = (attribute ?? 0xff) & 0xff
    if ((attribute ?? 0x8000) & 0x8000) return false
    if (surf ? !isSurfableMetatile(attribute) : behavior !== 0 && behavior !== 33 && behavior !== 164) return false
    const height = getMapGroundHeight(map, tileX, tileZ, playerHeight)
    return height !== undefined && sameNativeGroundHeight(height, playerHeight)
  }

  for (const [anchorWorldX, anchorWorldZ] of getAnchorCandidates(player, width, height)) {
    const anchorCell = resolveHgssSafariAreaCellAtWorldPosition(state.areaSets[0], anchorWorldX, anchorWorldZ)
    if (!anchorCell || anchorCell.areaSlot !== playerCell.areaSlot) continue
    const tiles = placementTiles(anchorWorldX, anchorWorldZ, width, height)
    if (!tiles.every(([worldX, worldZ]) => tileIsAvailable(worldX, worldZ))) continue
    const localX = anchorWorldX - playerCell.worldOriginX
    const localZ = anchorWorldZ - playerCell.worldOriginZ
    if (localX < 0 || localZ > 31 || localX + width > 32 || localZ - height + 1 < 0) continue
    if (overlapsExistingPlacement(state, playerCell.areaSlot, localX, localZ, width, height)) continue
    const placementY = Math.floor((playerHeight - (map.matrix.altitudes[playerCell.matrixCellIndex] ?? 0) * 8) * 16)
    if (placementY < 0 || placementY > 0xff) continue
    return { x: localX, y: placementY, z: localZ }
  }
  return undefined
}

export function createHgssSafariDecoratorStep(
  map: OpeningMapPreview,
  state: HgssSafariState,
  player: HgssSafariPlayerPosition,
  trainerId: number,
): Extract<HgssSafariFieldStep, { kind: 'safariDecorator' }> {
  const cell = getPlayerArea(state, player)
  const areaIsFull = state.areaSets[0].areas[cell.areaSlot].placements.length >= HGSS_SAFARI_MAX_OBJECTS_PER_AREA
  const surf = player.state === 2
  const objectIds = getHgssSafariUnlockedObjectIds(trainerId, state.objectUnlockLevel)
  return {
    kind: 'safariDecorator',
    candidates: objectIds.map((objectId): HgssSafariDecoratorCandidate => {
      if (areaIsFull) return { objectId, unavailableReason: 4 }
      const config = getHgssSafariObjectConfig(objectId)
      if (config.isAnimated !== surf) return { objectId, unavailableReason: surf ? 3 : 2 }
      const placement = resolveLocalFootprintPlacement(map, state, player, config.width, config.height)
      return placement ? { objectId, placement: { objectId, ...placement } } : { objectId, unavailableReason: 1 }
    }),
  }
}

export function applyHgssSafariDecoratorSelection(
  state: HgssSafariState,
  player: HgssSafariPlayerPosition,
  candidates: readonly HgssSafariDecoratorCandidate[],
  objectIdValue: number | undefined,
): {
  state: HgssSafariState
  result?: HgssSafariObjectId | typeof HGSS_SAFARI_NO_OBJECT
  unavailableReason?: HgssSafariDecoratorUnavailableReason
} {
  if (objectIdValue === undefined) return { state: cloneHgssSafariState(state), result: HGSS_SAFARI_NO_OBJECT }
  const objectId = requireInteger(objectIdValue, 0, 23, 'Le Bloc Safari sélectionné') as HgssSafariObjectId
  const candidate = candidates.find((entry) => entry.objectId === objectId)
  if (!candidate) throw new Error(`Le Bloc Safari ${objectId} n’est pas déverrouillé pour ce Dresseur.`)
  if (!candidate.placement || candidate.unavailableReason) {
    return { state: cloneHgssSafariState(state), unavailableReason: candidate.unavailableReason ?? 1 }
  }
  const areaSlot = getPlayerArea(state, player).areaSlot
  return { state: placeHgssSafariObject(state, 0, areaSlot, candidate.placement), result: objectId }
}

export function findHgssSafariObjectInFront(
  state: HgssSafariState,
  player: HgssSafariPlayerPosition,
): { objectId: HgssSafariObjectId | typeof HGSS_SAFARI_NO_OBJECT, placementIndex: number } {
  const [deltaX, deltaZ] = directionOffsets[player.direction]
  const cell = resolveHgssSafariAreaCellAtWorldPosition(state.areaSets[0], player.x + deltaX, player.z + deltaZ)
  if (!cell) return { objectId: HGSS_SAFARI_NO_OBJECT, placementIndex: 0 }
  const area = state.areaSets[0].areas[cell.areaSlot]
  for (let placementIndex = 0; placementIndex < area.placements.length; placementIndex++) {
    const placement = area.placements[placementIndex]!
    const config = getHgssSafariObjectConfig(placement.objectId)
    if (cell.localX >= placement.x && cell.localZ <= placement.z
      && cell.localX < placement.x + config.width && cell.localZ > placement.z - config.height) {
      return { objectId: placement.objectId, placementIndex }
    }
  }
  return { objectId: HGSS_SAFARI_NO_OBJECT, placementIndex: 0 }
}

export function removeHgssSafariObjectInFrontByIndex(
  state: HgssSafariState,
  player: HgssSafariPlayerPosition,
  placementIndexValue: number,
): HgssSafariState {
  const [deltaX, deltaZ] = directionOffsets[player.direction]
  const cell = resolveHgssSafariAreaCellAtWorldPosition(state.areaSets[0], player.x + deltaX, player.z + deltaZ)
  if (!cell) throw new Error('Le Bloc Safari à retirer est hors des six parcelles.')
  return removeHgssSafariObject(state, 0, cell.areaSlot, placementIndexValue)
}

function hasSurfPlacementPermission(trainerId: number, unlockLevel: number): boolean {
  requireInteger(trainerId, 0, 0xffffffff, 'L’identifiant Dresseur')
  const digit = trainerId % 10
  const group = digit < 6 ? Math.floor(digit / 3) : Math.floor((digit - 6) / 2) + 2
  return unlockLevel >= 4 - group
}

/** Codes exacts de `ov02_0224E698`: 0 valide, 1 plein, 2 verrouillé, 3 sans place. */
export function getHgssSafariDecoratorEligibility(
  map: OpeningMapPreview,
  state: HgssSafariState,
  player: HgssSafariPlayerPosition,
  trainerId: number,
): 0 | 1 | 2 | 3 {
  const cell = getPlayerArea(state, player)
  if (state.areaSets[0].areas[cell.areaSlot].placements.length >= HGSS_SAFARI_MAX_OBJECTS_PER_AREA) return 1
  if (player.state !== 2) return 0
  if (!hasSurfPlacementPermission(trainerId, state.objectUnlockLevel)) return 2
  // ov02_0224EE4C ne dépend que de l'empreinte 2x2, pas de l'identité du Bloc.
  return resolveLocalFootprintPlacement(map, state, player, 2, 2) ? 0 : 3
}

export function getHgssSafariObjectName(
  messages: Record<number, string> | undefined,
  objectIdValue: number,
): string {
  const objectId = requireInteger(objectIdValue, 0, 23, 'Le Bloc Safari à nommer') as HgssSafariObjectId
  const messageId = getHgssSafariObjectConfig(objectId).nameMessageId
  const text = messages?.[messageId]
  if (text === undefined) throw new Error(`Le nom ROM ${messageId} du Bloc Safari ${objectId} est absent de la banque 430.`)
  return text
}
