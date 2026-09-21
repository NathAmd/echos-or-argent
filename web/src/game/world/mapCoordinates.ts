import type { OpeningMapPreview } from '../../ndsTypes'
import { getMapMatrixFootprint, getMapMatrixTileBounds } from '../../rom/maps/mapFootprint'

const fieldGroundHeightsCache = new WeakMap<OpeningMapPreview, Map<string, readonly number[]>>()
type WallSegment = readonly [number, number, number, number, number | undefined]
const verticalWallSegmentsCache = new WeakMap<OpeningMapPreview, Map<string, readonly WallSegment[]>>()
const indoorTileSize = 16
const groundLayerEpsilon = 1e-4

export type MapGroundLayer = {
  height: number
  index: number
  count: number
  lowestHeight: number
  highestHeight: number
}

function sampleTriangleHeightAtPoint(
  pointX: number,
  pointZ: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number | undefined {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const normalX = aby * acz - abz * acy
  const normalY = abz * acx - abx * acz
  const normalZ = abx * acy - aby * acx
  const normalLength = Math.hypot(normalX, normalY, normalZ)
  if (normalLength < 1e-6 || Math.abs(normalY) / normalLength < 0.35) return undefined

  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(denominator) < 1e-6) return undefined

  const alpha = ((bz - cz) * (pointX - cx) + (cx - bx) * (pointZ - cz)) / denominator
  const beta = ((cz - az) * (pointX - cx) + (ax - cx) * (pointZ - cz)) / denominator
  const gamma = 1 - alpha - beta
  const epsilon = 1e-5
  if (alpha < -epsilon || beta < -epsilon || gamma < -epsilon) return undefined

  return alpha * ay + beta * by + gamma * cy
}

function getMapCell(map: OpeningMapPreview): number {
  return getMapMatrixFootprint(map.id, map.matrix)?.cells[0]?.index ?? -1
}

export function usesWorldMatrixCoordinates(map: OpeningMapPreview): boolean {
  if (map.matrix.hasHeaders === false) return false
  const mapCell = getMapCell(map)
  return mapCell >= 0 && (map.matrix.width > 1 || map.matrix.height > 1)
}

export function getMapOrigin(map: OpeningMapPreview): { x: number, z: number } {
  const footprint = getMapMatrixFootprint(map.id, map.matrix)
  if (!footprint || !usesWorldMatrixCoordinates(map)) return { x: 0, z: 0 }
  return {
    x: footprint.minCellX * 32,
    z: footprint.minCellZ * 32,
  }
}

export function getMapTileBounds(map: OpeningMapPreview): { minX: number, maxX: number, minZ: number, maxZ: number } | undefined {
  if (!usesWorldMatrixCoordinates(map)) return undefined
  return getMapMatrixTileBounds(map.id, map.matrix)
}

function getMapMatrixCellIndexAtLocalTile(map: OpeningMapPreview, tileX: number, tileZ: number): number | undefined {
  if (!usesWorldMatrixCoordinates(map)) return undefined
  const origin = getMapOrigin(map)
  const cellX = Math.floor((origin.x + tileX) / 32)
  const cellZ = Math.floor((origin.z + tileZ) / 32)
  if (cellX < 0 || cellX >= map.matrix.width || cellZ < 0 || cellZ >= map.matrix.height) return undefined
  return cellZ * map.matrix.width + cellX
}

