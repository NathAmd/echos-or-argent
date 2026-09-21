import { describe, expect, it } from 'vitest'
import { decodeHgssGrassTextureTimeline, sampleHgssGrassTexture } from './grassEffects'

function timelineBytes(frames: number[], textures: number[], palettes: number[]): Uint8Array {
  const bytes = new Uint8Array(4 + frames.length * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, frames.length, true)
  frames.forEach((frame, index) => view.setUint16(4 + index * 2, frame, true))
  bytes.set(textures, 4 + frames.length * 2)
  bytes.set(palettes, 4 + frames.length * 3)
  return bytes
}

describe('HGSS grass texture timeline', () => {
  it('decodes and samples the native tall-grass step keys through the held final frame', () => {
    const timeline = decodeHgssGrassTextureTimeline(timelineBytes([0, 4, 8, 12], [0, 1, 2, 3], [0, 0, 0, 0]))

    expect([0, 3, 4, 7, 8, 11, 12, 40].map((frame) => sampleHgssGrassTexture(timeline, frame)))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })

  it('rejects malformed records instead of guessing their layout', () => {
    expect(() => decodeHgssGrassTextureTimeline(timelineBytes([0, 0], [0, 1], [0, 0])))
      .toThrow('strictement croissantes')
    expect(() => decodeHgssGrassTextureTimeline(new Uint8Array([1, 0, 0, 0])))
      .toThrow('taille invalide')
  })
})