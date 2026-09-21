import { describe, expect, it } from 'vitest'
import { getFieldMovementDurationFrames } from './fieldMovement'
import { createHgssWaterfallMovement, hgssWaterfallTraversalDistance, hgssWaterfallTraversalDurationFrames } from './hgssWaterfallMovement'

describe('HGSS Cascade field task', () => {
  it.each([
    ['north', 4],
    ['south', 5],
  ] as const)('preserves the two-tile %s trajectory and its native timing', (direction, action) => {
    const movement = createHgssWaterfallMovement(direction)

    expect(movement).toMatchObject([
      { action, repetitions: 1, direction, kind: 'walk', durationFrames: 32 },
      { action, repetitions: 1, direction, kind: 'walk', durationFrames: 64 },
    ])
    expect(movement.reduce((distance, phase) => distance + phase.repetitions, 0)).toBe(hgssWaterfallTraversalDistance)
    expect(movement.reduce((frames, phase) => frames + getFieldMovementDurationFrames(phase), 0)).toBe(hgssWaterfallTraversalDurationFrames)
  })

  it('rejects horizontal traversal instead of inventing a visual path', () => {
    expect(() => createHgssWaterfallMovement('east')).toThrow('vers east')
    expect(() => createHgssWaterfallMovement('west')).toThrow('vers west')
  })
})
