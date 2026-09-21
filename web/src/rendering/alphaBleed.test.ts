import { describe, expect, it } from 'vitest'
import { bleedTransparentPixelColors } from './alphaBleed'

describe('transparent pixel color bleed', () => {
  it('extends neighboring color under transparent pixels without changing alpha', () => {
    const source = new Uint8ClampedArray([
      255, 64, 16, 255,
      0, 0, 0, 0,
    ])
    expect(bleedTransparentPixelColors(source, 2, 1)).toEqual(new Uint8ClampedArray([
      255, 64, 16, 255,
      255, 64, 16, 0,
    ]))
  })

  it('does not modify isolated transparent pixels or the source array', () => {
    const source = new Uint8ClampedArray([12, 24, 36, 0])
    expect(bleedTransparentPixelColors(source, 1, 1)).toEqual(source)
    expect(source).toEqual(new Uint8ClampedArray([12, 24, 36, 0]))
  })
})