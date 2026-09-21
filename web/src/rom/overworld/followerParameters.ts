import type { RomFile } from '../../ndsTypes'
import { readArm9FromRom } from '../maps/mapHeaders'

export const hgssFollowerParameterSize = 4
export const hgssFollowerSpeciesCount = 494
export const hgssFollowerModelBase = 297

const modelIndexSignature = [0, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

export type PokemonFollowerParameter = {
  modelIndex: number
  size: number
  values: readonly [number, number, number, number]
}

export type PokemonFollowerCatalog = {
  parameters: PokemonFollowerParameter[]
  modelIndexBySpecies: number[]
}

export function locateFollowerModelIndexTable(arm9: Uint8Array, parameterCount: number): number {
  const tableSize = hgssFollowerSpeciesCount * 2
  const matches: number[] = []
  for (let offset = 0; offset + tableSize <= arm9.byteLength; offset += 2) {
    const view = new DataView(arm9.buffer, arm9.byteOffset + offset, tableSize)
    if (!modelIndexSignature.every((value, index) => view.getUint16(index * 2, true) === value)) continue
    const indexes = Array.from({ length: hgssFollowerSpeciesCount }, (_, speciesId) => view.getUint16(speciesId * 2, true))
    if (indexes.some((modelIndex) => modelIndex >= parameterCount)) continue
    if (!indexes.slice(2).every((modelIndex, index) => modelIndex > indexes[index + 1]!)) continue
    matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table ARM9 des modeles follower HGSS doit etre unique; ${matches.length} candidate(s) trouvee(s).`)
  }
  return matches[0]!
}

export function decodeFollowerModelIndexes(arm9: Uint8Array, parameterCount: number): number[] {
  const offset = locateFollowerModelIndexTable(arm9, parameterCount)
  const view = new DataView(arm9.buffer, arm9.byteOffset + offset, hgssFollowerSpeciesCount * 2)
  return Array.from({ length: hgssFollowerSpeciesCount }, (_, speciesId) => view.getUint16(speciesId * 2, true))
}

export function decodePokemonFollowerParameter(payload: Uint8Array, modelIndex: number): PokemonFollowerParameter {
  if (!Number.isInteger(modelIndex) || modelIndex < 0) throw new Error(`L'index de modele follower ${modelIndex} est invalide.`)
  if (payload.byteLength !== hgssFollowerParameterSize) {
    throw new Error(`Les parametres follower HGSS ${modelIndex} mesurent ${payload.byteLength} octets au lieu de ${hgssFollowerParameterSize}.`)
  }
  const values = [payload[0]!, payload[1]!, payload[2]!, payload[3]!] as const
  return { modelIndex, size: values[1], values }
}

export function decodePokemonFollowerCatalog(rom: Uint8Array, archive: RomFile): PokemonFollowerCatalog {
  const parameters = archive.archiveMembers.map((member, modelIndex) => {
    if (member.index !== modelIndex) throw new Error(`L'archive follower HGSS n'est pas contigue au membre ${member.index}.`)
    if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
      throw new Error(`Le membre follower HGSS ${modelIndex} est hors des limites de la ROM.`)
    }
    return decodePokemonFollowerParameter(rom.subarray(member.offset, member.offset + member.size), modelIndex)
  })
  return {
    parameters,
    modelIndexBySpecies: decodeFollowerModelIndexes(readArm9FromRom(rom), parameters.length),
  }
}