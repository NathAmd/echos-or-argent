import type { NitroGraphic, RomFile } from '../../ndsTypes'
import { decodeNitroGraphicPayload } from '../graphics/nitro2d'
import { readArm9FromRom } from '../maps/mapHeaders'
import { getHgssItemDataMemberIndex, hgssItemCount } from './itemData'

export const hgssItemResourceEntrySize = 8

export type HgssItemResourceIndexes = {
  itemId: number
  dataMember: number
  graphicMember: number
  paletteMember: number
  generation3ItemId: number
}

function matchesItemDataSignature(view: DataView, offset: number): boolean {
  const signatureIds = [0, 1, 2, 3, 4, 16, 17, 112, 113, 134, 135, 428, 429, 536] as const
  return signatureIds.every((itemId) => (
    view.getUint16(offset + itemId * hgssItemResourceEntrySize, true) === getHgssItemDataMemberIndex(itemId)
  ))
}

export function locateHgssItemResourceTable(arm9: Uint8Array): number {
  const tableSize = hgssItemCount * hgssItemResourceEntrySize
  const view = new DataView(arm9.buffer, arm9.byteOffset, arm9.byteLength)
  const matches: number[] = []
  for (let offset = 0; offset + tableSize <= arm9.byteLength; offset += 2) {
    if (!matchesItemDataSignature(view, offset)) continue
    let valid = true
    for (let itemId = 0; itemId < hgssItemCount; itemId += 1) {
      if (view.getUint16(offset + itemId * hgssItemResourceEntrySize, true) !== getHgssItemDataMemberIndex(itemId)) {
        valid = false
        break
      }
    }
    if (valid) matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table ARM9 des ressources objets HGSS doit être unique; ${matches.length} candidate(s) trouvée(s).`)
  }
  return matches[0]!
}

export function decodeHgssItemResourceIndexes(arm9: Uint8Array, tableOffset = locateHgssItemResourceTable(arm9)): HgssItemResourceIndexes[] {
  const tableSize = hgssItemCount * hgssItemResourceEntrySize
  if (!Number.isInteger(tableOffset) || tableOffset < 0 || tableOffset + tableSize > arm9.byteLength) {
    throw new Error('La table ARM9 des ressources objets HGSS est hors limites.')
  }
  const view = new DataView(arm9.buffer, arm9.byteOffset + tableOffset, tableSize)
  return Array.from({ length: hgssItemCount }, (_, itemId) => {
    const offset = itemId * hgssItemResourceEntrySize
    return {
      itemId,
      dataMember: view.getUint16(offset, true),
      graphicMember: view.getUint16(offset + 2, true),
      paletteMember: view.getUint16(offset + 4, true),
      generation3ItemId: view.getUint16(offset + 6, true),
    }
  })
}

function readArchivePayload(rom: Uint8Array, archive: RomFile, memberIndex: number): Uint8Array {
  const member = archive.archiveMembers[memberIndex]
  if (!member) throw new Error(`Le membre ${memberIndex} de l'archive d'icônes objets HGSS est absent.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre ${memberIndex} de l'archive d'icônes objets HGSS est hors limites.`)
  }
  return rom.subarray(member.offset, member.offset + member.size)
}

export function createHgssItemIconResolver(rom: Uint8Array, archive: RomFile): (itemId: number) => NitroGraphic {
  const indexes = decodeHgssItemResourceIndexes(readArm9FromRom(rom))
  const cache = new Map<number, NitroGraphic>()
  return (itemId: number): NitroGraphic => {
    if (!Number.isInteger(itemId) || itemId < 0 || itemId >= hgssItemCount) {
      throw new Error(`L'identifiant d'objet ${itemId} est invalide.`)
    }
    const cached = cache.get(itemId)
    if (cached) return cached
    const entry = indexes[itemId]!
    const graphic = decodeNitroGraphicPayload(
      readArchivePayload(rom, archive, entry.graphicMember),
      readArchivePayload(rom, archive, entry.paletteMember),
    )
    if (!graphic) throw new Error(`L'icône ROM HGSS de l'objet ${itemId} est invalide.`)
    cache.set(itemId, graphic)
    return graphic
  }
}
