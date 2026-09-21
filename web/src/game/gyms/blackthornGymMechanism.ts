export type BlackthornGymPoint = { x: number, z: number }

export type BlackthornGymPlatform = {
  index: number
  shape: 0 | 1
  x: number
  z: number
  rotation: number
  width: number
  height: number
  rotateButton: BlackthornGymPoint
  moveLeftButton: BlackthornGymPoint
  moveRightButton: BlackthornGymPoint
  rightWall: BlackthornGymPoint[]
  leftWall: BlackthornGymPoint[]
  bottomWall: BlackthornGymPoint[]
  topWall: BlackthornGymPoint[]
  rotateCollisionCheck: BlackthornGymPoint[]
  rightEdgeOuter: BlackthornGymPoint[]
  floor: BlackthornGymPoint[]
}

export type BlackthornGymActionKind = 'rotate' | 'move-right' | 'move-left'
export type BlackthornGymAction = { kind: BlackthornGymActionKind, platformIndex: number }
export type BlackthornGymActionResult = {
  action: BlackthornGymAction
  applied: boolean
  previousPlatform: BlackthornGymPlatform
  platform: BlackthornGymPlatform
  playerX: number
  playerZ: number
  durationFrames: number
}

/** TILE_BEHAVIOR_GYM_06_MAGMA dans la collision ROM de la carte 141. */
export const blackthornMagmaMetatileBehavior = 44

const mainRotationExtents = [
  [10, 10, 13, 18, 25, 38, 51, 64, 64, 23, 28, 35, 45, 55],
  [8, 9, 10, 14, 19, 26, 37, 51, 64, 17, 19, 23, 28, 35, 46, 55, 64, 64, 64, 30, 35, 41, 49, 57],
] as const
const leadingRotationExtents = [[64, 64, 64, 64, 42], [64, 20, 30, 46]] as const

function rotatePoint(point: BlackthornGymPoint, center: BlackthornGymPoint, rotation: number): BlackthornGymPoint {
  const dx = point.x - center.x
  const dz = point.z - center.z
  switch (rotation & 3) {
    case 1: return { x: center.x - dz, z: center.z + dx }
    case 2: return { x: center.x - dx, z: center.z - dz }
    case 3: return { x: center.x + dz, z: center.z - dx }
    default: return { ...point }
  }
}

function line(length: number, x: number, z: number, dx: number, dz: number): BlackthornGymPoint[] {
  return Array.from({ length }, (_, index) => ({ x: x + dx * index, z: z + dz * index }))
}

export function readBlackthornGymPlatforms(data: Uint8Array): BlackthornGymPlatform[] {
  if (data.byteLength < 15) throw new Error('L’état Gymmick Ébènelle est tronqué.')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return Array.from({ length: 3 }, (_, index) => createBlackthornGymPlatform(
    index,
    view.getUint16(index * 2, true),
    view.getUint16(6 + index * 2, true),
    data[12 + index]!,
  ))
}

export function writeBlackthornGymPlatform(data: Uint8Array, platform: BlackthornGymPlatform): void {
  if (data.byteLength < 15 || platform.index < 0 || platform.index > 2) throw new Error('L’état Gymmick Ébènelle est invalide.')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  view.setUint16(platform.index * 2, platform.x, true)
  view.setUint16(6 + platform.index * 2, platform.z, true)
  data[12 + platform.index] = platform.rotation & 3
}

export function createBlackthornGymPlatform(index: number, x: number, z: number, rotation: number): BlackthornGymPlatform {
  if (index < 0 || index > 2) throw new Error(`La plateforme Ébènelle ${index} est invalide.`)
  const shape = index === 1 ? 1 : 0
  const width = shape === 0 ? 5 : 4
  const height = shape === 0 ? 7 : 8
  const center = { x, z }
  const rotateCollisionCheck = shape === 0
    ? Array.from({ length: 2 }, (_, column) => line(7, x - 4 - column, z + 4, 0, -1)).flat()
    : Array.from({ length: 3 }, (_, column) => line(8, x - 4 - column, z + 5, 0, -1)).flat()
  const transform = (points: BlackthornGymPoint[]): BlackthornGymPoint[] => points.map((point) => rotatePoint(point, center, rotation))
  return {
    index,
    shape,
    x,
    z,
    rotation: rotation & 3,
    width,
    height,
    rotateButton: center,
    moveLeftButton: rotatePoint({ x: x + 1, z }, center, rotation),
    moveRightButton: rotatePoint({ x: x - 1, z }, center, rotation),
    rightWall: transform(line(height, x + (shape === 0 ? 3 : 2), z - 2, 0, 1)),
    leftWall: transform(line(height, x - 3, z - 2, 0, 1)),
    bottomWall: transform(line(width, x - 2, z + (shape === 0 ? 5 : 6), 1, 0)),
    topWall: transform(line(width, x - 2, z - 3, 1, 0)),
    rotateCollisionCheck: transform(rotateCollisionCheck),
    rightEdgeOuter: transform(line(width, x + 3, z - 2, 0, 1)),
    floor: transform(Array.from({ length: 6 }, (_, row) => line(3, x - 1, z - 1 + row, 1, 0)).flat()),
  }
}

