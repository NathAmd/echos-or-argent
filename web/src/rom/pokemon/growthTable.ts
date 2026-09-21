import type { RomFile } from '../../ndsTypes'

export const hgssMaximumPokemonLevel = 100
export const hgssGrowthTableEntries = hgssMaximumPokemonLevel + 1
export const hgssGrowthTableSize = hgssGrowthTableEntries * Uint32Array.BYTES_PER_ELEMENT

export type PokemonGrowthTable = {
  growthRate: number
  experienceByLevel: number[]
}

export function decodePokemonGrowthTable(payload: Uint8Array, growthRate: number): PokemonGrowthTable {
  if (!Number.isInteger(growthRate) || growthRate < 0) throw new Error(`Le taux de croissance ${growthRate} est invalide.`)
  if (payload.byteLength !== hgssGrowthTableSize) {
    throw new Error(`La table de croissance HGSS ${growthRate} mesure ${payload.byteLength} octets au lieu de ${hgssGrowthTableSize}.`)
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const experienceByLevel = Array.from(
    { length: hgssGrowthTableEntries },
    (_, level) => view.getUint32(level * Uint32Array.BYTES_PER_ELEMENT, true),
  )
  if (experienceByLevel[0] !== 0 || experienceByLevel[1] !== 0) {
    throw new Error(`La table de croissance HGSS ${growthRate} ne commence pas par les niveaux 0 et 1 a zero.`)
  }
  const invalidLevel = experienceByLevel.findIndex((experience, level) => level > 0 && experience < experienceByLevel[level - 1]!)
  if (invalidLevel !== -1) {
    throw new Error(`La table de croissance HGSS ${growthRate} regresse au niveau ${invalidLevel}.`)
  }
  return { growthRate, experienceByLevel }
}

export function decodePokemonGrowthTableCatalog(rom: Uint8Array, archive: RomFile): PokemonGrowthTable[] {
  return archive.archiveMembers.map((member, growthRate) => {
    if (member.index !== growthRate) throw new Error(`L'archive des courbes de croissance HGSS n'est pas contigue au membre ${member.index}.`)
    if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
      throw new Error(`Le membre de croissance HGSS ${growthRate} est hors des limites de la ROM.`)
    }
    return decodePokemonGrowthTable(rom.subarray(member.offset, member.offset + member.size), growthRate)
  })
}

export function getExperienceForLevel(table: PokemonGrowthTable, level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > hgssMaximumPokemonLevel) {
    throw new Error(`Le niveau Pokemon ${level} est invalide.`)
  }
  return table.experienceByLevel[level]!
}

export function calculateLevelFromExperience(table: PokemonGrowthTable, experience: number): number {
  if (!Number.isSafeInteger(experience) || experience < 0 || experience > 0xffffffff) {
    throw new Error(`L'experience Pokemon ${experience} est invalide.`)
  }
  for (let level = 1; level <= hgssMaximumPokemonLevel; level += 1) {
    if (table.experienceByLevel[level]! > experience) return level - 1
  }
  return hgssMaximumPokemonLevel
}