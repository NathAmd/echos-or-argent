import { describe, expect, it } from 'vitest'
import { decodeNitroGraphicPayload, decodeNitroTilemapGraphicPayload, findGraphicPreview, readNitroIndexedGraphic, readNitroPalette } from './nitro2d'

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  for (let index = 0; index < magic.length; index += 1) bytes[offset + index] = magic.charCodeAt(index)
}

function createPalette(): Uint8Array {
  const bytes = new Uint8Array(72)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RLCN')
  view.setUint16(12, 16, true)
  writeMagic(bytes, 16, 'TTLP')
  view.setUint32(20, 56, true)
  view.setUint32(32, 32, true)
  view.setUint32(36, 16, true)
  view.setUint16(40, 0x0000, true)
  view.setUint16(42, 0x001f, true)
  return bytes
}

function createPaletteBanks(): Uint8Array {
  const bytes = new Uint8Array(136)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RLCN')
  view.setUint16(12, 16, true)
  writeMagic(bytes, 16, 'TTLP')
  view.setUint32(20, 120, true)
  view.setUint32(32, 96, true)
  view.setUint32(36, 16, true)
  view.setUint16(40 + 2 * 32 + 2, 0x001f, true)
  return bytes
}

function createTileSheet(): Uint8Array {
  const bytes = new Uint8Array(80)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RGCN')
  view.setUint16(12, 16, true)
  writeMagic(bytes, 16, 'RAHC')
  view.setUint32(20, 64, true)
  view.setUint16(24, 1, true)
  view.setUint16(26, 1, true)
  view.setUint32(28, 3, true)
  view.setUint32(40, 32, true)
  bytes[48] = 0x10
  return bytes
}

function createScreenMap(entry: number): Uint8Array {
  const bytes = new Uint8Array(38)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RCSN')
  view.setUint16(12, 16, true)
  writeMagic(bytes, 16, 'NRCS')
  view.setUint32(20, 22, true)
  view.setUint16(24, 8, true)
  view.setUint16(26, 8, true)
  view.setUint32(32, 2, true)
  view.setUint16(36, entry, true)
  return bytes
}

describe('Nitro 2D decoding', () => {
  it('accepts the inverted palette-size field used by official HGSS NCLR resources', () => {
    const palette = createPalette()
    new DataView(palette.buffer).setUint32(32, 0x200 - 32, true)
    expect(readNitroPalette(palette, 0)).toHaveLength(16)
  })

  it('decodes a 4 bpp tile and its RGB555 palette', () => {
    const graphic = createTileSheet()
    const palette = createPalette()
    const combined = new Uint8Array(graphic.length + palette.length)
    combined.set(graphic)
    combined.set(palette, graphic.length)

    expect(readNitroPalette(combined, graphic.length)?.slice(0, 2)).toEqual(new Uint16Array([0, 0x001f]))
    expect(readNitroIndexedGraphic(combined, 0, graphic.length)).toMatchObject({
      width: 8,
      height: 8,
      bitsPerPixel: 4,
      tileCount: 1,
      tilesPerRow: 1,
    })

    const decoded = decodeNitroGraphicPayload(graphic, palette)
    expect(decoded?.pixels.slice(0, 8)).toEqual(new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255]))
    expect(findGraphicPreview(combined)?.pixels.slice(0, 8)).toEqual(decoded?.pixels.slice(0, 8))
  })

  it('applies tilemap horizontal flipping', () => {
    const decoded = decodeNitroTilemapGraphicPayload(createTileSheet(), createPalette(), createScreenMap(0x0400))
    const row = decoded?.pixels.slice(0, 8 * 4)
    expect(row?.slice(6 * 4, 8 * 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]))
  })

  it('selects an explicit 4-bit palette bank', () => {
    const decoded = decodeNitroGraphicPayload(createTileSheet(), createPaletteBanks(), true, 2)
    expect(decoded?.pixels.slice(4, 8)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
  })

  it('rejects truncated or invalid Nitro resources', () => {
    expect(readNitroPalette(createPalette().subarray(0, 60), 0)).toBeUndefined()
    expect(decodeNitroGraphicPayload(createTileSheet().subarray(0, 79), createPalette())).toBeUndefined()
    expect(decodeNitroTilemapGraphicPayload(createTileSheet(), createPalette(), createScreenMap(0).subarray(0, 37))).toBeUndefined()
  })
})
