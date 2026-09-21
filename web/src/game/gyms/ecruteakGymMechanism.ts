export const ecruteakGymCandleObjectIds = [2, 3, 4, 5] as const
export const ecruteakGymPresentation = {
  modelId: 128,
  fogColor: 0x000000,
  fogSlope: 0x20,
  fogOffset: 0,
  fogColorAlpha: 31,
  fogDensity: 0xff,
  extinguishDelayFrames: 31,
  extinguishScales: [1 / 2, 1 / 3, 1 / 4, 1 / 4],
  transformedTrainerSpriteId: 250,
} as const

export function getEcruteakGymCandleIndex(objectId: number): number | undefined {
  const index = ecruteakGymCandleObjectIds.indexOf(objectId as typeof ecruteakGymCandleObjectIds[number])
  return index < 0 ? undefined : index
}

export function isEcruteakGymCandleExtinguished(data: Uint8Array, objectId: number): boolean {
  const index = getEcruteakGymCandleIndex(objectId)
  if (index === undefined) return false
  if (data.byteLength < ecruteakGymCandleObjectIds.length) throw new Error('L’état Gymmick Rosalia est tronqué.')
  return data[index] !== 0
}
