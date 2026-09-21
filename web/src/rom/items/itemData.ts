import type { RomFile } from '../../ndsTypes'
import { stripMessageControls } from '../messages/hgssMessageBank'

export const hgssItemDataSize = 0x22
export const hgssItemCount = 537
export const hgssItemDataMemberCount = 514

/** Table native sTMHMMoves, indexée par ITEM_TM01 (328) à ITEM_HM08 (427). */
const hgssTmHmMoveIds = [
  264, 337, 352, 347, 46, 92, 258, 339, 331, 237, 241, 269, 58, 59, 63, 113, 182, 240, 202, 219,
  218, 76, 231, 85, 87, 89, 216, 91, 94, 247, 280, 104, 115, 351, 53, 188, 201, 126, 317, 332,
  259, 263, 290, 156, 213, 168, 211, 285, 289, 315, 355, 411, 412, 206, 362, 374, 451, 203, 406, 409,
  261, 318, 373, 153, 421, 371, 278, 416, 397, 148, 444, 419, 86, 360, 14, 446, 244, 445, 399, 157,
  404, 214, 363, 398, 138, 447, 207, 365, 369, 164, 430, 433, 15, 19, 57, 70, 250, 249, 127, 431,
] as const

export function getHgssTmHmMoveId(itemId: number): number {
  return hgssTmHmMoveIds[itemId - 328] ?? 0
}

export type HgssItemPocket = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export type HgssItemPartyParameters = {
  sleepHeal: boolean
  poisonHeal: boolean
  burnHeal: boolean
  freezeHeal: boolean
  paralysisHeal: boolean
  confusionHeal: boolean
  infatuationHeal: boolean
  guardSpec: boolean
  revive: boolean
  reviveAll: boolean
  levelUp: boolean
  evolve: boolean
  attackStages: number
  defenseStages: number
  specialAttackStages: number
  specialDefenseStages: number
  speedStages: number
  accuracyStages: number
  criticalRateStages: number
  ppUp: boolean
  ppMax: boolean
  ppRestore: boolean
  ppRestoreAll: boolean
  hpRestore: boolean
  hpEvUp: boolean
  attackEvUp: boolean
  defenseEvUp: boolean
  speedEvUp: boolean
  specialAttackEvUp: boolean
  specialDefenseEvUp: boolean
  friendshipLow: boolean
  friendshipMedium: boolean
  friendshipHigh: boolean
  hpEvParameter: number
  attackEvParameter: number
  defenseEvParameter: number
  speedEvParameter: number
  specialAttackEvParameter: number
  specialDefenseEvParameter: number
  hpRestoreParameter: number
  ppRestoreParameter: number
  friendshipLowParameter: number
  friendshipMediumParameter: number
  friendshipHighParameter: number
}

export const hgssItemPocketLabels: readonly string[] = [
  'OBJETS',
  'MEDICAMENTS',
  'BALLS',
  'CT & CS',
  'BAIES',
  'LETTRES',
  'OBJETS COMBAT',
  'OBJETS RARES',
]

export type HgssItemData = {
  itemId: number
  name: string
  description: string
  price: number
  holdEffect: number
  holdEffectParameter: number
  pluckEffect: number
  flingEffect: number
  flingPower: number
  naturalGiftPower: number
  naturalGiftType: number
  preventToss: boolean
  selectable: boolean
  fieldPocket: HgssItemPocket
  battlePocket: number
  fieldUseFunction: number
  battleUseFunction: number
  partyUse: number
  partyParameters: HgssItemPartyParameters
}

export type HgssItemCatalog = {
  items: HgssItemData[]
  pocketNames: readonly string[]
}

/** Reproduit sItemNarcIds[ITEMNARC_PARAM] de HGSS. */
export function getHgssItemDataMemberIndex(itemId: number): number {
  if (!Number.isInteger(itemId) || itemId < 0 || itemId >= hgssItemCount) {
    throw new Error(`L'identifiant d'objet ${itemId} est invalide.`)
  }
  if (itemId <= 112) return itemId
  if (itemId <= 134 || itemId === 428) return 0
  return itemId <= 427 ? itemId - 22 : itemId - 23
}

