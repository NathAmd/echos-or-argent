import type { RomFile } from '../../ndsTypes'

export const hgssWildEncounterDataSize = 0xc4

export type HgssEncounterSlot = {
  speciesId: number
  minLevel: number
  maxLevel: number
}

export type HgssLandEncounterSlot = {
  speciesId: number
  level: number
}

export type HgssWildEncounterData = {
  bankId: number
  rates: {
    walking: number
    surfing: number
    rockSmash: number
    oldRod: number
    goodRod: number
    superRod: number
  }
  land: {
    morning: HgssLandEncounterSlot[]
    day: HgssLandEncounterSlot[]
    night: HgssLandEncounterSlot[]
  }
  hoennSoundSpecies: readonly [number, number]
  sinnohSoundSpecies: readonly [number, number]
  surfing: HgssEncounterSlot[]
  rockSmash: HgssEncounterSlot[]
  oldRod: HgssEncounterSlot[]
  goodRod: HgssEncounterSlot[]
  superRod: HgssEncounterSlot[]
  swarm: {
    landSpeciesId: number
    surfingSpeciesId: number
    nightFishingSpeciesId: number
    fishingSpeciesId: number
  }
}

function decodeSlots(view: DataView, offset: number, count: number): HgssEncounterSlot[] {
  return Array.from({ length: count }, (_, index) => {
    const slotOffset = offset + index * 4
    return {
      minLevel: view.getUint8(slotOffset),
      maxLevel: view.getUint8(slotOffset + 1),
      speciesId: view.getUint16(slotOffset + 2, true),
    }
  })
}

export function decodeHgssWildEncounterData(payload: Uint8Array, bankId: number): HgssWildEncounterData {
  if (!Number.isInteger(bankId) || bankId < 0) throw new Error(`L'identifiant de rencontres HGSS ${bankId} est invalide.`)
  if (payload.byteLength !== hgssWildEncounterDataSize) {
    throw new Error(`Les rencontres HGSS ${bankId} mesurent ${payload.byteLength} octets au lieu de ${hgssWildEncounterDataSize}.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const levels = Array.from(payload.subarray(8, 20))
  const decodeLand = (offset: number): HgssLandEncounterSlot[] => levels.map((level, index) => ({
    level,
    speciesId: view.getUint16(offset + index * 2, true),
  }))
  return {
    bankId,
    rates: {
      walking: payload[0]!,
      surfing: payload[1]!,
      rockSmash: payload[2]!,
      oldRod: payload[3]!,
      goodRod: payload[4]!,
      superRod: payload[5]!,
    },
    land: {
      morning: decodeLand(0x14),
      day: decodeLand(0x2c),
      night: decodeLand(0x44),
    },
    hoennSoundSpecies: [view.getUint16(0x5c, true), view.getUint16(0x5e, true)],
    sinnohSoundSpecies: [view.getUint16(0x60, true), view.getUint16(0x62, true)],
    surfing: decodeSlots(view, 0x64, 5),
    rockSmash: decodeSlots(view, 0x78, 2),
    oldRod: decodeSlots(view, 0x80, 5),
    goodRod: decodeSlots(view, 0x94, 5),
    superRod: decodeSlots(view, 0xa8, 5),
    swarm: {
      landSpeciesId: view.getUint16(0xbc, true),
      surfingSpeciesId: view.getUint16(0xbe, true),
      nightFishingSpeciesId: view.getUint16(0xc0, true),
      fishingSpeciesId: view.getUint16(0xc2, true),
    },
  }
}

export function decodeHgssWildEncounterCatalog(rom: Uint8Array, archive: RomFile): HgssWildEncounterData[] {
  return archive.archiveMembers.map((member, bankId) => {
    if (member.index !== bankId) throw new Error(`L'archive HGSS de rencontres n'est pas contigue a l'identifiant ${bankId}.`)
    return decodeHgssWildEncounterData(rom.subarray(member.offset, member.offset + member.size), bankId)
  })
}