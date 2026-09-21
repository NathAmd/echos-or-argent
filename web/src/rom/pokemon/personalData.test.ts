import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import { decodePokemonPersonalCatalog, decodePokemonPersonalData, decodePokemonPersonalDataFromArchive, hgssPersonalDataSize } from './personalData'

describe('HGSS Pokemon personal data', () => {
  it('decodes the complete BaseStats record without dropping packed fields', () => {
    const payload = new Uint8Array(hgssPersonalDataSize)
    payload.set([45, 49, 65, 45, 49, 65, 12, 12, 45, 64])
    const view = new DataView(payload.buffer)
    view.setUint16(0x0a, 1 | (2 << 2) | (3 << 4) | (1 << 6) | (2 << 8) | (3 << 10), true)
    view.setUint16(0x0c, 10, true)
    view.setUint16(0x0e, 20, true)
    payload.set([31, 20, 70, 3, 1, 7, 65, 102, 4, 0x85], 0x10)
    view.setUint32(0x1c, 0x01234567, true)
    view.setUint32(0x20, 0x89abcdef, true)
    view.setUint32(0x24, 0xfedcba98, true)
    view.setUint32(0x28, 0x76543210, true)

    expect(decodePokemonPersonalData(payload, 152)).toEqual({
      speciesId: 152,
      baseStats: { hp: 45, attack: 49, defense: 65, speed: 45, specialAttack: 49, specialDefense: 65 },
      types: [12, 12],
      catchRate: 45,
      experienceYield: 64,
      evYield: { hp: 1, attack: 2, defense: 3, speed: 1, specialAttack: 2, specialDefense: 3 },
      heldItems: [10, 20],
      genderRatio: 31,
      eggCycles: 20,
      baseFriendship: 70,
      growthRate: 3,
      eggGroups: [1, 7],
      abilities: [65, 102],
      greatMarshFleeRate: 4,
      bodyColor: 5,
      flipSprite: true,
      tmHmCompatibility: [0x01234567, 0x89abcdef, 0xfedcba98, 0x76543210],
    })
  })

  it('rejects truncated records and invalid species identifiers', () => {
    expect(() => decodePokemonPersonalData(new Uint8Array(hgssPersonalDataSize - 1), 152)).toThrow('43 octets')
    expect(() => decodePokemonPersonalData(new Uint8Array(hgssPersonalDataSize), -1)).toThrow("identifiant d'espece")
  })

  it('reads a species from its exact NARC member bounds', () => {
    const rom = new Uint8Array(16 + hgssPersonalDataSize)
    rom.set(new Uint8Array(hgssPersonalDataSize).fill(7), 16)
    const archive = {
      path: '/a/0/0/2',
      archiveMembers: [{ index: 0, offset: 16, size: hgssPersonalDataSize, signature: '' }],
    } as RomFile

    expect(decodePokemonPersonalDataFromArchive(rom, archive, 0).baseStats.hp).toBe(7)
    expect(() => decodePokemonPersonalDataFromArchive(rom, archive, 1)).toThrow("L'espece 1 est absente")
    expect(decodePokemonPersonalCatalog(rom, archive)).toHaveLength(1)
  })
})