export function getMapGroundHeights(map: OpeningMapPreview, tileX: number, tileZ: number): readonly number[] | undefined {
  const usesWorldCoordinates = usesWorldMatrixCoordinates(map)
  if (!usesWorldCoordinates && !map.terrain) return undefined

  let cache = fieldGroundHeightsCache.get(map)
  if (!cache) {
    cache = new Map<string, readonly number[]>()
    fieldGroundHeightsCache.set(map, cache)
  }

  const cacheKey = `${tileX},${tileZ}`
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    return cached && cached.length > 0 ? cached : undefined
  }

  // Les BDHC exterieures sont deja exprimees en cases monde. Dans une piece,
  // la ROM centre au contraire la grille sur le modele et stocke les hauteurs
  // en cases de 16 unites Nitro. Le rendu des pieces travaille en unites
  // Nitro : il faut donc appliquer les deux conversions, pas supposer y = 0.
  const collisionPointX = usesWorldCoordinates
    ? tileX + 0.5
    : tileX + 0.5 - map.terrain!.width / 2
  const collisionPointZ = usesWorldCoordinates
    ? tileZ + 0.5
    : tileZ + 0.5 - map.terrain!.height / 2
  const collisionHeightScale = usesWorldCoordinates ? 1 : indoorTileSize
  const sampledHeights: number[] = []
  for (const plate of map.terrain?.collisionPlates ?? []) {
    if (collisionPointX < plate.minX || collisionPointX > plate.maxX || collisionPointZ < plate.minZ || collisionPointZ > plate.maxZ) continue
    if (Math.abs(plate.normalY) < 1e-6) continue
    sampledHeights.push(
      ((plate.distance - plate.normalX * collisionPointX - plate.normalZ * collisionPointZ) / plate.normalY)
      * collisionHeightScale,
    )
  }
  // Les BDHC sont les plans de collision natifs HGSS. La geometrie rendue ne
  // sert de repli que pour une carte qui n'en possede pas.
  if (map.terrain?.collisionPlates?.length) {
    sampledHeights.sort((left, right) => left - right)
    const uniqueHeights = sampledHeights.filter((height, index) => index === 0 || Math.abs(height - sampledHeights[index - 1]) > 1e-4)
    cache.set(cacheKey, uniqueHeights)
    return uniqueHeights.length > 0 ? uniqueHeights : undefined
  }
  if (!map.model?.surfaces?.length) return undefined
  const geometryPointX = usesWorldCoordinates ? collisionPointX : collisionPointX * indoorTileSize
  const geometryPointZ = usesWorldCoordinates ? collisionPointZ : collisionPointZ * indoorTileSize
  const owningCellIndex = getMapMatrixCellIndexAtLocalTile(map, tileX, tileZ)
  for (const surface of map.model.surfaces) {
    if (surface.mapMatrixCellIndex !== undefined && surface.mapMatrixCellIndex !== owningCellIndex) continue
    // Houses, trees, signs and windmills must not become a second floor.
    if (surface.supportsMovement === false) continue
    const positions = surface.positions
    for (let index = 0; index + 8 < positions.length; index += 9) {
      const height = sampleTriangleHeightAtPoint(
        geometryPointX,
        geometryPointZ,
        positions[index],
        positions[index + 1],
        positions[index + 2],
        positions[index + 3],
        positions[index + 4],
        positions[index + 5],
        positions[index + 6],
        positions[index + 7],
        positions[index + 8],
      )
      if (height === undefined) continue
      sampledHeights.push(height)
    }
  }

  sampledHeights.sort((left, right) => left - right)
  const uniqueHeights = sampledHeights.filter((height, index) => index === 0 || Math.abs(height - sampledHeights[index - 1]) > 1e-4)
  cache.set(cacheKey, uniqueHeights)
  return uniqueHeights.length > 0 ? uniqueHeights : undefined
}

export function hasMapDecorativeSurfaceAt(map: OpeningMapPreview, tileX: number, tileZ: number): boolean {
  if (!usesWorldMatrixCoordinates(map) || !map.model?.surfaces?.length) return false
  const pointX = tileX + 0.5
  const pointZ = tileZ + 0.5
  const owningCellIndex = getMapMatrixCellIndexAtLocalTile(map, tileX, tileZ)
  for (const surface of map.model.surfaces) {
    if (surface.mapMatrixCellIndex !== undefined && surface.mapMatrixCellIndex !== owningCellIndex) continue
    if (surface.supportsMovement !== false) continue
    const positions = surface.positions
    for (let index = 0; index + 8 < positions.length; index += 9) {
      if (sampleTriangleHeightAtPoint(
        pointX,
        pointZ,
        positions[index],
        positions[index + 1],
        positions[index + 2],
        positions[index + 3],
        positions[index + 4],
        positions[index + 5],
        positions[index + 6],
        positions[index + 7],
        positions[index + 8],
      ) !== undefined) return true
    }
  }
  return false
}

function segmentsIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const cross = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number => (qx - px) * (rz - pz) - (qz - pz) * (rx - px)
  const first = cross(ax, az, bx, bz, cx, cz)
  const second = cross(ax, az, bx, bz, dx, dz)
  const third = cross(cx, cz, dx, dz, ax, az)
  const fourth = cross(cx, cz, dx, dz, bx, bz)
  const epsilon = 1e-5
  return ((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon))
    && ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))
}

