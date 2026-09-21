import { describe, expect, it } from 'vitest'
import { decodePokemonMoveData, hgssMoveDataSize } from './moveData'

describe('HGSS Pokemon move data', () => {
  it('decodes the complete signed and unsigned MoveTbl layout', () => {
    const payload = new Uint8Array(hgssMoveDataSize)
    const view = new DataView(payload.buffer)
    view.setUint16(0, 0x1234, true)
    payload.set([2, 80, 10, 95, 15, 30], 2)
    view.setUint16(8, 0x0204, true)
    view.setInt8(0x0a, -2)
    payload.set([0xa5, 7, 4], 0x0b)
    view.setUint16(0x0e, 0xbeef, true)

    expect(decodePokemonMoveData(payload, 52)).toEqual({
      moveId: 52,
      effect: 0x1234,
      category: 2,
      power: 80,
      type: 10,
      accuracy: 95,
      pp: 15,
      effectChance: 30,
      range: 0x0204,
      priority: -2,
      flags: 0xa5,
      contestEffect: 7,
      contestType: 4,
      contestUnknown: 0xbeef,
    })
  })

  it('rejects truncated records and invalid move identifiers', () => {
    expect(() => decodePokemonMoveData(new Uint8Array(hgssMoveDataSize - 1), 1)).toThrow('15 octets')
    expect(() => decodePokemonMoveData(new Uint8Array(hgssMoveDataSize), -1)).toThrow('identifiant de capacite')
  })
})