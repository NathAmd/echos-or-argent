import type { MapMatrixPreview, NitroMapPropPreview, PlayerGender } from '../../ndsTypes'
import { getMapMatrixFootprint, mapMatrixAltitudeStep, mapMatrixCellSize } from '../../rom/maps/mapFootprint'
import {
  HGSS_SAFARI_AREAS_PER_SET,
  HGSS_SAFARI_MAX_OBJECTS_PER_AREA,
  HGSS_SAFARI_OBJECT_COUNT,
  type HgssSafariAreaId,
  type HgssSafariAreaSet,
  type HgssSafariAreaSlot,
  type HgssSafariObjectId,
  type HgssSafariObjectPlacement,
  type HgssSafariObjectType,
} from './hgssSafariState'

export const HGSS_SAFARI_MAP_ID = 357 as const
export const HGSS_SAFARI_MATRIX_ID = 212 as const
export const HGSS_SAFARI_MATRIX_WIDTH = 5 as const
export const HGSS_SAFARI_MATRIX_HEIGHT = 4 as const
export const HGSS_SAFARI_AREA_COLUMNS = 3 as const
export const HGSS_SAFARI_AREA_ROWS = 2 as const
export const HGSS_SAFARI_AREA_GRID_CELL_X = 1 as const
export const HGSS_SAFARI_AREA_GRID_CELL_Z = 1 as const
export const HGSS_SAFARI_AREA_MODEL_BASE = 652 as const
export const HGSS_SAFARI_OBJECT_COLLISION_ATTRIBUTE = 0x8023 as const

/** Unites Nitro utilisees par une case terrain HGSS. */
export const HGSS_SAFARI_FIELD_UNITS_PER_TILE = 16 as const

export type HgssSafariObjectConfig = {
  objectId: HgssSafariObjectId
  /** BUILD_MODEL_* masculin, ou modele unique lorsque la disposition n'est pas genree. */
  baseModelId: number
  isAnimated: boolean
  width: 1 | 2
  height: 1 | 2
  hasGenderedLayout: boolean
  objectType: HgssSafariObjectType
  /** Banque 430. */
  nameMessageId: number
  /** Banque 430. */
  descriptionMessageId: number
}

/**
 * Transcription exacte de `sObjects` dans `unk_02097268.c`.
 * Seul le geyser possede le bit d'animation. Les modeles 207/209 ont leur
 * variante feminine immediatement apres eux dans BUILD_MODEL.
 */
