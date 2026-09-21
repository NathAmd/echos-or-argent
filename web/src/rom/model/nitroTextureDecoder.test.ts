import { describe, expect, it } from 'vitest'
import type { NitroPaletteSource, NitroTextureSet, NitroTextureSource } from './internalTypes'
import { decodeNitroModelTextures, decodeNitroTexture, resolveNitroPaletteName } from './nitroTextureDecoder'

const palette: NitroPaletteSource = { name: 'hero_pl', dataOffset: 128 }

function createFixture(format: number, data: number[], color0Transparent = true): { bytes: Uint8Array, set: NitroTextureSet, texture: NitroTextureSource } {
  const bytes = new Uint8Array(640)
  bytes.set(data, 0)
  const view = new DataView(bytes.buffer)
  const colors = [0x0000, 0x001f, 0x03e0, 0x7c00]
  colors.forEach((color, index) => view.setUint16(128 + index * 2, color, true))
  const texture: NitroTextureSource = { name: 'hero', width: 2, height: 2, format, color0Transparent, dataOffset: 0 }
  const set: NitroTextureSet = {
    textures: [texture],
    palettes: [palette],
    block1Offset: 0,
    block1Length: 64,
    block4Offset: 128,
    block4Length: 512,
  }
  return { bytes, set, texture }
}

function firstPixels(format: number, data: number[], color0Transparent = true): Uint8ClampedArray | undefined {
  const fixture = createFixture(format, data, color0Transparent)
  return decodeNitroTexture(fixture.bytes, fixture.set, fixture.texture, format === 7 ? undefined : palette)?.pixels
}

describe('Nitro texture decoding', () => {
  it('decodes A3I5 and A5I3 alpha formats', () => {
    expect(firstPixels(1, [0xe1, 0x01, 0, 0])?.slice(0, 8)).toEqual(new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 0,
    ]))
    expect(firstPixels(6, [0xf9, 0x01, 0, 0])?.slice(0, 8)).toEqual(new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 0,
    ]))
  })

  it('decodes indexed formats with color-zero transparency', () => {
    const expected = new Uint8ClampedArray([
      0, 0, 0, 0,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ])
    expect(firstPixels(2, [0xe4])).toEqual(expected)
    expect(firstPixels(3, [0x10, 0x32])).toEqual(expected)
    expect(firstPixels(4, [0, 1, 2, 3])).toEqual(expected)
  })

  it('decodes direct RGB555 colors and their alpha bit without a palette', () => {
    expect(firstPixels(7, [0x1f, 0x80, 0xe0, 0x03, 0x00, 0xfc, 0x00, 0x00])).toEqual(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 0,
      0, 0, 255, 255,
      0, 0, 0, 0,
    ]))
  })

  it('resolves explicit, suffixed, numbered, and single palettes', () => {
    const palettes = new Map<string, NitroPaletteSource>([['hero_pl', palette]])
    expect(resolveNitroPaletteName('hero', 'hero', palettes)).toBe('hero_pl')
    expect(resolveNitroPaletteName('tsure_poke.1', 'tsure_poke', new Map([
      ['tsure_poke0', { name: 'tsure_poke0', dataOffset: 128 }],
      ['tsure_poke1', { name: 'tsure_poke1', dataOffset: 160 }],
    ]))).toBe('tsure_poke0')
    expect(resolveNitroPaletteName('missing', undefined, palettes)).toBe('hero_pl')
    expect(resolveNitroPaletteName('missing', undefined, new Map())).toBeUndefined()
  })

  it('selects bound and optional unbound model textures once', () => {
    const fixture = createFixture(2, [0xe4])
    const extra = { ...fixture.texture, name: 'extra', dataOffset: 1 }
    fixture.bytes[1] = 0x55
    fixture.set.textures.push(extra)
    const resolved = new Map([[0, palette.name]])

    expect(decodeNitroModelTextures(fixture.bytes, fixture.set, [{ name: 'body', textureName: 'hero' }], resolved)).toHaveLength(1)
    expect(decodeNitroModelTextures(fixture.bytes, fixture.set, [{ name: 'body', textureName: 'hero' }], resolved, true).map((texture) => texture.name)).toEqual(['hero', 'extra'])
  })

  it('rejects unsupported formats and declared blocks beyond the buffer', () => {
    const fixture = createFixture(5, [0])
    expect(decodeNitroTexture(fixture.bytes, fixture.set, fixture.texture, palette)).toBeUndefined()
    fixture.texture.format = 2
    fixture.set.block1Length = fixture.bytes.length + 1
    expect(decodeNitroTexture(fixture.bytes, fixture.set, fixture.texture, palette)).toBeUndefined()
    fixture.set.block1Length = 64
    fixture.set.block4Length = fixture.bytes.length
    expect(decodeNitroTexture(fixture.bytes, fixture.set, fixture.texture, palette)).toBeUndefined()
  })
})