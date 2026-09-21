import { describe, expect, it } from 'vitest'
import { getViridianGymTileAnimationIndex } from './viridianGymMechanism'

describe('Viridian Gym native arrow tiles', () => {
  it('maps the four directional metatile behaviors to their ROM model order', () => {
    expect([64, 65, 66, 67].map(getViridianGymTileAnimationIndex)).toEqual([2, 0, 3, 1])
    expect(getViridianGymTileAnimationIndex(63)).toBeUndefined()
  })
})
