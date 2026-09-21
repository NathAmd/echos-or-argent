import { describe, expect, it } from 'vitest'
import { getHgssItemDataMemberIndex, hgssItemCount } from './itemData'
import { decodeHgssItemResourceIndexes, hgssItemResourceEntrySize, locateHgssItemResourceTable } from './itemIcons'

function createTableFixture(prefix = 24): Uint8Array {
  const bytes = new Uint8Array(prefix + hgssItemCount * hgssItemResourceEntrySize + 8)
  const view = new DataView(bytes.buffer)
  for (let itemId = 0; itemId < hgssItemCount; itemId += 1) {
    const offset = prefix + itemId * hgssItemResourceEntrySize
    view.setUint16(offset, getHgssItemDataMemberIndex(itemId), true)
    view.setUint16(offset + 2, itemId + 1000, true)
    view.setUint16(offset + 4, itemId + 2000, true)
    view.setUint16(offset + 6, itemId + 3000, true)
  }
  return bytes
}

describe('HGSS item icon resource table', () => {
  it('locates and decodes the unique native four-column table', () => {
    const arm9 = createTableFixture()

    expect(locateHgssItemResourceTable(arm9)).toBe(24)
    expect(decodeHgssItemResourceIndexes(arm9)[428]).toEqual({
      itemId: 428,
      dataMember: 0,
      graphicMember: 1428,
      paletteMember: 2428,
      generation3ItemId: 3428,
    })
  })

  it('rejects absent, duplicate, and out-of-bounds tables', () => {
    expect(() => locateHgssItemResourceTable(new Uint8Array(5000))).toThrow('0 candidate')
    const fixture = createTableFixture()
    const duplicate = new Uint8Array(fixture.byteLength * 2)
    duplicate.set(fixture)
    duplicate.set(fixture, fixture.byteLength)
    expect(() => locateHgssItemResourceTable(duplicate)).toThrow('2 candidate')
    expect(() => decodeHgssItemResourceIndexes(fixture, fixture.byteLength - 1)).toThrow('hors limites')
  })
})
