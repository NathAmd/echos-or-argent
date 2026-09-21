import type { MapMatrixPreview } from '../../ndsTypes'

export type MapMatrixCell = {
  index: number
  x: number
  z: number
  modelId: number
  altitude: number
}

// MapLoadManager multiplie l'octet d'altitude de la matrice par 0x8000 en
// FX32. Après conversion des unités terrain, cela vaut huit unités de scène.
export const mapMatrixAltitudeStep = 8

export type MapMatrixFootprint = {
  cells: MapMatrixCell[]
  minCellX: number
  maxCellX: number
  minCellZ: number
  maxCellZ: number
  widthCells: number
  heightCells: number
}

export type MapMatrixRenderWindow = {
  footprint: MapMatrixFootprint
  minCellX: number
  maxCellX: number
  minCellZ: number
  maxCellZ: number
}

export type MapMatrixFillerBoundaries = {
  north: boolean
  south: boolean
  west: boolean
  east: boolean
}

export const mapMatrixCellSize = 32
export const mapMatrixHalfCellSize = mapMatrixCellSize / 2

type MapMatrixGeometryCache = {
  cells: Map<number, MapMatrixCell[]>
  footprints: Map<number, MapMatrixFootprint | undefined>
}

const matrixGeometryCaches = new WeakMap<MapMatrixPreview, MapMatrixGeometryCache>()

function getMatrixGeometryCache(matrix: MapMatrixPreview): MapMatrixGeometryCache {
  let cache = matrixGeometryCaches.get(matrix)
  if (!cache) {
    cache = { cells: new Map(), footprints: new Map() }
    matrixGeometryCaches.set(matrix, cache)
  }
  return cache
}

export function getMapMatrixCells(mapId: number, matrix: MapMatrixPreview): MapMatrixCell[] {
  const cache = getMatrixGeometryCache(matrix)
  const cached = cache.cells.get(mapId)
  if (cached) return cached
  const cells: MapMatrixCell[] = []
  const localComposite = matrix.hasHeaders === false
  for (let index = 0; index < matrix.headers.length; index += 1) {
    if (!localComposite && matrix.headers[index] !== mapId) continue
    cells.push({
      index,
      x: index % matrix.width,
      z: Math.floor(index / matrix.width),
      modelId: matrix.modelIds[index],
      altitude: (matrix.altitudes[index] ?? 0) * mapMatrixAltitudeStep,
    })
  }
  cache.cells.set(mapId, cells)
  return cells
}

export function getMapMatrixFootprint(mapId: number, matrix: MapMatrixPreview): MapMatrixFootprint | undefined {
  const cache = getMatrixGeometryCache(matrix)
  if (cache.footprints.has(mapId)) return cache.footprints.get(mapId)
  const cells = getMapMatrixCells(mapId, matrix)
  if (cells.length === 0) {
    cache.footprints.set(mapId, undefined)
    return undefined
  }

  const minCellX = Math.min(...cells.map((cell) => cell.x))
  const maxCellX = Math.max(...cells.map((cell) => cell.x))
  const minCellZ = Math.min(...cells.map((cell) => cell.z))
  const maxCellZ = Math.max(...cells.map((cell) => cell.z))
  const footprint = {
    cells,
    minCellX,
    maxCellX,
    minCellZ,
    maxCellZ,
    widthCells: maxCellX - minCellX + 1,
    heightCells: maxCellZ - minCellZ + 1,
  }
  cache.footprints.set(mapId, footprint)
  return footprint
}

export function getMapMatrixTileBounds(
  mapId: number,
  matrix: MapMatrixPreview,
  cellSize = mapMatrixCellSize,
): { minX: number, maxX: number, minZ: number, maxZ: number } | undefined {
  const footprint = getMapMatrixFootprint(mapId, matrix)
  if (!footprint) return undefined
  return {
    minX: 0,
    maxX: footprint.widthCells * cellSize,
    minZ: 0,
    maxZ: footprint.heightCells * cellSize,
  }
}

export function getMapMatrixRenderWindow(
  mapId: number,
  matrix: MapMatrixPreview,
  marginX = 1,
  marginZ = 1,
): MapMatrixRenderWindow | undefined {
  const footprint = getMapMatrixFootprint(mapId, matrix)
  if (!footprint) return undefined
  return {
    footprint,
    minCellX: Math.max(0, footprint.minCellX - marginX),
    maxCellX: Math.min(matrix.width - 1, footprint.maxCellX + marginX),
    minCellZ: Math.max(0, footprint.minCellZ - marginZ),
    maxCellZ: Math.min(matrix.height - 1, footprint.maxCellZ + marginZ),
  }
}