export function decodeHgssItemData(payload: Uint8Array, itemId: number, name: string, description: string): HgssItemData {
  if (!Number.isInteger(itemId) || itemId < 0) throw new Error(`L'identifiant d'objet ${itemId} est invalide.`)
  if (payload.byteLength !== hgssItemDataSize) {
    throw new Error(`Les données HGSS de l'objet ${itemId} mesurent ${payload.byteLength} octets au lieu de ${hgssItemDataSize}.`)
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const pocketFlags = view.getUint16(8, true)
  const fieldPocket = (pocketFlags >>> 7) & 0xf
  if (fieldPocket > 7) throw new Error(`La poche HGSS ${fieldPocket} de l'objet ${itemId} est invalide.`)
  const statusFlags = payload[0x0e]!
  const reviveFlags = payload[0x0f]!
  const statFlags1 = payload[0x10]!
  const statFlags2 = payload[0x11]!
  const moveFlags = payload[0x12]!
  const restoreFlags = payload[0x13]!
  const friendshipFlags = payload[0x14]!

  return {
    itemId,
    name: stripMessageControls(name),
    description: stripMessageControls(description),
    price: view.getUint16(0, true),
    holdEffect: payload[2]!,
    holdEffectParameter: payload[3]!,
    pluckEffect: payload[4]!,
    flingEffect: payload[5]!,
    flingPower: payload[6]!,
    naturalGiftPower: payload[7]!,
    naturalGiftType: pocketFlags & 0x1f,
    preventToss: (pocketFlags & 0x20) !== 0,
    selectable: (pocketFlags & 0x40) !== 0,
    fieldPocket: fieldPocket as HgssItemPocket,
    battlePocket: (pocketFlags >>> 11) & 0x1f,
    fieldUseFunction: payload[0x0a]!,
    battleUseFunction: payload[0x0b]!,
    partyUse: payload[0x0c]!,
    partyParameters: {
      sleepHeal: (statusFlags & 0x01) !== 0,
      poisonHeal: (statusFlags & 0x02) !== 0,
      burnHeal: (statusFlags & 0x04) !== 0,
      freezeHeal: (statusFlags & 0x08) !== 0,
      paralysisHeal: (statusFlags & 0x10) !== 0,
      confusionHeal: (statusFlags & 0x20) !== 0,
      infatuationHeal: (statusFlags & 0x40) !== 0,
      guardSpec: (statusFlags & 0x80) !== 0,
      revive: (reviveFlags & 0x01) !== 0,
      reviveAll: (reviveFlags & 0x02) !== 0,
      levelUp: (reviveFlags & 0x04) !== 0,
      evolve: (reviveFlags & 0x08) !== 0,
      attackStages: reviveFlags >>> 4,
      defenseStages: statFlags1 & 0x0f,
      specialAttackStages: statFlags1 >>> 4,
      specialDefenseStages: statFlags2 & 0x0f,
      speedStages: statFlags2 >>> 4,
      accuracyStages: moveFlags & 0x0f,
      criticalRateStages: (moveFlags >>> 4) & 0x03,
      ppUp: (moveFlags & 0x40) !== 0,
      ppMax: (moveFlags & 0x80) !== 0,
      ppRestore: (restoreFlags & 0x01) !== 0,
      ppRestoreAll: (restoreFlags & 0x02) !== 0,
      hpRestore: (restoreFlags & 0x04) !== 0,
      hpEvUp: (restoreFlags & 0x08) !== 0,
      attackEvUp: (restoreFlags & 0x10) !== 0,
      defenseEvUp: (restoreFlags & 0x20) !== 0,
      speedEvUp: (restoreFlags & 0x40) !== 0,
      specialAttackEvUp: (restoreFlags & 0x80) !== 0,
      specialDefenseEvUp: (friendshipFlags & 0x01) !== 0,
      friendshipLow: (friendshipFlags & 0x02) !== 0,
      friendshipMedium: (friendshipFlags & 0x04) !== 0,
      friendshipHigh: (friendshipFlags & 0x08) !== 0,
      hpEvParameter: view.getInt8(0x15),
      attackEvParameter: view.getInt8(0x16),
      defenseEvParameter: view.getInt8(0x17),
      speedEvParameter: view.getInt8(0x18),
      specialAttackEvParameter: view.getInt8(0x19),
      specialDefenseEvParameter: view.getInt8(0x1a),
      hpRestoreParameter: payload[0x1b]!,
      ppRestoreParameter: payload[0x1c]!,
      friendshipLowParameter: view.getInt8(0x1d),
      friendshipMediumParameter: view.getInt8(0x1e),
      friendshipHighParameter: view.getInt8(0x1f),
    },
  }
}

export function decodeHgssItemCatalog(
  rom: Uint8Array,
  archive: RomFile,
  names: Record<number, string> | undefined,
  descriptions: Record<number, string> | undefined,
  pocketNames: Record<number, string> | undefined,
): HgssItemCatalog {
  if (!names || !descriptions || !pocketNames) {
    throw new Error('Les banques ROM HGSS des noms, descriptions ou poches d’objets sont absentes ou invalides.')
  }
  if (archive.archiveMembers.length !== hgssItemDataMemberCount) {
    throw new Error(`L'archive HGSS des objets contient ${archive.archiveMembers.length} membres au lieu de ${hgssItemDataMemberCount}.`)
  }

  archive.archiveMembers.forEach((member, index) => {
    if (member.index !== index) throw new Error(`L'archive HGSS des objets n'est pas contiguë au membre ${member.index}.`)
    if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
      throw new Error(`Le membre HGSS ${index} des objets est hors des limites de la ROM.`)
    }
  })

  const items = Array.from({ length: hgssItemCount }, (_, itemId) => {
    const member = archive.archiveMembers[getHgssItemDataMemberIndex(itemId)]!
    const name = names[itemId]
    const description = descriptions[itemId]
    if (name === undefined || description === undefined) {
      throw new Error(`Les textes ROM HGSS de l'objet ${itemId} sont absents.`)
    }
    return decodeHgssItemData(rom.subarray(member.offset, member.offset + member.size), itemId, name, description)
  })
  const decodedPocketNames = Array.from({ length: 8 }, (_, pocket) => {
    const name = pocketNames[pocket]
    if (name === undefined) throw new Error(`Le nom ROM HGSS de la poche ${pocket} est absent.`)
    const decoded = stripMessageControls(name)
    if (!decoded) throw new Error(`Le nom ROM HGSS de la poche ${pocket} est vide.`)
    return decoded
  })
  return { items, pocketNames: decodedPocketNames }
}

export function getHgssItem(catalog: HgssItemCatalog, itemId: number): HgssItemData {
  const item = catalog.items[itemId]
  if (!item) throw new Error(`L'objet ROM HGSS ${itemId} est absent du catalogue.`)
  return item
}
