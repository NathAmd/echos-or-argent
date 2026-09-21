import type { RomFile } from '../../ndsTypes'

export const HGSS_PHOTO_DATA_ARCHIVE_PATH = '/a/2/5/4'
export const hgssPhotoDataRecordSize = 0x10
export const hgssPhotoDataCount = 93

/**
 * PhotoData lu par FieldSystem_TakePhoto dans l'archive native a/2/5/4.
 * Les deux derniers mots sont transmis tels quels à Photo_InitFromArcData.
 */
export type HgssPhotoData = {
  id: number
  mapId: number
  iconId: number
  x: number
  z: number
  unk8: number
  unk9: number
  subjectSpriteId: number
  parameters: readonly [number, number]
}

export type HgssPhotoDataCatalog = readonly HgssPhotoData[]

export function decodeHgssPhotoData(payload: Uint8Array, id: number): HgssPhotoData {
  if (!Number.isInteger(id) || id < 0) throw new Error(`L'identifiant PhotoData HGSS ${id} est invalide.`)
  if (payload.byteLength !== hgssPhotoDataRecordSize) {
    throw new Error(`PhotoData HGSS ${id} contient ${payload.byteLength} octets au lieu de ${hgssPhotoDataRecordSize}.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const iconId = view.getUint16(2, true)
  // Photo::iconId est un champ de sept bits dans la sauvegarde native.
  if (iconId > 0x7f) throw new Error(`PhotoData HGSS ${id} référence l'icône ${iconId}, hors du champ natif.`)
  return {
    id,
    mapId: view.getUint16(0, true),
    iconId,
    x: view.getUint16(4, true),
    z: view.getUint16(6, true),
    unk8: payload[8]!,
    unk9: payload[9]!,
    subjectSpriteId: view.getUint16(10, true),
    parameters: [view.getUint16(12, true), view.getUint16(14, true)],
  }
}

export function decodeHgssPhotoDataCatalog(rom: Uint8Array, archive: RomFile): HgssPhotoDataCatalog {
  if (archive.path !== HGSS_PHOTO_DATA_ARCHIVE_PATH) {
    throw new Error(`L'archive PhotoData HGSS attendue est ${HGSS_PHOTO_DATA_ARCHIVE_PATH}, pas ${archive.path}.`)
  }
  if (archive.archiveMembers.length !== hgssPhotoDataCount) {
    throw new Error(`L'archive PhotoData HGSS contient ${archive.archiveMembers.length} entrées au lieu de ${hgssPhotoDataCount}.`)
  }
  return archive.archiveMembers.map((member, id) => {
    if (member.index !== id) throw new Error(`L'archive PhotoData HGSS n'est pas contiguë à l'entrée ${id}.`)
    if (member.offset < 0 || member.size !== hgssPhotoDataRecordSize || member.offset + member.size > rom.byteLength) {
      throw new Error(`Le membre PhotoData HGSS ${id} est absent, tronqué ou dépasse la ROM.`)
    }
    return decodeHgssPhotoData(rom.subarray(member.offset, member.offset + member.size), id)
  })
}
