import { describe, expect, it } from 'vitest'
import { resolveHgssMetatileInteractionScript } from './hgssMetatileInteraction'

const resolve = (
  facingBehavior: number,
  direction: 'north' | 'east' | 'south' | 'west' = 'north',
  locomotion: 'walking' | 'surfing' = 'walking',
  standingBehavior = 0,
) => resolveHgssMetatileInteractionScript({ standingBehavior, facingBehavior, direction, locomotion })

describe('HGSS metatile interactions', () => {
  it('opens the Pokemon Center PC only from its native facing direction', () => {
    expect(resolve(131, 'north')).toBe(2010)
    expect(resolve(131, 'east')).toBeUndefined()
    expect(resolve(131, 'south')).toBeUndefined()
    expect(resolve(131, 'west')).toBeUndefined()
  })

  it('maps every native informational furnishing to its standard ROM script', () => {
    expect([224, 234, 225, 226, 228, 229, 235, 236, 133].map((behavior) => resolve(behavior))).toEqual([
      2500, 2501, 2502, 2503, 2504, 2505, 2506, 2507, 2508,
    ])
    expect(resolve(134, 'north')).toBe(10100)
    expect(resolve(134, 'south')).toBeUndefined()
  })

  it('respects the native direction and locomotion gates for field actions', () => {
    expect(resolve(6)).toBe(10014)
    expect(resolve(75, 'north')).toBe(10003)
    expect(resolve(75, 'east')).toBeUndefined()
    expect(resolve(76, 'east')).toBe(10003)
    expect(resolve(76, 'north')).toBeUndefined()
    expect(resolve(19, 'north', 'surfing')).toBe(10005)
    expect(resolve(19, 'south', 'surfing')).toBe(10005)
    expect(resolve(19, 'east', 'surfing')).toBeUndefined()
    expect(resolve(19, 'west', 'surfing')).toBeUndefined()
    expect(resolve(17, 'north', 'surfing')).toBe(10016)
    expect(resolve(19, 'north', 'walking')).toBeUndefined()
  })

  it('blocks metatile scripts from the same special standing tile as the ROM', () => {
    expect(resolve(131, 'north', 'walking', 34)).toBeUndefined()
  })
})
