import { describe, expect, it } from 'vitest'
import { decodeHgssPlayerDirection, encodeHgssPlayerDirection, hgssPlayerDirections } from './playerDirection'

describe('HGSS player directions', () => {
  it('shares the native north, south, west, east encoding', () => {
    expect(hgssPlayerDirections).toEqual(['north', 'south', 'west', 'east'])
    for (const [index, direction] of hgssPlayerDirections.entries()) {
      expect(decodeHgssPlayerDirection(index)).toBe(direction)
      expect(encodeHgssPlayerDirection(direction)).toBe(index)
    }
  })

  it('uses the explicit fallback for an invalid ROM value', () => {
    expect(decodeHgssPlayerDirection(99)).toBe('south')
    expect(decodeHgssPlayerDirection(-1, 'north')).toBe('north')
  })
})
