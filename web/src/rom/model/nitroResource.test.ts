import { describe, expect, it } from 'vitest'
import { decodeNitroAscii, hasNitroMagic, readNitroDictionary, readNitroFixedNames, readNitroInfoOffsets, type NitroResourceView } from './nitroResource'

function resource(bytes: Uint8Array, baseOffset = 0, fileSize = bytes.length - baseOffset): NitroResourceView {
  return { bytes, baseOffset, fileSize, view: new DataView(bytes.buffer, bytes.byteOffset + baseOffset, fileSize) }
}

describe('Nitro resource primitives', () => {
  it('reads fixed ASCII names and magic without leaking trailing zeroes', () => {
    const bytes = new Uint8Array(40)
    bytes.set([66, 77, 68, 48], 0)
    bytes.set([84, 69, 88], 8)
    expect(hasNitroMagic(bytes, 0, 'BMD0')).toBe(true)
    expect(decodeNitroAscii(bytes.subarray(8, 24))).toBe('TEX')
    expect(readNitroFixedNames(resource(bytes), 8, 2)).toEqual(['TEX', ''])
  })

  it('reads a bounded Nitro dictionary relative to its resource base', () => {
    const bytes = new Uint8Array(80)
    const baseOffset = 8
    const view = new DataView(bytes.buffer, baseOffset)
    view.setUint8(1, 1)
    view.setUint16(2, 40, true)
    view.setUint16(16, 4, true)
    view.setUint32(20, 0x12345678, true)
    bytes.set([77, 65, 84], baseOffset + 24)
    expect(readNitroDictionary(resource(bytes, baseOffset), 0, (offset) => view.getUint32(offset, true))).toEqual([
      { name: 'MAT', value: 0x12345678 },
    ])
    view.setUint16(2, 79, true)
    expect(readNitroDictionary(resource(bytes, baseOffset), 0, () => 0)).toEqual([])
  })

  it('rejects out-of-bounds info blocks', () => {
    const bytes = new Uint8Array(32)
    const view = new DataView(bytes.buffer)
    view.setUint8(1, 1)
    view.setUint32(20, 12, true)
    expect(readNitroInfoOffsets(resource(bytes), 0)).toEqual([12])
    view.setUint8(1, 4)
    expect(readNitroInfoOffsets(resource(bytes), 0)).toEqual([])
  })
})
