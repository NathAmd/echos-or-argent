import type { RomFile } from '../../ndsTypes'

export const hgssLevelUpLearnsetEnd = 0xffff
export const hgssLevelUpLearnsetMaxEntries = 21

export type PokemonLevelUpMove = {
  level: number
  moveId: number
}

export function decodePokemonLevelUpLearnset(payload: Uint8Array, speciesId: number): PokemonLevelUpMove[] {
  if (!Number.isInteger(speciesId) || speciesId < 0) throw new Error(`L'identifiant d'espece ${speciesId} est invalide.`)
  if (payload.byteLength % 2 !== 0) {
    throw new Error(`Le learnset HGSS de l'espece ${speciesId} a une taille impaire de ${payload.byteLength} octets.`)
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const learnset: PokemonLevelUpMove[] = []
  for (let offset = 0; offset < payload.byteLength; offset += 2) {
    const packed = view.getUint16(offset, true)
    if (packed === hgssLevelUpLearnsetEnd) {
      for (let paddingOffset = offset + 2; paddingOffset < payload.byteLength; paddingOffset += 2) {
        if (view.getUint16(paddingOffset, true) === 0) continue
        throw new Error(`Le learnset HGSS de l'espece ${speciesId} contient des donnees apres son terminateur.`)
      }
      return learnset
    }
    if (learnset.length === hgssLevelUpLearnsetMaxEntries) {
      throw new Error(`Le learnset HGSS de l'espece ${speciesId} depasse ${hgssLevelUpLearnsetMaxEntries} entrees.`)
    }
    learnset.push({
      moveId: packed & 0x01ff,
      level: (packed & 0xfe00) >>> 9,
    })
  }
  throw new Error(`Le learnset HGSS de l'espece ${speciesId} n'a pas de terminateur 0xFFFF.`)
}

export function decodePokemonLevelUpLearnsetCatalog(rom: Uint8Array, archive: RomFile): PokemonLevelUpMove[][] {
  return archive.archiveMembers.map((member, speciesId) => {
    if (member.index !== speciesId) throw new Error(`L'archive des learnsets HGSS n'est pas contigue au membre ${member.index}.`)
    if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
      throw new Error(`Le membre de learnset HGSS ${speciesId} est hors des limites de la ROM.`)
    }
    return decodePokemonLevelUpLearnset(rom.subarray(member.offset, member.offset + member.size), speciesId)
  })
}

export function deriveInitialMoveIds(learnset: readonly PokemonLevelUpMove[], level: number): number[] {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error(`Le niveau Pokemon ${level} est invalide.`)
  const moveIds: number[] = []
  for (const entry of learnset) {
    if (entry.level > level) break
    if (moveIds.includes(entry.moveId)) continue
    if (moveIds.length === 4) moveIds.shift()
    moveIds.push(entry.moveId)
  }
  return moveIds
}