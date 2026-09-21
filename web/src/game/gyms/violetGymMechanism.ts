export const violetGymElevator = { modelId: 111, minX: 14, maxX: 16, minZ: 19, maxZ: 21, downY: 32, upY: 496, speedPerFrame: 16 } as const

export function getVioletGymElevatorState(data: Uint8Array): 0 | 1 {
  if (data.byteLength < 4) throw new Error('L’état Gymmick Mauville est tronqué.')
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) === 0 ? 0 : 1
}

export function getVioletGymElevatorHeight(data: Uint8Array): number {
  return getVioletGymElevatorState(data) === 0 ? violetGymElevator.downY : violetGymElevator.upY
}

export function resolveVioletGymHeight(data: Uint8Array, tileX: number, tileZ: number): number | undefined {
  return isVioletGymElevatorTile(tileX, tileZ)
    ? getVioletGymElevatorHeight(data)
    : undefined
}

export function isVioletGymElevatorTile(tileX: number, tileZ: number): boolean {
  return tileX >= violetGymElevator.minX && tileX <= violetGymElevator.maxX && tileZ >= violetGymElevator.minZ && tileZ <= violetGymElevator.maxZ
}