/**
 * Retourne toutes les cellules de la fenêtre prédécodée pour le rendu moderne.
 *
 * HGSS pouvait remplacer une rangée ou une colonne de sa fenêtre 2x2 à la
 * moitié d'une parcelle, car la caméra DS ne montrait pas la cellule retirée.
 * Sur un écran unique plus large, cette bascule fait apparaître ou disparaître
 * des arbres encore présents dans le champ de la caméra. La fenêtre de rendu
 * reste donc stable tant que la carte active ne change pas.
 */
export function getMapMatrixRenderCellIndices(
  mapId: number,
  matrix: MapMatrixPreview,
  marginX = 1,
  marginZ = 1,
): number[] {
  const window = getMapMatrixRenderWindow(mapId, matrix, marginX, marginZ)
  if (!window) return []

  const indices: number[] = []
  for (let z = window.minCellZ; z <= window.maxCellZ; z += 1) {
    for (let x = window.minCellX; x <= window.maxCellX; x += 1) {
      indices.push(z * matrix.width + x)
    }
  }
  return indices
}

export function isMapMatrixFillerCell(matrix: MapMatrixPreview, cellIndex: number): boolean {
  return cellIndex < 0
    || cellIndex >= matrix.headers.length
    || matrix.headers[cellIndex] === 0
    || matrix.modelIds[cellIndex] === 0xffff
}

/** Cellules possédant une vraie carte ROM, à l'exclusion de MAP_EVERYWHERE. */
export function getMapMatrixRenderableCellIndices(
  mapId: number,
  matrix: MapMatrixPreview,
  marginX = 1,
  marginZ = 1,
): number[] {
  return getMapMatrixRenderCellIndices(mapId, matrix, marginX, marginZ)
    .filter((cellIndex) => !isMapMatrixFillerCell(matrix, cellIndex))
}

/**
 * Indique les côtés du footprint qui donnent uniquement sur les cellules de
 * remplissage ROM. Une véritable route voisine laisse son côté déverrouillé.
 */
export function getMapMatrixFillerBoundaries(
  mapId: number,
  matrix: MapMatrixPreview,
): MapMatrixFillerBoundaries | undefined {
  const footprint = getMapMatrixFootprint(mapId, matrix)
  if (!footprint) return undefined

  const isFillerAt = (x: number, z: number): boolean => (
    x < 0 || x >= matrix.width || z < 0 || z >= matrix.height
      ? true
      : isMapMatrixFillerCell(matrix, z * matrix.width + x)
  )
  return {
    north: footprint.cells
      .filter(({ z }) => z === footprint.minCellZ)
      .every(({ x, z }) => isFillerAt(x, z - 1)),
    south: footprint.cells
      .filter(({ z }) => z === footprint.maxCellZ)
      .every(({ x, z }) => isFillerAt(x, z + 1)),
    west: footprint.cells
      .filter(({ x }) => x === footprint.minCellX)
      .every(({ x, z }) => isFillerAt(x - 1, z)),
    east: footprint.cells
      .filter(({ x }) => x === footprint.maxCellX)
      .every(({ x, z }) => isFillerAt(x + 1, z)),
  }
}

/**
 * Reproduit la fenêtre de MapLoadManager dans HGSS. La ROM divise la position
 * du joueur par 32 pour trouver sa parcelle, puis utilise x/z modulo 32 pour
 * choisir le quadrant. Le rendu contient toujours le carré 2x2 qui entoure ce
 * quadrant ; une rangée ou une colonne est remplacée lorsque le joueur passe
 * la moitié d'une parcelle.
 */
export function getMapMatrixLoadedCellIndices(
  matrix: MapMatrixPreview,
  worldX: number,
  worldZ: number,
): number[] {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ) || matrix.width <= 0 || matrix.height <= 0) return []

  const cellX = Math.floor(worldX / mapMatrixCellSize)
  const cellZ = Math.floor(worldZ / mapMatrixCellSize)
  const localX = worldX - cellX * mapMatrixCellSize
  const localZ = worldZ - cellZ * mapMatrixCellSize
  const neighborX = cellX + (localX < mapMatrixHalfCellSize ? -1 : 1)
  const neighborZ = cellZ + (localZ < mapMatrixHalfCellSize ? -1 : 1)
  const cells = [
    [cellX, cellZ],
    [neighborX, cellZ],
    [cellX, neighborZ],
    [neighborX, neighborZ],
  ] as const

  return cells.flatMap(([x, z]) => (
    x >= 0 && x < matrix.width && z >= 0 && z < matrix.height
      ? [z * matrix.width + x]
      : []
  ))
}
