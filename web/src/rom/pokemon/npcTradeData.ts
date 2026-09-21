import type { RomFile } from '../../ndsTypes'
import { stripMessageControls } from '../messages/hgssMessageBank'

export const hgssNpcTradeCount = 13
export const hgssNpcTradeDataSize = 0x54

export type HgssNpcTrade = {
  tradeId: number
  givenSpeciesId: number
  requestedSpeciesId: number
  individualValues: {
    hp: number
    attack: number
    defense: number
    speed: number
    specialAttack: number
    specialDefense: number
  }
  ability: number
  originalTrainerId: number
  personality: number
  heldItemId: number
  originalTrainerGender: 'male' | 'female'
  language: number
  nickname: string
  originalTrainerName: string
  unusedFlag: number
}

export function decodeHgssNpcTrade(payload: Uint8Array, tradeId: number, nickname: string, originalTrainerName: string): HgssNpcTrade {
  if (!Number.isInteger(tradeId) || tradeId < 0 || tradeId >= hgssNpcTradeCount) {
    throw new Error(`L'échange interne HGSS ${tradeId} est invalide.`)
  }
  if (payload.byteLength !== hgssNpcTradeDataSize) {
    throw new Error(`L'échange interne HGSS ${tradeId} mesure ${payload.byteLength} octets au lieu de ${hgssNpcTradeDataSize}.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const read = (offset: number) => view.getUint32(offset, true)
  const individualValues = {
    hp: read(0x04),
    attack: read(0x08),
    defense: read(0x0c),
    speed: read(0x10),
    specialAttack: read(0x14),
    specialDefense: read(0x18),
  }
  for (const [stat, value] of Object.entries(individualValues)) {
    if (value > 31) throw new Error(`L'IV ${stat}=${value} de l'échange interne HGSS ${tradeId} est invalide.`)
  }
  const gender = read(0x40)
  if (gender > 1) throw new Error(`Le genre OT ${gender} de l'échange interne HGSS ${tradeId} est invalide.`)
  return {
    tradeId,
    givenSpeciesId: read(0x00),
    requestedSpeciesId: read(0x4c),
    individualValues,
    ability: read(0x1c),
    originalTrainerId: read(0x20),
    personality: read(0x38),
    heldItemId: read(0x3c),
    originalTrainerGender: gender === 0 ? 'male' : 'female',
    language: read(0x48),
    nickname: stripMessageControls(nickname),
    originalTrainerName: stripMessageControls(originalTrainerName),
    unusedFlag: read(0x50),
  }
}

export function decodeHgssNpcTradeCatalog(
  rom: Uint8Array,
  archive: RomFile,
  names: Record<number, string>,
): HgssNpcTrade[] {
  if (archive.archiveMembers.length !== hgssNpcTradeCount) {
    throw new Error(`L'archive ROM des échanges internes contient ${archive.archiveMembers.length} membres au lieu de ${hgssNpcTradeCount}.`)
  }
  return archive.archiveMembers.map((member, tradeId) => decodeHgssNpcTrade(
    rom.subarray(member.offset, member.offset + member.size),
    tradeId,
    names[tradeId] ?? '',
    names[tradeId + hgssNpcTradeCount] ?? '',
  ))
}
