import { describe, expect, it } from 'vitest'
import { decodeHgssWildEncounterData, hgssWildEncounterDataSize } from './wildEncounterData'

describe('HGSS wild encounter data', () => {
  it('decodes every native encounter table at its fixed offset', () => {
    const payload = new Uint8Array(hgssWildEncounterDataSize)
    const view = new DataView(payload.buffer)
    payload.set([25, 10, 5, 15, 20, 30], 0)
    payload.set(Array.from({ length: 12 }, (_, index) => index + 2), 8)
    for (let index = 0; index < 12; index += 1) {
      view.setUint16(0x14 + index * 2, 10 + index, true)
      view.setUint16(0x2c + index * 2, 30 + index, true)
      view.setUint16(0x44 + index * 2, 50 + index, true)
    }
    view.setUint16(0x5c, 70, true)
    view.setUint16(0x60, 80, true)
    for (const [offset, count, species] of [[0x64, 5, 90], [0x78, 2, 100], [0x80, 5, 110], [0x94, 5, 120], [0xa8, 5, 130]] as const) {
      for (let index = 0; index < count; index += 1) {
        payload[offset + index * 4] = index + 3
        payload[offset + index * 4 + 1] = index + 5
        view.setUint16(offset + index * 4 + 2, species + index, true)
      }
    }
    ;[140, 141, 142, 143].forEach((species, index) => view.setUint16(0xbc + index * 2, species, true))

    const decoded = decodeHgssWildEncounterData(payload, 4)
    expect(decoded).toMatchObject({
      bankId: 4,
      rates: { walking: 25, surfing: 10, rockSmash: 5, oldRod: 15, goodRod: 20, superRod: 30 },
      hoennSoundSpecies: [70, 0],
      sinnohSoundSpecies: [80, 0],
      swarm: { landSpeciesId: 140, surfingSpeciesId: 141, nightFishingSpeciesId: 142, fishingSpeciesId: 143 },
    })
    expect(decoded.land.morning).toHaveLength(12)
    expect(decoded.land.morning[0]).toEqual({ speciesId: 10, level: 2 })
    expect(decoded.land.day[11]).toEqual({ speciesId: 41, level: 13 })
    expect(decoded.land.night[0]).toEqual({ speciesId: 50, level: 2 })
    expect(decoded.surfing).toHaveLength(5)
    expect(decoded.surfing[0]).toEqual({ speciesId: 90, minLevel: 3, maxLevel: 5 })
    expect(decoded.rockSmash).toHaveLength(2)
    expect(decoded.rockSmash[0]).toEqual({ speciesId: 100, minLevel: 3, maxLevel: 5 })
    expect(decoded.oldRod[0]).toEqual({ speciesId: 110, minLevel: 3, maxLevel: 5 })
    expect(decoded.goodRod[0]).toEqual({ speciesId: 120, minLevel: 3, maxLevel: 5 })
    expect(decoded.superRod[4]).toEqual({ speciesId: 134, minLevel: 7, maxLevel: 9 })
  })

  it('rejects malformed members explicitly', () => {
    expect(() => decodeHgssWildEncounterData(new Uint8Array(12), 3)).toThrow('196')
  })
})