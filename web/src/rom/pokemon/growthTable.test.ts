import { describe, expect, it } from 'vitest'
import {
  calculateLevelFromExperience,
  decodePokemonGrowthTable,
  getExperienceForLevel,
  hgssGrowthTableEntries,
  hgssGrowthTableSize,
} from './growthTable'

function encodeGrowthTable(experienceForLevel: (level: number) => number): Uint8Array {
  const payload = new Uint8Array(hgssGrowthTableSize)
  const view = new DataView(payload.buffer)
  for (let level = 0; level < hgssGrowthTableEntries; level += 1) {
    view.setUint32(level * Uint32Array.BYTES_PER_ELEMENT, experienceForLevel(level), true)
  }
  return payload
}

describe('HGSS Pokemon growth tables', () => {
  it('decodes all 101 little-endian experience thresholds', () => {
    const table = decodePokemonGrowthTable(encodeGrowthTable((level) => level <= 1 ? 0 : level ** 3), 0)

    expect(table.growthRate).toBe(0)
    expect(table.experienceByLevel).toHaveLength(101)
    expect(getExperienceForLevel(table, 5)).toBe(125)
    expect(getExperienceForLevel(table, 100)).toBe(1_000_000)
  })

  it('derives levels with the same threshold scan as HGSS', () => {
    const table = decodePokemonGrowthTable(encodeGrowthTable((level) => level <= 1 ? 0 : level ** 3), 0)

    expect(calculateLevelFromExperience(table, 0)).toBe(1)
    expect(calculateLevelFromExperience(table, 124)).toBe(4)
    expect(calculateLevelFromExperience(table, 125)).toBe(5)
    expect(calculateLevelFromExperience(table, 0xffffffff)).toBe(100)
  })

  it('rejects malformed tables and invalid query values', () => {
    expect(() => decodePokemonGrowthTable(new Uint8Array(hgssGrowthTableSize - 4), 0)).toThrow('400 octets')
    expect(() => decodePokemonGrowthTable(encodeGrowthTable((level) => level === 2 ? 1 : 0), -1)).toThrow('taux de croissance')
    expect(() => decodePokemonGrowthTable(encodeGrowthTable((level) => level === 2 ? 10 : level === 3 ? 5 : 0), 0)).toThrow('regresse')
    const table = decodePokemonGrowthTable(encodeGrowthTable((level) => level <= 1 ? 0 : level ** 3), 0)
    expect(() => getExperienceForLevel(table, 0)).toThrow('niveau Pokemon')
    expect(() => calculateLevelFromExperience(table, -1)).toThrow('experience Pokemon')
  })
})