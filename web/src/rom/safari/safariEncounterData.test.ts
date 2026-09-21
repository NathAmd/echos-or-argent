import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import {
  decodeHgssSafariAreaEncounterData,
  decodeHgssSafariEncounterCatalog,
  HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH,
  hgssSafariAreaCount,
  hgssSafariBaseSlotCount,
  hgssSafariEncounterMethods,
  hgssSafariEncounterTimes,
} from './safariEncounterData'

const testBonusCounts = [2, 1, 0, 2, 1] as const

function createAreaPayload(areaId: number): Uint8Array {
  const size = 8 + hgssSafariEncounterMethods.reduce((total, _method, methodIndex) => (
    total + hgssSafariEncounterTimes.length * hgssSafariBaseSlotCount * 4
      + hgssSafariEncounterTimes.length * testBonusCounts[methodIndex]! * 4
      + testBonusCounts[methodIndex]! * 4
  ), 0)
  const payload = new Uint8Array(size)
  payload.set(testBonusCounts, 0)
  const view = new DataView(payload.buffer)
  let cursor = 8
  hgssSafariEncounterMethods.forEach((_method, methodIndex) => {
    hgssSafariEncounterTimes.forEach((_time, timeIndex) => {
      for (let slotIndex = 0; slotIndex < hgssSafariBaseSlotCount; slotIndex += 1) {
        view.setUint16(cursor, 1 + areaId * 100 + methodIndex * 20 + timeIndex * 10 + slotIndex, true)
        view.setUint16(cursor + 2, 10 + methodIndex + timeIndex, true)
        cursor += 4
      }
    })
    hgssSafariEncounterTimes.forEach((_time, timeIndex) => {
      for (let bonusIndex = 0; bonusIndex < testBonusCounts[methodIndex]!; bonusIndex += 1) {
        view.setUint16(cursor, 400 + areaId * 10 + methodIndex * 3 + bonusIndex, true)
        view.setUint16(cursor + 2, 30 + timeIndex, true)
        cursor += 4
      }
    })
    for (let bonusIndex = 0; bonusIndex < testBonusCounts[methodIndex]!; bonusIndex += 1) {
      payload.set([1 + bonusIndex, 3 + bonusIndex, bonusIndex === 0 ? 0 : 4, bonusIndex === 0 ? 0 : 7], cursor)
      cursor += 4
    }
  })
  expect(cursor).toBe(payload.byteLength)
  return payload
}

function createArchive(rom: Uint8Array, payloadSize: number): RomFile {
  return {
    id: 0,
    path: HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH,
    offset: 0,
    size: rom.byteLength,
    signature: 'N A R C',
    archiveEntries: hgssSafariAreaCount,
    archiveMembers: Array.from({ length: hgssSafariAreaCount }, (_, index) => ({
      index,
      offset: index * payloadSize,
      size: payloadSize,
      signature: '',
    })),
  }
}

describe('HGSS Safari encounter data', () => {
  it('decodes the five native methods, three times, ten base slots and indexed bonuses', () => {
    const decoded = decodeHgssSafariAreaEncounterData(createAreaPayload(2), 2)

    expect(decoded.areaId).toBe(2)
    expect(Object.keys(decoded.methods)).toEqual(hgssSafariEncounterMethods)
    expect(decoded.methods.land.bonusCount).toBe(2)
    expect(decoded.methods.land.base.morning).toHaveLength(10)
    expect(decoded.methods.land.base.morning[0]).toEqual({ speciesId: 201, level: 10 })
    expect(decoded.methods.land.base.night[9]).toEqual({ speciesId: 230, level: 12 })
    expect(decoded.methods.land.bonus.day).toEqual([
      { speciesId: 420, level: 31 },
      { speciesId: 421, level: 31 },
    ])
    expect(decoded.methods.land.bonusConditions).toEqual([
      { blockType1: 1, blockCount1: 3, blockType2: 0, blockCount2: 0 },
      { blockType1: 2, blockCount1: 4, blockType2: 4, blockCount2: 7 },
    ])
    expect(decoded.methods.surf.bonus.morning).toHaveLength(1)
    expect(decoded.methods.surf.bonusCount).toBe(1)
    expect(decoded.methods.oldRod.bonus.night).toEqual([])
    expect(decoded.methods.superRod.base.day).toHaveLength(10)
  })

  it('decodes a contiguous twelve-area NARC catalog from the member bounds', () => {
    const payloads = Array.from({ length: hgssSafariAreaCount }, (_, areaId) => createAreaPayload(areaId))
    const payloadSize = payloads[0]!.byteLength
    const rom = new Uint8Array(payloadSize * hgssSafariAreaCount)
    payloads.forEach((payload, index) => rom.set(payload, index * payloadSize))

    const catalog = decodeHgssSafariEncounterCatalog(rom, createArchive(rom, payloadSize))

    expect(catalog).toHaveLength(12)
    expect(catalog.map(({ areaId }) => areaId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(catalog[11]!.methods.goodRod.base.night[9]).toEqual({ speciesId: 1190, level: 15 })
  })

  it('rejects truncated, overlong and structurally invalid members', () => {
    const payload = createAreaPayload(0)
    expect(() => decodeHgssSafariAreaEncounterData(payload.subarray(0, payload.byteLength - 1), 0)).toThrow('tronquees')
    expect(() => decodeHgssSafariAreaEncounterData(new Uint8Array([...payload, 0]), 0)).toThrow('octets sur')

    const invalidPadding = payload.slice()
    invalidPadding[7] = 1
    expect(() => decodeHgssSafariAreaEncounterData(invalidPadding, 0)).toThrow('remplissage invalide')

    const invalidBlockType = payload.slice()
    const firstLandConditionOffset = 8 + 3 * 10 * 4 + 3 * testBonusCounts[0] * 4
    invalidBlockType[firstLandConditionOffset] = 5
    expect(() => decodeHgssSafariAreaEncounterData(invalidBlockType, 0)).toThrow('type de bloc invalide')

    const excessiveBonuses = payload.slice()
    excessiveBonuses[0] = 11
    expect(() => decodeHgssSafariAreaEncounterData(excessiveBonuses, 0)).toThrow('au maximum')
    expect(() => decodeHgssSafariAreaEncounterData(payload, 12)).toThrow('identifiant de zone')
  })

  it('rejects a wrong archive, missing areas and non-contiguous member indexes', () => {
    const payload = createAreaPayload(0)
    const rom = new Uint8Array(payload.byteLength * hgssSafariAreaCount)
    const archive = createArchive(rom, payload.byteLength)

    expect(() => decodeHgssSafariEncounterCatalog(rom, { ...archive, path: '/a/0/3/7' })).toThrow(HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH)
    expect(() => decodeHgssSafariEncounterCatalog(rom, { ...archive, archiveMembers: archive.archiveMembers.slice(0, 11) })).toThrow('11 zones')
    const nonContiguous = archive.archiveMembers.map((member) => ({ ...member }))
    nonContiguous[4]!.index = 5
    expect(() => decodeHgssSafariEncounterCatalog(rom, { ...archive, archiveMembers: nonContiguous })).toThrow('contigue')
  })
})
