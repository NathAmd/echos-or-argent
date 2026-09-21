import type { RomFile } from '../../ndsTypes'

export const hgssMoveDataSize = 0x10

export type PokemonMoveData = {
  moveId: number
  effect: number
  category: number
  power: number
  type: number
  accuracy: number
  pp: number
  effectChance: number
  range: number
  priority: number
  flags: number
  contestEffect: number
  contestType: number
  contestUnknown: number
}

export function decodePokemonMoveData(payload: Uint8Array, moveId: number): PokemonMoveData {
  if (!Number.isInteger(moveId) || moveId < 0) throw new Error(`L'identifiant de capacite ${moveId} est invalide.`)
  if (payload.byteLength !== hgssMoveDataSize) {
    throw new Error(`Les donnees HGSS de la capacite ${moveId} mesurent ${payload.byteLength} octets au lieu de ${hgssMoveDataSize}.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    moveId,
    effect: view.getUint16(0, true),
    category: payload[2]!,
    power: payload[3]!,
    type: payload[4]!,
    accuracy: payload[5]!,
    pp: payload[6]!,
    effectChance: payload[7]!,
    range: view.getUint16(8, true),
    priority: view.getInt8(0x0a),
    flags: payload[0x0b]!,
    contestEffect: payload[0x0c]!,
    contestType: payload[0x0d]!,
    contestUnknown: view.getUint16(0x0e, true),
  }
}

export function decodePokemonMoveDataFromArchive(rom: Uint8Array, archive: RomFile, moveId: number): PokemonMoveData {
  const member = archive.archiveMembers[moveId]
  if (!member) throw new Error(`La capacite ${moveId} est absente de l'archive HGSS ${archive.path}.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre de capacite HGSS ${moveId} est hors des limites de la ROM.`)
  }
  return decodePokemonMoveData(rom.subarray(member.offset, member.offset + member.size), moveId)
}

export function decodePokemonMoveCatalog(rom: Uint8Array, archive: RomFile): PokemonMoveData[] {
  return archive.archiveMembers.map((member, moveId) => {
    if (member.index !== moveId) throw new Error(`L'archive des capacites HGSS n'est pas contigue au membre ${member.index}.`)
    return decodePokemonMoveDataFromArchive(rom, archive, moveId)
  })
}