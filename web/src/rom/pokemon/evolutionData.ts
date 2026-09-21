import type { RomFile } from '../../ndsTypes'

export const hgssEvolutionEntryCount = 7
export const hgssEvolutionEntrySize = 6
export const hgssEvolutionDataSize = 0x2c

export type PokemonEvolutionRule = {
  method: number
  parameter: number
  targetSpeciesId: number
}

export function decodePokemonEvolutionData(payload: Uint8Array, speciesId: number): PokemonEvolutionRule[] {
  if (payload.byteLength !== hgssEvolutionDataSize) {
    throw new Error(`Les evolutions HGSS de l'espece ${speciesId} mesurent ${payload.byteLength} octets au lieu de ${hgssEvolutionDataSize}.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const rules: PokemonEvolutionRule[] = []
  for (let index = 0; index < hgssEvolutionEntryCount; index += 1) {
    const offset = index * hgssEvolutionEntrySize
    const method = view.getUint16(offset, true)
    const parameter = view.getUint16(offset + 2, true)
    const targetSpeciesId = view.getUint16(offset + 4, true)
    if (method === 0) {
      if (parameter !== 0 || targetSpeciesId !== 0) throw new Error(`L'evolution vide ${index} de l'espece ${speciesId} contient des parametres.`)
      continue
    }
    if (targetSpeciesId === 0) throw new Error(`L'evolution ${index} de l'espece ${speciesId} n'a pas d'espece cible.`)
    rules.push({ method, parameter, targetSpeciesId })
  }
  if (view.getUint16(hgssEvolutionEntryCount * hgssEvolutionEntrySize, true) !== 0) {
    throw new Error(`Les evolutions HGSS de l'espece ${speciesId} n'ont pas de terminaison nulle.`)
  }
  return rules
}

export function decodePokemonEvolutionCatalog(rom: Uint8Array, archive: RomFile): PokemonEvolutionRule[][] {
  return archive.archiveMembers.map((member, speciesId) => {
    if (member.index !== speciesId || member.offset < 0 || member.offset + member.size > rom.byteLength) {
      throw new Error(`Le membre d'evolution HGSS ${speciesId} est invalide.`)
    }
    return decodePokemonEvolutionData(rom.subarray(member.offset, member.offset + member.size), speciesId)
  })
}