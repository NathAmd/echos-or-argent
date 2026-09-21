import type { NitroGraphic, RomFile } from '../../ndsTypes'
import { decodeNitroCellGraphicPayload } from '../graphics/nitroCells'

const membersPerTrainerClass = 5

function requireMember(rom: Uint8Array, archive: RomFile, index: number): Uint8Array {
  const member = archive.archiveMembers[index]
  if (!member || member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`La ressource ROM du portrait de Dresseur ${index} est absente.`)
  }
  return rom.slice(member.offset, member.offset + member.size)
}

/**
 * sub_02070D3C range les portraits de face par classe dans /a/0/5/8 :
 * NCGR, NCLR, NCER, NANR et NCBR. Le premier frame 80×80 est la pose d'entrée.
 */
export function createHgssTrainerBattleSpriteResolver(
  rom: Uint8Array,
  archive: RomFile,
): (trainerClass: number) => NitroGraphic {
  const cache = new Map<number, NitroGraphic>()
  return (trainerClass) => {
    if (!Number.isInteger(trainerClass) || trainerClass < 0) throw new Error(`La classe de Dresseur ${trainerClass} est invalide.`)
    const cached = cache.get(trainerClass)
    if (cached) return cached
    const graphicIndex = trainerClass * membersPerTrainerClass
    const graphic = decodeNitroCellGraphicPayload(
      requireMember(rom, archive, graphicIndex),
      requireMember(rom, archive, graphicIndex + 1),
      requireMember(rom, archive, graphicIndex + 2),
      0,
      true,
    )
    if (!graphic) throw new Error(`Le portrait de la classe de Dresseur ${trainerClass} est indécodable.`)
    cache.set(trainerClass, graphic)
    return graphic
  }
}
