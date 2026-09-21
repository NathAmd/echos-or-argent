import { describe, expect, it } from 'vitest'
import { decodeHgssTrainer, hgssTrainerDataSize } from './trainerData'

function createTrainerData(type: number, partySize = 1): Uint8Array {
  const payload = new Uint8Array(hgssTrainerDataSize)
  const view = new DataView(payload.buffer)
  payload.set([type, 7, 0, partySize])
  view.setUint16(4, 17, true)
  view.setUint16(6, 18, true)
  view.setUint32(12, 0x12345678, true)
  view.setUint32(16, 1, true)
  return payload
}

function createParty(type: number): Uint8Array {
  const recordSize = 8 + (type & 2 ? 2 : 0) + (type & 1 ? 8 : 0)
  const payload = new Uint8Array(recordSize)
  const view = new DataView(payload.buffer)
  payload.set([200, 0x21])
  view.setUint16(2, 12, true)
  view.setUint16(4, 155 | (3 << 10), true)
  let cursor = 6
  if (type & 2) {
    view.setUint16(cursor, 42, true)
    cursor += 2
  }
  if (type & 1) {
    ;[33, 43, 52, 0].forEach((move, index) => view.setUint16(cursor + index * 2, move, true))
    cursor += 8
  }
  view.setUint16(cursor, 9, true)
  return payload
}

describe('HGSS trainer data', () => {
  it.each([0, 1, 2, 3])('decodes native trainer party format %s', (type) => {
    expect(decodeHgssTrainer(createTrainerData(type), createParty(type), 495)).toMatchObject({
      trainerId: 495,
      trainerType: type,
      trainerClass: 7,
      partySize: 1,
      items: [17, 18, 0, 0],
      aiFlags: 0x12345678,
      doubleBattle: true,
      party: [{
        difficulty: 200,
        genderOverride: 1,
        abilityOverride: 2,
        level: 12,
        speciesId: 155,
        form: 3,
        heldItemId: type & 2 ? 42 : undefined,
        moveIds: type & 1 ? [33, 43, 52, 0] : undefined,
        capsule: 9,
      }],
    })
  })

  it('rejects unsupported types and party lengths that do not match the metadata', () => {
    expect(() => decodeHgssTrainer(createTrainerData(4), new Uint8Array(), 1)).toThrow('type de dresseur')
    expect(() => decodeHgssTrainer(createTrainerData(0, 2), createParty(0), 1)).toThrow('16')
  })

  it('accepts the native aligned sentinel for a trainer without a party', () => {
    expect(decodeHgssTrainer(createTrainerData(0, 0), new Uint8Array(8), 0).party).toEqual([])
  })
})