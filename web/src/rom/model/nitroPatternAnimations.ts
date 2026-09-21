import { hasNitroMagic, readNitroDictionary, readNitroFixedNames, type NitroResourceView } from './nitroResource'

export type NitroPatternKeyframe = { frame: number, textureIndex: number, paletteIndex: number }
export type NitroPatternTrack = { materialName: string, keyframes: NitroPatternKeyframe[] }
export type NitroPatternAnimation = {
  frameCount: number
  textureNames: string[]
  paletteNames: string[]
  tracks: NitroPatternTrack[]
}

export function decodeNitroPatternAnimation(bytes: Uint8Array): NitroPatternAnimation | undefined {
  if (bytes.length < 0x20 || !hasNitroMagic(bytes, 0, 'BTP0')) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fileSize = view.getUint32(8, true)
  const sectionOffset = view.getUint32(16, true)
  if (fileSize > bytes.length || sectionOffset + 8 > fileSize || !hasNitroMagic(bytes, sectionOffset, 'PAT0')) return undefined
  const resource: NitroResourceView = { bytes, view, baseOffset: 0, fileSize }
  const animations = readNitroDictionary(resource, sectionOffset + 8, (offset) => view.getUint32(offset, true))
  const animationOffset = animations[0] ? sectionOffset + animations[0].value : -1
  if (animationOffset < 0 || animationOffset + 16 > fileSize) return undefined
  const frameCount = view.getUint16(animationOffset + 4, true)
  const textureCount = view.getUint8(animationOffset + 6)
  const paletteCount = view.getUint8(animationOffset + 7)
  const textureNames = readNitroFixedNames(resource, animationOffset + view.getUint16(animationOffset + 8, true), textureCount)
  const paletteNames = readNitroFixedNames(resource, animationOffset + view.getUint16(animationOffset + 10, true), paletteCount)
  if (frameCount === 0 || textureCount === 0 || !textureNames || !paletteNames) return undefined
  const tracks = readNitroDictionary(resource, animationOffset + 12, (offset) => ({
    count: view.getUint32(offset, true),
    keyframesOffset: animationOffset + view.getUint16(offset + 6, true),
  })).map(({ name, value }): NitroPatternTrack | undefined => {
    if (value.count === 0 || value.keyframesOffset + value.count * 4 > fileSize) return undefined
    const keyframes = Array.from({ length: value.count }, (_, index): NitroPatternKeyframe => {
      const offset = value.keyframesOffset + index * 4
      return { frame: view.getUint16(offset, true), textureIndex: view.getUint8(offset + 2), paletteIndex: view.getUint8(offset + 3) }
    })
    if (keyframes.some(({ frame, textureIndex, paletteIndex }) => frame >= frameCount || textureIndex >= textureCount || (paletteCount > 0 && paletteIndex >= paletteCount))) return undefined
    return { materialName: name, keyframes }
  }).filter((track): track is NitroPatternTrack => Boolean(track))
  return tracks.length > 0 ? { frameCount, textureNames, paletteNames, tracks } : undefined
}

export function resolveNitroPatternKeyframe(track: NitroPatternTrack, frame: number): NitroPatternKeyframe {
  const normalized = Math.max(0, Math.floor(frame))
  let selected = track.keyframes[0]!
  for (const keyframe of track.keyframes) {
    if (keyframe.frame > normalized) break
    selected = keyframe
  }
  return selected
}
