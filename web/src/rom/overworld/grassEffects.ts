import type { NitroModelPreview, NitroTexturePreview } from '../../ndsTypes'

export type HgssGrassEffectKind = 'tallGrass' | 'veryTallGrass'

export type HgssGrassTextureTimeline = {
  keyFrames: number[]
  textureIndexes: number[]
  paletteIndexes: number[]
}

export type HgssGrassEffect = {
  kind: HgssGrassEffectKind
  model: NitroModelPreview
  textures: NitroTexturePreview[]
  timeline: HgssGrassTextureTimeline
}

export function decodeHgssGrassTextureTimeline(bytes: Uint8Array): HgssGrassTextureTimeline {
  if (bytes.byteLength < 4) throw new Error("La timeline d'herbe HGSS est tronquee.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0, true)
  const expectedSize = 4 + count * 4
  if (count === 0 || expectedSize !== bytes.byteLength) {
    throw new Error(`La timeline d'herbe HGSS a une taille invalide: ${bytes.byteLength}.`)
  }
  const keyFrames = Array.from({ length: count }, (_, index) => view.getUint16(4 + index * 2, true))
  const textureOffset = 4 + count * 2
  const paletteOffset = textureOffset + count
  if (keyFrames.some((frame, index) => index > 0 && frame <= keyFrames[index - 1]!)) {
    throw new Error("Les cles de la timeline d'herbe HGSS ne sont pas strictement croissantes.")
  }
  return {
    keyFrames,
    textureIndexes: Array.from(bytes.subarray(textureOffset, paletteOffset)),
    paletteIndexes: Array.from(bytes.subarray(paletteOffset, expectedSize)),
  }
}

export function sampleHgssGrassTexture(timeline: HgssGrassTextureTimeline, elapsedFrames: number): number {
  const frame = Math.max(0, Math.floor(elapsedFrames))
  let keyIndex = 0
  while (keyIndex + 1 < timeline.keyFrames.length && timeline.keyFrames[keyIndex + 1]! <= frame) keyIndex += 1
  return timeline.textureIndexes[keyIndex]!
}