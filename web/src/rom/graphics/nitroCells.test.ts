import { describe, expect, it } from 'vitest'
import { decodeNitroCellGraphicPayload, readNitroCells } from './nitroCells'

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
  view.setUint16(42, 0x001f, true)
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

function createCell(flipX = false): Uint8Array {
  const bytes = new Uint8Array(62)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RECN')
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  writeMagic(bytes, 16, 'KBEC')
  view.setUint32(20, 46, true)
  view.setUint16(24, 1, true)
  bytes[32] = 0
  view.setUint16(48, 1, true)
  view.setUint32(52, 0, true)
  view.setUint16(56, 0, true)
  view.setUint16(58, flipX ? 0x1000 : 0, true)
  view.setUint16(60, 0, true)
  return bytes
}

describe('Nitro cell decoding', () => {
  it('reads OAM geometry and computed cell bounds', () => {
    expect(readNitroCells(createCell())).toEqual([{
      minX: 0,
      minY: 0,
      maxX: 7,
      maxY: 7,
      width: 8,
      height: 8,
      mappingType: 0,
      oams: [{ x: 0, y: 0, widthTiles: 1, heightTiles: 1, tileIndex: 0, paletteBank: 0, flipX: false, flipY: false }],
    }])
  })

  it('renders an OAM with horizontal flipping', () => {
    const decoded = decodeNitroCellGraphicPayload(createTileSheet(), createPalette(), createCell(true))
    expect(decoded).toMatchObject({ width: 8, height: 8, colorDepth: 4 })
    expect(decoded?.pixels.slice(6 * 4, 8 * 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]))
  })

  it('preserves and renders a transparent placeholder for an empty NANR cell', () => {
    const cell = createCell()
    new DataView(cell.buffer).setUint16(48, 0, true)
    expect(readNitroCells(cell)?.[0]).toMatchObject({ width: 1, height: 1, oams: [] })
    expect(decodeNitroCellGraphicPayload(createTileSheet(), createPalette(), cell)).toMatchObject({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray(4),
    })
  })

  it('rejects truncated cell blocks', () => {
    expect(readNitroCells(createCell().subarray(0, 61))).toBeUndefined()
    expect(decodeNitroCellGraphicPayload(createTileSheet(), createPalette(), createCell(), 1)).toBeUndefined()
  })
})