export const hgssSafariObjectConfigs = [
  { objectId: 0, baseModelId: 189, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 1, nameMessageId: 14, descriptionMessageId: 38 },
  { objectId: 1, baseModelId: 190, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 1, nameMessageId: 15, descriptionMessageId: 39 },
  { objectId: 2, baseModelId: 191, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 1, nameMessageId: 16, descriptionMessageId: 40 },
  { objectId: 3, baseModelId: 192, isAnimated: false, width: 2, height: 2, hasGenderedLayout: false, objectType: 2, nameMessageId: 17, descriptionMessageId: 41 },
  { objectId: 4, baseModelId: 193, isAnimated: false, width: 2, height: 2, hasGenderedLayout: false, objectType: 2, nameMessageId: 18, descriptionMessageId: 42 },
  { objectId: 5, baseModelId: 194, isAnimated: false, width: 2, height: 2, hasGenderedLayout: false, objectType: 2, nameMessageId: 19, descriptionMessageId: 43 },
  { objectId: 6, baseModelId: 195, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 3, nameMessageId: 20, descriptionMessageId: 44 },
  { objectId: 7, baseModelId: 196, isAnimated: false, width: 2, height: 2, hasGenderedLayout: false, objectType: 3, nameMessageId: 21, descriptionMessageId: 45 },
  { objectId: 8, baseModelId: 197, isAnimated: false, width: 2, height: 2, hasGenderedLayout: false, objectType: 3, nameMessageId: 22, descriptionMessageId: 46 },
  { objectId: 9, baseModelId: 198, isAnimated: false, width: 2, height: 2, hasGenderedLayout: false, objectType: 4, nameMessageId: 23, descriptionMessageId: 47 },
  { objectId: 10, baseModelId: 199, isAnimated: true, width: 2, height: 2, hasGenderedLayout: false, objectType: 4, nameMessageId: 24, descriptionMessageId: 48 },
  { objectId: 11, baseModelId: 200, isAnimated: false, width: 2, height: 2, hasGenderedLayout: false, objectType: 4, nameMessageId: 25, descriptionMessageId: 49 },
  { objectId: 12, baseModelId: 201, isAnimated: false, width: 2, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 26, descriptionMessageId: 50 },
  { objectId: 13, baseModelId: 202, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 27, descriptionMessageId: 51 },
  { objectId: 14, baseModelId: 203, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 28, descriptionMessageId: 52 },
  { objectId: 15, baseModelId: 204, isAnimated: false, width: 2, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 29, descriptionMessageId: 53 },
  { objectId: 16, baseModelId: 205, isAnimated: false, width: 1, height: 2, hasGenderedLayout: false, objectType: 0, nameMessageId: 30, descriptionMessageId: 54 },
  { objectId: 17, baseModelId: 206, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 31, descriptionMessageId: 55 },
  { objectId: 18, baseModelId: 207, isAnimated: false, width: 1, height: 1, hasGenderedLayout: true, objectType: 0, nameMessageId: 32, descriptionMessageId: 56 },
  { objectId: 19, baseModelId: 209, isAnimated: false, width: 1, height: 1, hasGenderedLayout: true, objectType: 0, nameMessageId: 33, descriptionMessageId: 57 },
  { objectId: 20, baseModelId: 211, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 34, descriptionMessageId: 58 },
  { objectId: 21, baseModelId: 212, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 35, descriptionMessageId: 59 },
  { objectId: 22, baseModelId: 213, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 36, descriptionMessageId: 60 },
  { objectId: 23, baseModelId: 214, isAnimated: false, width: 1, height: 1, hasGenderedLayout: false, objectType: 0, nameMessageId: 37, descriptionMessageId: 61 },
] as const satisfies readonly HgssSafariObjectConfig[]

export type HgssSafariAreaCell = {
  areaSlot: HgssSafariAreaSlot
  areaId: HgssSafariAreaId
  column: number
  row: number
  matrixCellX: number
  matrixCellZ: number
  matrixCellIndex: number
  worldOriginX: number
  worldOriginZ: number
  localX: number
  localZ: number
}

export type HgssSafariCollisionTile = {
  /** Coordonnees absolues dans la matrice 212. */
  worldX: number
  worldZ: number
  /** Coordonnees dans le terrain compose de la carte 357. */
  tileX: number
  tileZ: number
  /** Index natif dans le tableau 32x32 de la parcelle. */
  areaCollisionIndex: number
  attribute: typeof HGSS_SAFARI_OBJECT_COLLISION_ATTRIBUTE
}

export type HgssSafariResolvedPlacement = {
  areaSlot: HgssSafariAreaSlot
  areaId: HgssSafariAreaId
  placementIndex: number
  placement: HgssSafariObjectPlacement
  config: HgssSafariObjectConfig
  /** Translation FX32 avant addition de la position de parcelle, exprimee ici sans le facteur FX32_ONE. */
  nativeTranslation: readonly [number, number, number]
  mapProp: NitroMapPropPreview
  collisionTiles: HgssSafariCollisionTile[]
}

function requireIntegerInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} ${value} est hors de la plage HGSS ${min}..${max}.`)
  }
  return value
}

function requireSafariAreaSet(areaSet: Pick<HgssSafariAreaSet, 'areas'>): void {
  if (areaSet.areas.length !== HGSS_SAFARI_AREAS_PER_SET) {
    throw new Error(`Un set Safari doit contenir exactement ${HGSS_SAFARI_AREAS_PER_SET} zones.`)
  }
  for (const area of areaSet.areas) {
    requireIntegerInRange(area.areaId, 0, 11, 'La zone Safari')
    if (area.placements.length > HGSS_SAFARI_MAX_OBJECTS_PER_AREA) {
      throw new Error(`La zone Safari ${area.areaId} depasse ${HGSS_SAFARI_MAX_OBJECTS_PER_AREA} Blocs.`)
    }
  }
}

function requireSafariMatrix(matrix: MapMatrixPreview): void {
  const cellCount = HGSS_SAFARI_MATRIX_WIDTH * HGSS_SAFARI_MATRIX_HEIGHT
  if (matrix.matrixIndex !== HGSS_SAFARI_MATRIX_ID) {
    throw new Error(`La matrice ${matrix.matrixIndex} n'est pas la matrice Safari ${HGSS_SAFARI_MATRIX_ID}.`)
  }
  if (matrix.width !== HGSS_SAFARI_MATRIX_WIDTH || matrix.height !== HGSS_SAFARI_MATRIX_HEIGHT) {
    throw new Error(`La matrice Safari doit mesurer ${HGSS_SAFARI_MATRIX_WIDTH}x${HGSS_SAFARI_MATRIX_HEIGHT}.`)
  }
  if (matrix.headers.length !== cellCount || matrix.altitudes.length !== cellCount || matrix.modelIds.length !== cellCount) {
    throw new Error(`Les tableaux de la matrice Safari doivent contenir ${cellCount} cellules.`)
  }
}

export function getHgssSafariObjectConfig(objectId: HgssSafariObjectId): HgssSafariObjectConfig {
  requireIntegerInRange(objectId, 0, HGSS_SAFARI_OBJECT_COUNT - 1, 'Le Bloc Safari')
  return hgssSafariObjectConfigs[objectId]!
}

export function resolveHgssSafariObjectModelId(objectId: HgssSafariObjectId, gender: PlayerGender): number {
  const config = getHgssSafariObjectConfig(objectId)
  return config.baseModelId + (config.hasGenderedLayout && gender === 'female' ? 1 : 0)
}

/** Reproduit `PlaceSafariZoneAreas`; une autre matrice est rendue sans changement. */
export function composeHgssSafariMatrix(
  matrix: MapMatrixPreview,
  areaSet: Pick<HgssSafariAreaSet, 'areas'>,
): MapMatrixPreview {
  if (matrix.matrixIndex !== HGSS_SAFARI_MATRIX_ID) return matrix
  requireSafariMatrix(matrix)
  requireSafariAreaSet(areaSet)

  const modelIds = new Uint16Array(matrix.modelIds)
  for (let areaSlot = 0; areaSlot < HGSS_SAFARI_AREAS_PER_SET; areaSlot += 1) {
    const column = areaSlot % HGSS_SAFARI_AREA_COLUMNS
    const row = Math.floor(areaSlot / HGSS_SAFARI_AREA_COLUMNS)
    const cellIndex = (row + HGSS_SAFARI_AREA_GRID_CELL_Z) * matrix.width
      + column + HGSS_SAFARI_AREA_GRID_CELL_X
    modelIds[cellIndex] = HGSS_SAFARI_AREA_MODEL_BASE + areaSet.areas[areaSlot]!.areaId
  }
  return { ...matrix, modelIds }
}

/** Cellule fixe 3x2 d'un emplacement, independamment de son identite de zone. */
export function getHgssSafariAreaCell(
  areaSet: Pick<HgssSafariAreaSet, 'areas'>,
  areaSlotValue: number,
): Omit<HgssSafariAreaCell, 'localX' | 'localZ'> {
  requireSafariAreaSet(areaSet)
  const areaSlot = requireIntegerInRange(areaSlotValue, 0, HGSS_SAFARI_AREAS_PER_SET - 1, 'L emplacement Safari') as HgssSafariAreaSlot
  const column = areaSlot % HGSS_SAFARI_AREA_COLUMNS
  const row = Math.floor(areaSlot / HGSS_SAFARI_AREA_COLUMNS)
  const matrixCellX = column + HGSS_SAFARI_AREA_GRID_CELL_X
  const matrixCellZ = row + HGSS_SAFARI_AREA_GRID_CELL_Z
  return {
    areaSlot,
    areaId: areaSet.areas[areaSlot]!.areaId,
    column,
    row,
    matrixCellX,
    matrixCellZ,
    matrixCellIndex: matrixCellZ * HGSS_SAFARI_MATRIX_WIDTH + matrixCellX,
    worldOriginX: matrixCellX * mapMatrixCellSize,
    worldOriginZ: matrixCellZ * mapMatrixCellSize,
  }
}

