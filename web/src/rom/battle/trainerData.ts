import type { RomFile } from '../../ndsTypes'

export const hgssTrainerDataSize = 0x14

export type HgssTrainerPokemon = {
  difficulty: number
  genderOverride: number
  abilityOverride: number
  level: number
  speciesId: number
  form: number
  heldItemId?: number
  moveIds?: readonly [number, number, number, number]
  capsule: number
}

export type HgssTrainer = {
  trainerId: number
  trainerType: number
  trainerClass: number
  partySize: number
  items: readonly [number, number, number, number]
  aiFlags: number
  doubleBattle: boolean
  party: HgssTrainerPokemon[]
}

function requireTrainerId(trainerId: number): void {
  if (!Number.isInteger(trainerId) || trainerId < 0) throw new Error(`L'identifiant de dresseur HGSS ${trainerId} est invalide.`)
}

function getPartyRecordSize(trainerType: number): number {
  if (!Number.isInteger(trainerType) || trainerType < 0 || trainerType > 3) {
    throw new Error(`Le type de dresseur HGSS ${trainerType} n'est pas pris en charge.`)
  }
  return 8 + (trainerType & 2 ? 2 : 0) + (trainerType & 1 ? 8 : 0)
}

export function decodeHgssTrainer(
  dataPayload: Uint8Array,
  partyPayload: Uint8Array,
  trainerId: number,
): HgssTrainer {
  requireTrainerId(trainerId)
  if (dataPayload.byteLength !== hgssTrainerDataSize) {
    throw new Error(`Les donnees HGSS du dresseur ${trainerId} mesurent ${dataPayload.byteLength} octets au lieu de ${hgssTrainerDataSize}.`)
  }
  const data = new DataView(dataPayload.buffer, dataPayload.byteOffset, dataPayload.byteLength)
  const trainerType = dataPayload[0]!
  const partySize = dataPayload[3]!
  if (partySize > 6) throw new Error(`Le dresseur HGSS ${trainerId} contient ${partySize} Pokemon au lieu de 6 au maximum.`)
  const recordSize = getPartyRecordSize(trainerType)
  const usefulSize = partySize === 0 ? 8 : partySize * recordSize
  const alignedSize = Math.ceil(usefulSize / 4) * 4
  if (partyPayload.byteLength !== usefulSize && partyPayload.byteLength !== alignedSize) {
    throw new Error(`L'equipe HGSS du dresseur ${trainerId} mesure ${partyPayload.byteLength} octets au lieu de ${usefulSize} ou ${alignedSize}.`)
  }
  if (partyPayload.subarray(usefulSize).some((value) => value !== 0)) {
    throw new Error(`Le padding de l'equipe HGSS du dresseur ${trainerId} n'est pas nul.`)
  }
  const partyView = new DataView(partyPayload.buffer, partyPayload.byteOffset, partyPayload.byteLength)
  const party = Array.from({ length: partySize }, (_, index): HgssTrainerPokemon => {
    const offset = index * recordSize
    const packedSpecies = partyView.getUint16(offset + 4, true)
    let cursor = offset + 6
    const heldItemId = trainerType & 2 ? partyView.getUint16(cursor, true) : undefined
    if (heldItemId !== undefined) cursor += 2
    const moveIds = trainerType & 1
      ? [
          partyView.getUint16(cursor, true),
          partyView.getUint16(cursor + 2, true),
          partyView.getUint16(cursor + 4, true),
          partyView.getUint16(cursor + 6, true),
        ] as const
      : undefined
    if (moveIds) cursor += 8
    const override = partyPayload[offset + 1]!
    return {
      difficulty: partyPayload[offset]!,
      genderOverride: override & 0x0f,
      abilityOverride: override >>> 4,
      level: partyView.getUint16(offset + 2, true),
      speciesId: packedSpecies & 0x03ff,
      form: packedSpecies >>> 10,
      heldItemId,
      moveIds,
      capsule: partyView.getUint16(cursor, true),
    }
  })
  return {
    trainerId,
    trainerType,
    trainerClass: dataPayload[1]!,
    partySize,
    items: [
      data.getUint16(4, true),
      data.getUint16(6, true),
      data.getUint16(8, true),
      data.getUint16(10, true),
    ],
    aiFlags: data.getUint32(12, true),
    doubleBattle: data.getUint32(16, true) !== 0,
    party,
  }
}

export function decodeHgssTrainerFromArchives(
  rom: Uint8Array,
  dataArchive: RomFile,
  partyArchive: RomFile,
  trainerId: number,
): HgssTrainer {
  requireTrainerId(trainerId)
  const dataMember = dataArchive.archiveMembers[trainerId]
  const partyMember = partyArchive.archiveMembers[trainerId]
  if (!dataMember || !partyMember) throw new Error(`Le dresseur HGSS ${trainerId} est absent des archives ROM.`)
  return decodeHgssTrainer(
    rom.subarray(dataMember.offset, dataMember.offset + dataMember.size),
    rom.subarray(partyMember.offset, partyMember.offset + partyMember.size),
    trainerId,
  )
}

export function decodeHgssTrainerCatalog(rom: Uint8Array, dataArchive: RomFile, partyArchive: RomFile): HgssTrainer[] {
  if (dataArchive.archiveMembers.length !== partyArchive.archiveMembers.length) {
    throw new Error(`Les archives HGSS de dresseurs ont ${dataArchive.archiveMembers.length} et ${partyArchive.archiveMembers.length} membres.`)
  }
  return dataArchive.archiveMembers.map((member, trainerId) => {
    if (member.index !== trainerId || partyArchive.archiveMembers[trainerId]?.index !== trainerId) {
      throw new Error(`Les archives HGSS de dresseurs ne sont pas contigues a l'identifiant ${trainerId}.`)
    }
    return decodeHgssTrainerFromArchives(rom, dataArchive, partyArchive, trainerId)
  })
}