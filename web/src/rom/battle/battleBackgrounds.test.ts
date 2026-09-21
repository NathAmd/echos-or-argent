import { describe, expect, it } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import { createHgssSingleScreenBattleBackdrop, hgssBattleBackdropHeight, hgssBattleGroundOffset, hgssSingleScreenHorizon } from './battleBackgrounds'

describe('HGSS single-screen battle backdrop', () => {
  it('keeps only the authored upper backdrop and removes the native BG separation band', () => {
    const width = 256
    const height = 192
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      pixels[offset] = y < hgssBattleBackdropHeight ? 120 : y >= hgssBattleGroundOffset ? 45 : 0
      pixels[offset + 1] = y < hgssBattleBackdropHeight ? 180 : y >= hgssBattleGroundOffset ? 75 : 0
      pixels[offset + 2] = y < hgssBattleBackdropHeight ? 90 : y >= hgssBattleGroundOffset ? 105 : 0
      pixels[offset + 3] = 255
    }
    const source: NitroGraphic = { width, height, pixels, graphicsOffset: 0, paletteOffset: 0, colorDepth: 8 }

    const backdrop = createHgssSingleScreenBattleBackdrop(source)

    expect(backdrop).toMatchObject({ width: 256, height: 192 })
    expect([...backdrop.pixels.slice(0, width * hgssSingleScreenHorizon * 4)].every((value, index) => index % 4 === 3 || value > 0)).toBe(true)
    expect([...backdrop.pixels.slice(width * hgssSingleScreenHorizon * 4)].every((value, index) => index % 4 === 3 || value > 0)).toBe(true)
    expect([...backdrop.pixels].some((value, index) => index % 4 !== 3 && value === 0)).toBe(false)
  })
})
