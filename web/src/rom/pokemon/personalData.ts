import type { RomFile } from '../../ndsTypes'

export const hgssPersonalDataSize = 0x2c

export type PokemonPersonalData = {
  speciesId: number
  baseStats: {
    hp: number
    attack: number
    defense: number
    speed: number
    specialAttack: number
    specialDefense: number
  }
  types: readonly [number, number]
  catchRate: number
  experienceYield: number
  evYield: {
    hp: number
    attack: number
    defense: number
    speed: number
    specialAttack: number
    specialDefense: number
  }
  heldItems: readonly [number, number]
  genderRatio: number
  eggCycles: number
  baseFriendship: number
  growthRate: number
  eggGroups: readonly [number, number]
  abilities: readonly [number, number]
  greatMarshFleeRate: number
  bodyColor: number
  flipSprite: boolean
  tmHmCompatibility: readonly [number, number, number, number]
}

export function decodePokemonPersonalData(payload: Uint8Array, speciesId: number): PokemonPersonalData {
  if (!Number.isInteger(speciesId) || speciesId < 0) {
    throw new Error(`L'identifiant d'espece ${speciesId} est invalide.`)
  }
  if (payload.byteLength !== hgssPersonalDataSize) {
    throw new Error(`Les donnees personnelles HGSS de l'espece ${speciesId} mesurent ${payload.byteLength} octets au lieu de ${hgssPersonalDataSize}.`)
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const evYield = view.getUint16(0x0a, true)
  const colorAndFlip = payload[0x19]!
  return {
    speciesId,
    baseStats: {
      hp: payload[0]!,
      attack: payload[1]!,
      defense: payload[2]!,
      speed: payload[3]!,
      specialAttack: payload[4]!,
      specialDefense: payload[5]!,
    },
    types: [payload[6]!, payload[7]!],
    catchRate: payload[8]!,
    experienceYield: payload[9]!,
    evYield: {
      hp: evYield & 0x3,
      attack: (evYield >>> 2) & 0x3,
      defense: (evYield >>> 4) & 0x3,
      speed: (evYield >>> 6) & 0x3,
      specialAttack: (evYield >>> 8) & 0x3,
      specialDefense: (evYield >>> 10) & 0x3,
    },
    heldItems: [view.getUint16(0x0c, true), view.getUint16(0x0e, true)],
    genderRatio: payload[0x10]!,
    eggCycles: payload[0x11]!,
    baseFriendship: payload[0x12]!,
    growthRate: payload[0x13]!,
    eggGroups: [payload[0x14]!, payload[0x15]!],
    abilities: [payload[0x16]!, payload[0x17]!],
    greatMarshFleeRate: payload[0x18]!,
    bodyColor: colorAndFlip & 0x7f,
    flipSprite: (colorAndFlip & 0x80) !== 0,
    tmHmCompatibility: [
      view.getUint32(0x1c, true),
      view.getUint32(0x20, true),
      view.getUint32(0x24, true),
      view.getUint32(0x28, true),
    ],
  }
}

export function decodePokemonPersonalDataFromArchive(rom: Uint8Array, archive: RomFile, speciesId: number): PokemonPersonalData {
  const member = archive.archiveMembers[speciesId]
  if (!member) {
    throw new Error(`L'espece ${speciesId} est absente de l'archive personnelle HGSS ${archive.path}.`)
  }
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre personnel HGSS ${speciesId} est hors des limites de la ROM.`)
  }
  return decodePokemonPersonalData(rom.subarray(member.offset, member.offset + member.size), speciesId)
}

export function decodePokemonPersonalCatalog(rom: Uint8Array, archive: RomFile): PokemonPersonalData[] {
  return archive.archiveMembers.map((member, speciesId) => {
    if (member.index !== speciesId) {
      throw new Error(`L'archive personnelle HGSS n'est pas contigue: membre ${member.index} a la position ${speciesId}.`)
    }
    return decodePokemonPersonalDataFromArchive(rom, archive, speciesId)
  })
}