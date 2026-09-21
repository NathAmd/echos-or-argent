export type IndoorSurfaceLayer = {
  positions: Float32Array
  colors?: Float32Array
  uvs?: Float32Array
  depthKey: number
}

export function getIndoorSurfaceDepthKey(positions: Float32Array): number {
  let maxZ = Number.NEGATIVE_INFINITY
  for (let index = 2; index < positions.length; index += 3) maxZ = Math.max(maxZ, positions[index]!)
  return Math.round(maxZ * 100)
}

/**
 * Une matière Nitro peut couvrir toute une pièce. La découper par profondeur
 * de triangle empêche son mur le plus au sud d'imposer le même layer au sol,
 * aux murs nord et aux meubles partageant cette matière.
 */
export function splitIndoorSurfaceLayers(
  positions: Float32Array,
  colors?: Float32Array,
  uvs?: Float32Array,
): IndoorSurfaceLayer[] {
  if (positions.length % 9 !== 0) return [{ positions, colors, uvs, depthKey: getIndoorSurfaceDepthKey(positions) }]
  const buckets = new Map<number, { positions: number[], colors?: number[], uvs?: number[] }>()
  for (let offset = 0; offset < positions.length; offset += 9) {
    const depthKey = Math.round(Math.max(positions[offset + 2]!, positions[offset + 5]!, positions[offset + 8]!) * 100)
    const bucket = buckets.get(depthKey) ?? { positions: [], colors: colors ? [] : undefined, uvs: uvs ? [] : undefined }
    for (let index = 0; index < 9; index += 1) bucket.positions.push(positions[offset + index]!)
    if (colors && bucket.colors) for (let index = 0; index < 9; index += 1) bucket.colors.push(colors[offset + index]!)
    if (uvs && bucket.uvs) {
      const uvOffset = offset / 3 * 2
      for (let index = 0; index < 6; index += 1) bucket.uvs.push(uvs[uvOffset + index]!)
    }
    buckets.set(depthKey, bucket)
  }
  return [...buckets.entries()].sort(([left], [right]) => left - right).map(([depthKey, bucket]) => ({
    positions: new Float32Array(bucket.positions),
    colors: bucket.colors && new Float32Array(bucket.colors),
    uvs: bucket.uvs && new Float32Array(bucket.uvs),
    depthKey,
  }))
}
