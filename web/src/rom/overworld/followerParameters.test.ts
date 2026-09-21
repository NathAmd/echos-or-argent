import { describe, expect, it } from 'vitest'
import { decodeFollowerModelIndexes, decodePokemonFollowerParameter, hgssFollowerSpeciesCount, locateFollowerModelIndexTable } from './followerParameters'

function createArm9Fixture(offset = 32): Uint8Array {
  const arm9 = new Uint8Array(offset + hgssFollowerSpeciesCount * 2 + 16)
  const view = new DataView(arm9.buffer)
  const indexes = Array.from({ length: hgssFollowerSpeciesCount }, (_, speciesId) => speciesId <= 3 ? Math.max(0, speciesId - 1) : speciesId)
  indexes.forEach((modelIndex, speciesId) => view.setUint16(offset + speciesId * 2, modelIndex, true))
  return arm9
}

describe('HGSS follower parameters', () => {
  it('locates the structural ARM9 species-to-model table and decodes all entries', () => {
    const arm9 = createArm9Fixture()

    expect(locateFollowerModelIndexTable(arm9, 566)).toBe(32)
    expect(decodeFollowerModelIndexes(arm9, 566)).toMatchObject({ 0: 0, 1: 0, 3: 2, 4: 4, 493: 493 })
  })

  it('decodes the four ROM bytes and rejects ambiguous or invalid structures', () => {
    expect(decodePokemonFollowerParameter(new Uint8Array([7, 1, 9, 11]), 4)).toEqual({
      modelIndex: 4,
      size: 1,
      values: [7, 1, 9, 11],
    })
    expect(() => decodePokemonFollowerParameter(new Uint8Array(3), 4)).toThrow('3 octets au lieu de 4')
    expect(() => locateFollowerModelIndexTable(new Uint8Array(2048), 566)).toThrow('0 candidate')
  })
})