function getVerticalWallSegments(map: OpeningMapPreview): Map<string, readonly WallSegment[]> {
  const cached = verticalWallSegmentsCache.get(map)
  if (cached) return cached
  const byTile = new Map<string, WallSegment[]>()
  const addSegment = (ax: number, az: number, bx: number, bz: number, mapMatrixCellIndex: number | undefined): void => {
    const minTileX = Math.floor(Math.min(ax, bx) - 0.5)
    const maxTileX = Math.floor(Math.max(ax, bx) - 0.5)
    const minTileZ = Math.floor(Math.min(az, bz) - 0.5)
    const maxTileZ = Math.floor(Math.max(az, bz) - 0.5)
    for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const key = `${tileX},${tileZ}`
        const segments = byTile.get(key) ?? []
        segments.push([ax, az, bx, bz, mapMatrixCellIndex])
        byTile.set(key, segments)
      }
    }
  }
  for (const surface of map.model?.surfaces ?? []) {
    const positions = surface.positions
    for (let index = 0; index + 8 < positions.length; index += 9) {
      const ax = positions[index]
      const ay = positions[index + 1]
      const az = positions[index + 2]
      const bx = positions[index + 3]
      const by = positions[index + 4]
      const bz = positions[index + 5]
      const cx = positions[index + 6]
      const cy = positions[index + 7]
      const cz = positions[index + 8]
      const normalX = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
      const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      const normalZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      const normalLength = Math.hypot(normalX, normalY, normalZ)
      if (normalLength < 1e-5 || Math.abs(normalY) / normalLength >= 0.35) continue
      addSegment(ax, az, bx, bz, surface.mapMatrixCellIndex)
      addSegment(bx, bz, cx, cz, surface.mapMatrixCellIndex)
      addSegment(cx, cz, ax, az, surface.mapMatrixCellIndex)
    }
  }
  verticalWallSegmentsCache.set(map, byTile)
  return byTile
}

export function hasMapWallBetween(map: OpeningMapPreview, fromTileX: number, fromTileZ: number, toTileX: number, toTileZ: number): boolean {
  if (!map.model?.surfaces?.length) return false
  const fromX = fromTileX + 0.5
  const fromZ = fromTileZ + 0.5
  const toX = toTileX + 0.5
  const toZ = toTileZ + 0.5
  const candidateSegments = new Set<WallSegment>()
  const relevantCellIndices = new Set([
    getMapMatrixCellIndexAtLocalTile(map, fromTileX, fromTileZ),
    getMapMatrixCellIndexAtLocalTile(map, toTileX, toTileZ),
  ])
  const segmentsByTile = getVerticalWallSegments(map)
  for (const key of [`${fromTileX},${fromTileZ}`, `${toTileX},${toTileZ}`]) {
    for (const segment of segmentsByTile.get(key) ?? []) candidateSegments.add(segment)
  }
  for (const [ax, az, bx, bz, mapMatrixCellIndex] of candidateSegments) {
    if (mapMatrixCellIndex !== undefined && !relevantCellIndices.has(mapMatrixCellIndex)) continue
    if (segmentsIntersect(fromX, fromZ, toX, toZ, ax, az, bx, bz)) return true
  }
  return false
}

export function resolveMapGroundLayer(map: OpeningMapPreview, tileX: number, tileZ: number, referenceHeight?: number): MapGroundLayer | undefined {
  const heights = getMapGroundHeights(map, tileX, tileZ)
  if (!heights || heights.length === 0) return undefined
  if (referenceHeight === undefined) {
    return {
      height: heights[heights.length - 1]!,
      index: heights.length - 1,
      count: heights.length,
      lowestHeight: heights[0]!,
      highestHeight: heights[heights.length - 1]!,
    }
  }

  let closestIndex = 0
  let closestHeight = heights[closestIndex]!
  let closestDistance = Math.abs(closestHeight - referenceHeight)
  for (let index = 1; index < heights.length; index += 1) {
    const height = heights[index]!
    const distance = Math.abs(height - referenceHeight)
    if (distance < closestDistance - 1e-5 || (Math.abs(distance - closestDistance) <= 1e-5 && height < closestHeight)) {
      closestIndex = index
      closestHeight = height
      closestDistance = distance
    }
  }
  return {
    height: closestHeight,
    index: closestIndex,
    count: heights.length,
    lowestHeight: heights[0]!,
    highestHeight: heights[heights.length - 1]!,
  }
}

export function isMapLowestGroundLayer(map: OpeningMapPreview, tileX: number, tileZ: number, referenceHeight?: number): boolean {
  const layer = resolveMapGroundLayer(map, tileX, tileZ, referenceHeight)
  return !layer || Math.abs(layer.height - layer.lowestHeight) <= groundLayerEpsilon
}

export function getMapGroundHeight(map: OpeningMapPreview, tileX: number, tileZ: number, referenceHeight?: number): number | undefined {
  return resolveMapGroundLayer(map, tileX, tileZ, referenceHeight)?.height
}