/**
 * Reproduit le calcul de ScrCmd_720: `(x - 32) / 32 + (z - 32) / 32 * 3`.
 * Les positions hors des six parcelles centrales ne correspondent a aucune zone.
 */
export function resolveHgssSafariAreaCellAtWorldPosition(
  areaSet: Pick<HgssSafariAreaSet, 'areas'>,
  worldX: number,
  worldZ: number,
): HgssSafariAreaCell | undefined {
  requireSafariAreaSet(areaSet)
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return undefined
  const column = Math.floor(worldX / mapMatrixCellSize) - HGSS_SAFARI_AREA_GRID_CELL_X
  const row = Math.floor(worldZ / mapMatrixCellSize) - HGSS_SAFARI_AREA_GRID_CELL_Z
  if (column < 0 || column >= HGSS_SAFARI_AREA_COLUMNS || row < 0 || row >= HGSS_SAFARI_AREA_ROWS) return undefined
  const areaSlot = (row * HGSS_SAFARI_AREA_COLUMNS + column) as HgssSafariAreaSlot
  const fixed = getHgssSafariAreaCell(areaSet, areaSlot)
  return {
    ...fixed,
    localX: worldX - fixed.worldOriginX,
    localZ: worldZ - fixed.worldOriginZ,
  }
}

export function resolveHgssSafariAreaIdAtWorldPosition(
  areaSet: Pick<HgssSafariAreaSet, 'areas'>,
  worldX: number,
  worldZ: number,
): HgssSafariAreaId | undefined {
  return resolveHgssSafariAreaCellAtWorldPosition(areaSet, worldX, worldZ)?.areaId
}

function requirePlacement(placement: HgssSafariObjectPlacement, config: HgssSafariObjectConfig): void {
  requireIntegerInRange(placement.objectId, 0, HGSS_SAFARI_OBJECT_COUNT - 1, 'Le Bloc Safari')
  if (config.objectId !== placement.objectId) {
    throw new Error(`La configuration ${config.objectId} ne correspond pas au Bloc Safari ${placement.objectId}.`)
  }
  requireIntegerInRange(placement.x, 0, mapMatrixCellSize - 1, 'La coordonnee X du Bloc Safari')
  requireIntegerInRange(placement.y, 0, 0xff, 'La coordonnee Y du Bloc Safari')
  requireIntegerInRange(placement.z, 0, mapMatrixCellSize - 1, 'La coordonnee Z du Bloc Safari')
  if (placement.x + config.width > mapMatrixCellSize || placement.z - config.height + 1 < 0) {
    throw new Error(`Le Bloc Safari ${placement.objectId} depasse sa parcelle 32x32.`)
  }
}

/** Formule exacte de `MapPropManager_LoadFromSafariZone`, avant conversion en unites web. */
export function getHgssSafariNativeObjectTranslation(
  placement: HgssSafariObjectPlacement,
  config: HgssSafariObjectConfig = getHgssSafariObjectConfig(placement.objectId),
): readonly [number, number, number] {
  requirePlacement(placement, config)
  return [
    HGSS_SAFARI_FIELD_UNITS_PER_TILE * placement.x + 8 * config.width - 0x100,
    placement.y,
    HGSS_SAFARI_FIELD_UNITS_PER_TILE * placement.z + 8 * (2 - config.height) - 0x100,
  ]
}

function getSafariMapOrigin(matrix: MapMatrixPreview): { x: number, z: number } {
  const footprint = getMapMatrixFootprint(HGSS_SAFARI_MAP_ID, matrix)
  if (!footprint) throw new Error(`La carte ${HGSS_SAFARI_MAP_ID} est absente des headers de la matrice Safari.`)
  return { x: footprint.minCellX * mapMatrixCellSize, z: footprint.minCellZ * mapMatrixCellSize }
}

