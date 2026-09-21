import { describe, expect, it } from 'vitest'
import type { NitroTexturePreview } from '../../ndsTypes'
import { getSpriteAlphaAnchorY, getSpriteWorldDimensions } from './spriteAlphaAnchor'

function texture(height: number, lowestOpaqueY: number): NitroTexturePreview {
  const pixels = new Uint8ClampedArray(4 * height)
  pixels[lowestOpaqueY * 4 + 3] = 255
  return { id: 'test', name: 'test', width: 1, height, pixels }
}

describe('overworld sprite alpha anchor', () => {
  it('moves transparent bottom padding below the tile origin for every texture size', () => {
    expect(getSpriteAlphaAnchorY(texture(32, 31))).toBe(0)
    expect(getSpriteAlphaAnchorY(texture(32, 27))).toBe(4 / 32)
    expect(getSpriteAlphaAnchorY(texture(64, 55))).toBe(8 / 64)
  })

  it('keeps native 16px objects smaller than 32px actors in every scene scale', () => {
    expect(getSpriteWorldDimensions(texture(16, 15), 32)).toEqual({ width: 1, height: 16 })
    expect(getSpriteWorldDimensions({ ...texture(16, 15), width: 16 }, 32)).toEqual({ width: 16, height: 16 })
    expect(getSpriteWorldDimensions({ ...texture(32, 31), width: 32 }, 1.55)).toEqual({ width: 1.55, height: 1.55 })
  })
})
