import { describe, expect, it } from 'vitest'
import { decodeObjectGraphicsTable, locateObjectGraphicsTable } from './objectGraphics'

function writeEntry(view: DataView, offset: number, spriteId: number, mapModelId: number, flags = 0): void {
  view.setUint16(offset, spriteId, true)
  view.setUint16(offset + 2, mapModelId, true)
  view.setUint16(offset + 4, flags, true)
}

describe('HGSS object graphics table', () => {
  it('locates the signature and decodes entries through the sentinel', () => {
    const tableOffset = 10
    const bytes = new Uint8Array(tableOffset + 10 * 6)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < 8; index += 1) writeEntry(view, tableOffset + index * 6, index + 1, index)
    writeEntry(view, tableOffset + 8 * 6, 365, 159, 0x140)
    writeEntry(view, tableOffset + 9 * 6, 0xffff, 0, 0xfc00)

    expect(locateObjectGraphicsTable(bytes)).toBe(tableOffset)
    expect(decodeObjectGraphicsTable(bytes)).toHaveLength(9)
    expect(decodeObjectGraphicsTable(bytes).at(-1)).toEqual({ spriteId: 365, mapModelId: 159, flags: 0x140 })
  })

  it('rejects absent, ambiguous, and unterminated tables', () => {
    expect(() => locateObjectGraphicsTable(new Uint8Array(64))).toThrow('0 candidate')
    const bytes = new Uint8Array(2 * 9 * 6)
    const view = new DataView(bytes.buffer)
    for (const tableOffset of [0, 9 * 6]) {
      for (let index = 0; index < 8; index += 1) writeEntry(view, tableOffset + index * 6, index + 1, index)
      writeEntry(view, tableOffset + 8 * 6, 0xffff, 0)
    }
    expect(() => locateObjectGraphicsTable(bytes)).toThrow('2 candidate')
    expect(() => decodeObjectGraphicsTable(bytes.subarray(0, 8 * 6), 0)).toThrow('sentinelle')
  })
})