export function resolveHgssSafariPlacement(
  matrix: MapMatrixPreview,
  areaSet: Pick<HgssSafariAreaSet, 'areas'>,
  areaSlotValue: number,
  placement: HgssSafariObjectPlacement,
  placementIndex: number,
  gender: PlayerGender,
): HgssSafariResolvedPlacement {
  requireSafariMatrix(matrix)
  requireIntegerInRange(placementIndex, 0, HGSS_SAFARI_MAX_OBJECTS_PER_AREA - 1, 'L index du Bloc Safari')
  const fixedCell = getHgssSafariAreaCell(areaSet, areaSlotValue)
  const config = getHgssSafariObjectConfig(placement.objectId)
  const nativeTranslation = getHgssSafariNativeObjectTranslation(placement, config)
  const mapOrigin = getSafariMapOrigin(matrix)
  const cellAltitude = (matrix.altitudes[fixedCell.matrixCellIndex] ?? 0) * mapMatrixAltitudeStep
  const worldPosition = [
    fixedCell.worldOriginX + placement.x + config.width / 2,
    placement.y / HGSS_SAFARI_FIELD_UNITS_PER_TILE + cellAltitude,
    fixedCell.worldOriginZ + placement.z + (2 - config.height) / 2,
  ] as const
  const mapProp: NitroMapPropPreview = {
    modelId: resolveHgssSafariObjectModelId(placement.objectId, gender),
    position: [worldPosition[0] - mapOrigin.x, worldPosition[1], worldPosition[2] - mapOrigin.z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    mapMatrixCellIndex: fixedCell.matrixCellIndex,
  }
  const collisionTiles: HgssSafariCollisionTile[] = []
  for (let localZ = placement.z; localZ > placement.z - config.height; localZ -= 1) {
    for (let localX = placement.x; localX < placement.x + config.width; localX += 1) {
      const worldX = fixedCell.worldOriginX + localX
      const worldZ = fixedCell.worldOriginZ + localZ
      collisionTiles.push({
        worldX,
        worldZ,
        tileX: worldX - mapOrigin.x,
        tileZ: worldZ - mapOrigin.z,
        areaCollisionIndex: localZ * mapMatrixCellSize + localX,
        attribute: HGSS_SAFARI_OBJECT_COLLISION_ATTRIBUTE,
      })
    }
  }
  return {
    areaSlot: fixedCell.areaSlot,
    areaId: fixedCell.areaId,
    placementIndex,
    placement: { ...placement },
    config,
    nativeTranslation,
    mapProp,
    collisionTiles,
  }
}

/** Convertit les six structures `SAFARIZONE_AREA` en props et patches de collision web. */
export function resolveHgssSafariAreaSetPlacements(
  matrix: MapMatrixPreview,
  areaSet: Pick<HgssSafariAreaSet, 'areas'>,
  gender: PlayerGender,
): HgssSafariResolvedPlacement[] {
  requireSafariMatrix(matrix)
  requireSafariAreaSet(areaSet)
  return areaSet.areas.flatMap((area, areaSlot) => area.placements.map((placement, placementIndex) => (
    resolveHgssSafariPlacement(matrix, areaSet, areaSlot, placement, placementIndex, gender)
  )))
}

/** Applique sans mutation les valeurs 0x8023 produites par les placements. */
export function applyHgssSafariCollisionTiles(
  baseAttributes: Uint16Array,
  terrainWidth: number,
  terrainHeight: number,
  collisionTiles: readonly HgssSafariCollisionTile[],
): Uint16Array {
  requireIntegerInRange(terrainWidth, 1, 0xffff, 'La largeur du terrain Safari')
  requireIntegerInRange(terrainHeight, 1, 0xffff, 'La hauteur du terrain Safari')
  if (baseAttributes.length !== terrainWidth * terrainHeight) {
    throw new Error(`Le terrain Safari contient ${baseAttributes.length} attributs au lieu de ${terrainWidth * terrainHeight}.`)
  }
  const attributes = new Uint16Array(baseAttributes)
  for (const tile of collisionTiles) {
    if (!Number.isInteger(tile.tileX) || !Number.isInteger(tile.tileZ)
      || tile.tileX < 0 || tile.tileX >= terrainWidth || tile.tileZ < 0 || tile.tileZ >= terrainHeight) {
      throw new Error(`La collision Safari ${tile.tileX},${tile.tileZ} sort du terrain ${terrainWidth}x${terrainHeight}.`)
    }
    attributes[tile.tileZ * terrainWidth + tile.tileX] = HGSS_SAFARI_OBJECT_COLLISION_ATTRIBUTE
  }
  return attributes
}
