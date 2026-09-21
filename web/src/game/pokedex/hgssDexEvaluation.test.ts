import { describe, expect, it } from 'vitest'
import { evaluateHgssPokedex } from './hgssDexEvaluation'

describe('HGSS Pokédex evaluation', () => {
  it('uses the exact Johto thresholds and excludes Mew and Celebi', () => {
    const johtoDexNumbers = Array.from({ length: 494 }, (_, speciesId) => speciesId <= 256 ? speciesId : 0)
    const caught = new Set(Array.from({ length: 256 }, (_, index) => index + 1))
    const result = evaluateHgssPokedex(caught, false, 'female', johtoDexNumbers)

    expect(result).toEqual({ messageId: 23, fanfareSequenceId: 1199, ownedCount: 254, complete: true })
  })

  it('returns Oak national ratings and the completion fanfare from the ROM', () => {
    const partial = new Set([...Array.from({ length: 100 }, (_, index) => index + 1), 151])
    expect(evaluateHgssPokedex(partial, true, 'male')).toEqual({
      messageId: 46,
      fanfareSequenceId: 1194,
      ownedCount: 100,
      complete: false,
    })

    const complete = new Set(Array.from({ length: 493 }, (_, index) => index + 1))
    expect(evaluateHgssPokedex(complete, true, 'female')).toEqual({
      messageId: 25,
      fanfareSequenceId: 1199,
      ownedCount: 484,
      complete: true,
    })
  })
})