export function getBlackthornGymActionAt(data: Uint8Array, x: number, z: number): BlackthornGymAction | undefined {
  for (const platform of readBlackthornGymPlatforms(data)) {
    if (platform.rotateButton.x === x && platform.rotateButton.z === z) return { kind: 'rotate', platformIndex: platform.index }
    if (platform.moveLeftButton.x === x && platform.moveLeftButton.z === z) return { kind: 'move-right', platformIndex: platform.index }
    if (platform.moveRightButton.x === x && platform.moveRightButton.z === z) return { kind: 'move-left', platformIndex: platform.index }
  }
  return undefined
}

export function resolveBlackthornGymCollision(data: Uint8Array, x: number, z: number, metatileBehavior: number): boolean | undefined {
  if (readBlackthornGymPlatforms(data).some((platform) => platform.floor.some((point) => point.x === x && point.z === z))) return false
  return metatileBehavior === blackthornMagmaMetatileBehavior ? true : undefined
}

function translate(points: readonly BlackthornGymPoint[], dx: number, dz: number): BlackthornGymPoint[] {
  return points.map((point) => ({ x: point.x + dx, z: point.z + dz }))
}

export function applyBlackthornGymAction(
  data: Uint8Array,
  action: BlackthornGymAction,
  canOccupyMagma: (x: number, z: number) => boolean,
): BlackthornGymActionResult {
  const platform = readBlackthornGymPlatforms(data)[action.platformIndex]
  if (!platform) throw new Error(`La plateforme Ébènelle ${action.platformIndex} est absente.`)
  let next = platform
  let playerX = action.kind === 'rotate' ? platform.rotateButton.x : action.kind === 'move-right' ? platform.moveLeftButton.x : platform.moveRightButton.x
  let playerZ = action.kind === 'rotate' ? platform.rotateButton.z : action.kind === 'move-right' ? platform.moveLeftButton.z : platform.moveRightButton.z
  if (action.kind === 'rotate') {
    const currentEdges = [...platform.bottomWall, ...platform.topWall, ...platform.leftWall, ...platform.rightWall.slice(0, platform.width - 1)]
    const mainClear = platform.rotateCollisionCheck.every((point, index) => mainRotationExtents[platform.shape][index]! >= 64 || canOccupyMagma(point.x, point.z))
    const leadingClear = platform.rightEdgeOuter.every((point, index) => leadingRotationExtents[platform.shape][index]! >= 64 || canOccupyMagma(point.x, point.z))
    if (currentEdges.every((point) => canOccupyMagma(point.x, point.z)) && mainClear && leadingClear) {
      next = createBlackthornGymPlatform(platform.index, platform.x, platform.z, platform.rotation + 1)
    }
  } else {
    const direction = (platform.rotation + (action.kind === 'move-left' ? 2 : 0)) & 3
    const [dx, dz] = [[1, 0], [0, 1], [-1, 0], [0, -1]][direction]!
    let leading = action.kind === 'move-right' ? platform.rightWall : platform.leftWall
    let clear = true
    for (let step = 0; step < platform.width; step += 1) {
      if (!leading.every((point) => canOccupyMagma(point.x, point.z))) { clear = false; break }
      leading = translate(leading, dx, dz)
    }
    if (clear) {
      next = createBlackthornGymPlatform(platform.index, platform.x + dx * platform.width, platform.z + dz * platform.width, platform.rotation)
      playerX += dx * platform.width
      playerZ += dz * platform.width
    }
  }
  const applied = next.x !== platform.x || next.z !== platform.z || next.rotation !== platform.rotation
  if (applied) writeBlackthornGymPlatform(data, next)
  return { action, applied, previousPlatform: platform, platform: next, playerX, playerZ, durationFrames: action.kind === 'rotate' ? 16 : platform.width * 2 }
}

export function transformBlackthornGymPassenger(result: BlackthornGymActionResult, point: BlackthornGymPoint): BlackthornGymPoint | undefined {
  if (!result.applied || !result.previousPlatform.floor.some(({ x, z }) => x === point.x && z === point.z)) return undefined
  if (result.action.kind === 'rotate') return rotatePoint(point, result.previousPlatform.rotateButton, 1)
  return { x: point.x + result.platform.x - result.previousPlatform.x, z: point.z + result.platform.z - result.previousPlatform.z }
}
