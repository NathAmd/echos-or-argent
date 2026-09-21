import { hasNitroMagic, readNitroDictionary, type NitroResourceView } from './nitroResource'

export type NitroMaterialAnimationResource = NitroResourceView & {
  animationOffset: number
  frameCount: number
  texMtxMode: number
  tracksByName: ReadonlyMap<string, number>
}

export function openNitroMaterialAnimation(
  bytes: Uint8Array,
  container: 'BTA0' | 'BMA0',
  chunk: 'SRT0' | 'MAT0',
): NitroMaterialAnimationResource | undefined {
  if (bytes.length < 32 || !hasNitroMagic(bytes, 0, container)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fileSize = view.getUint32(8, true)
  const sectionOffset = view.getUint32(16, true)
  if (fileSize > bytes.length || sectionOffset + 16 > fileSize || !hasNitroMagic(bytes, sectionOffset, chunk)) return undefined
  const baseResource: NitroResourceView = { bytes, view, baseOffset: 0, fileSize }
  const entry = readNitroDictionary(baseResource, sectionOffset + 8, (offset) => offset)[0]
  if (!entry) return undefined
  const animationOffset = sectionOffset + view.getUint32(entry.value, true)
  const frameCount = animationOffset + 8 <= fileSize ? view.getUint16(animationOffset + 4, true) : 0
  if (frameCount === 0 || frameCount > 4096) return undefined
  const tracks = readNitroDictionary(baseResource, animationOffset + 8, (offset) => offset)
  return {
    ...baseResource,
    animationOffset,
    frameCount,
    texMtxMode: container === 'BTA0' ? view.getUint8(animationOffset + 7) : 0,
    tracksByName: new Map(tracks.map(({ name, value }) => [name, value])),
  }
}
