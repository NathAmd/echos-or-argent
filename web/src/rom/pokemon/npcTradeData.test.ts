import { describe, expect, it } from 'vitest'
import { decodeHgssNpcTrade, hgssNpcTradeDataSize } from './npcTradeData'

describe('HGSS NPC trade data', () => {
  it('decodes the native 0x54-byte record without narrowing its u32 fields', () => {
    const payload = new Uint8Array(hgssNpcTradeDataSize)
    const view = new DataView(payload.buffer)
    const values: Array<[number, number]> = [
      [0x00, 21], [0x04, 12], [0x08, 13], [0x0c, 14], [0x10, 15], [0x14, 16], [0x18, 17],
      [0x1c, 1], [0x20, 0x12345678], [0x38, 0x89abcdef], [0x3c, 137], [0x40, 1],
      [0x48, 3], [0x4c, 22], [0x50, 9],
    ]
    for (const [offset, value] of values) view.setUint32(offset, value, true)

    expect(decodeHgssNpcTrade(payload, 7, 'KENYA', 'RANDY')).toEqual({
      tradeId: 7,
      givenSpeciesId: 21,
      requestedSpeciesId: 22,
      individualValues: { hp: 12, attack: 13, defense: 14, speed: 15, specialAttack: 16, specialDefense: 17 },
      ability: 1,
      originalTrainerId: 0x12345678,
      personality: 0x89abcdef,
      heldItemId: 137,
      originalTrainerGender: 'female',
      language: 3,
      nickname: 'KENYA',
      originalTrainerName: 'RANDY',
      unusedFlag: 9,
    })
  })
})
