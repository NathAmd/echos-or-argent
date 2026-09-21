import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import {
  decodeHgssPhotoData,
  decodeHgssPhotoDataCatalog,
  HGSS_PHOTO_DATA_ARCHIVE_PATH,
  hgssPhotoDataCount,
  hgssPhotoDataRecordSize,
} from './photoData'

function record(id: number): Uint8Array {
  const payload = new Uint8Array(hgssPhotoDataRecordSize)
  const view = new DataView(payload.buffer)
  view.setUint16(0, 100 + id, true)
  view.setUint16(2, id % 8, true)
  view.setUint16(4, 20 + id, true)
  view.setUint16(6, 40 + id, true)
  payload[8] = 1
  payload[9] = 0xff
  view.setUint16(10, id === 91 ? 0x123 : 0, true)
  view.setUint16(12, id * 2, true)
  view.setUint16(14, id * 2 + 1, true)
  return payload
}

function archive(): { rom: Uint8Array, archive: RomFile } {
  const rom = new Uint8Array(hgssPhotoDataCount * hgssPhotoDataRecordSize)
  for (let id = 0; id < hgssPhotoDataCount; id += 1) rom.set(record(id), id * hgssPhotoDataRecordSize)
  return {
    rom,
    archive: {
      id: 0,
      path: HGSS_PHOTO_DATA_ARCHIVE_PATH,
      offset: 0,
      size: rom.byteLength,
      signature: 'N A R C',
      archiveEntries: hgssPhotoDataCount,
      archiveMembers: Array.from({ length: hgssPhotoDataCount }, (_, index) => ({
        index,
        offset: index * hgssPhotoDataRecordSize,
        size: hgssPhotoDataRecordSize,
        signature: '',
      })),
    },
  }
}

describe('HGSS PhotoData', () => {
  it('décode exactement les huit champs du membre a/2/5/4', () => {
    expect(decodeHgssPhotoData(record(37), 37)).toEqual({
      id: 37,
      mapId: 137,
      iconId: 5,
      x: 57,
      z: 77,
      unk8: 1,
      unk9: 0xff,
      subjectSpriteId: 0,
      parameters: [74, 75],
    })
  })

  it('décode les 93 membres contigus du catalogue natif', () => {
    const source = archive()
    const catalog = decodeHgssPhotoDataCatalog(source.rom, source.archive)
    expect(catalog).toHaveLength(93)
    expect(catalog[91]).toMatchObject({ id: 91, mapId: 191, subjectSpriteId: 0x123 })
  })

  it('rejette une taille, une icône, un chemin ou un index non natifs', () => {
    expect(() => decodeHgssPhotoData(new Uint8Array(15), 0)).toThrow('15 octets')
    const invalidIcon = record(0)
    new DataView(invalidIcon.buffer).setUint16(2, 0x80, true)
    expect(() => decodeHgssPhotoData(invalidIcon, 0)).toThrow('icône')
    const source = archive()
    expect(() => decodeHgssPhotoDataCatalog(source.rom, { ...source.archive, path: '/a/0/0/0' })).toThrow(HGSS_PHOTO_DATA_ARCHIVE_PATH)
    expect(() => decodeHgssPhotoDataCatalog(source.rom, { ...source.archive, archiveMembers: source.archive.archiveMembers.slice(1) })).toThrow('92 entrées')
    const members = source.archive.archiveMembers.map((member) => ({ ...member }))
    members[12]!.index = 13
    expect(() => decodeHgssPhotoDataCatalog(source.rom, { ...source.archive, archiveMembers: members })).toThrow('contiguë')
  })
})
