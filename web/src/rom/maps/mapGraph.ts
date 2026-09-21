import type { MapEventPreview, MapMatrixPreview } from '../../ndsTypes'

export function collectMatrixAdjacentMapIds(mapId: number, matrix: MapMatrixPreview, maxMapCount: number): number[] {
  const connectedMapIds = new Set<number>()
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const

  for (let index = 0; index < matrix.headers.length; index += 1) {
    if (matrix.headers[index] !== mapId) continue
    const x = index % matrix.width
    const y = Math.floor(index / matrix.width)
    for (const [deltaX, deltaY] of offsets) {
      const nextX = x + deltaX
      const nextY = y + deltaY
      if (nextX < 0 || nextX >= matrix.width || nextY < 0 || nextY >= matrix.height) continue
      const neighborMapId = matrix.headers[nextY * matrix.width + nextX]
      if (!Number.isInteger(neighborMapId) || neighborMapId < 0 || neighborMapId >= maxMapCount || neighborMapId === mapId) continue
      connectedMapIds.add(neighborMapId)
    }
  }

  return [...connectedMapIds]
}

export function collectConnectedMapIds(mapId: number, matrix: MapMatrixPreview, events: MapEventPreview | undefined, maxMapCount: number): number[] {
  const connectedMapIds = new Set<number>(collectMatrixAdjacentMapIds(mapId, matrix, maxMapCount))
  for (const warp of events?.warps ?? []) {
    if (!Number.isInteger(warp.header) || warp.header < 0 || warp.header >= maxMapCount || warp.header === mapId) continue
    connectedMapIds.add(warp.header)
  }
  return [...connectedMapIds]
}