import { describe, expect, it } from 'vitest'
import { decodeNitroPatternAnimation, resolveNitroPatternKeyframe } from './nitroPatternAnimations'

function writeName(bytes: Uint8Array, offset: number, name: string): void {
  bytes.set(new TextEncoder().encode(name), offset)
}

function writeDictionary(bytes: Uint8Array, offset: number, valueSize: number, name: string): number {
  const view = new DataView(bytes.buffer)
  const size = 20 + valueSize + 16
  bytes[offset + 1] = 1
  view.setUint16(offset + 2, size, true)
  view.setUint16(offset + 16, valueSize, true)
  writeName(bytes, offset + 20 + valueSize, name)
  return offset + 20
}

function patternFixture(): Uint8Array {
  const bytes = new Uint8Array(220)
  const view = new DataView(bytes.buffer)
  writeName(bytes, 0, 'BTP0')
  view.setUint32(8, bytes.length, true)
  view.setUint32(16, 20, true)
  writeName(bytes, 20, 'PAT0')
  const outerValue = writeDictionary(bytes, 28, 4, 'lava')
  const animationOffset = 68
  view.setUint32(outerValue, animationOffset - 20, true)
  writeName(bytes, animationOffset, 'M\0PT')
  view.setUint16(animationOffset + 4, 8, true)
  bytes[animationOffset + 6] = 2
  bytes[animationOffset + 7] = 2
  const trackValue = writeDictionary(bytes, animationOffset + 12, 8, 'magma')
  const keyframesOffset = 124
  view.setUint32(trackValue, 2, true)
  view.setUint16(trackValue + 6, keyframesOffset - animationOffset, true)
  view.setUint16(keyframesOffset, 0, true)
  bytes.set([0, 0], keyframesOffset + 2)
  view.setUint16(keyframesOffset + 4, 4, true)
  bytes.set([1, 1], keyframesOffset + 6)
  const textureNamesOffset = 132
  const paletteNamesOffset = 164
  view.setUint16(animationOffset + 8, textureNamesOffset - animationOffset, true)
  view.setUint16(animationOffset + 10, paletteNamesOffset - animationOffset, true)
  writeName(bytes, textureNamesOffset, 'lava.1')
  writeName(bytes, textureNamesOffset + 16, 'lava.2')
  writeName(bytes, paletteNamesOffset, 'lava.1_pl')
  writeName(bytes, paletteNamesOffset + 16, 'lava.2_pl')
  return bytes
}

describe('Nitro BTP pattern animations', () => {
  it('decodes material tracks and holds each texture key until the next frame key', () => {
    const animation = decodeNitroPatternAnimation(patternFixture())
    expect(animation).toMatchObject({
      frameCount: 8,
      textureNames: ['lava.1', 'lava.2'],
      paletteNames: ['lava.1_pl', 'lava.2_pl'],
      tracks: [{ materialName: 'magma', keyframes: [{ frame: 0, textureIndex: 0, paletteIndex: 0 }, { frame: 4, textureIndex: 1, paletteIndex: 1 }] }],
    })
    expect(resolveNitroPatternKeyframe(animation!.tracks[0]!, 3).textureIndex).toBe(0)
    expect(resolveNitroPatternKeyframe(animation!.tracks[0]!, 4).textureIndex).toBe(1)
  })
})
