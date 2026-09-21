import { describe, expect, it } from 'vitest'
import { createFieldMovementAction, decodeFieldMovement, getFieldMovementDurationFrames } from './fieldMovement'

describe('HGSS field movements', () => {
  it('decodes direction, repetitions, delays, and the movement terminator', () => {
    const bytes = new Uint8Array([62, 0, 1, 0, 12, 0, 2, 0, 33, 0, 1, 0, 254, 0, 0, 0])

    expect(decodeFieldMovement(bytes, 0)).toEqual([
      { action: 62, repetitions: 1, direction: undefined, tileDistance: 0, kind: 'delay' },
      { action: 12, repetitions: 2, direction: 'north', tileDistance: 0, kind: 'walk' },
      { action: 33, repetitions: 1, direction: 'south', tileDistance: 0, kind: 'walkInPlace' },
    ])
  })

  it('decodes on-the-spot, near, far, and lateral jump distances', () => {
    const bytes = new Uint8Array([
      48, 0, 1, 0,
      53, 0, 2, 0,
      58, 0, 1, 0,
      92, 0, 1, 0,
      95, 0, 1, 0,
      254, 0, 0, 0,
    ])

    expect(decodeFieldMovement(bytes, 0)).toEqual([
      { action: 48, repetitions: 1, direction: 'north', tileDistance: 0, kind: 'jump' },
      { action: 53, repetitions: 2, direction: 'south', tileDistance: 1, kind: 'jump' },
      { action: 58, repetitions: 1, direction: 'west', tileDistance: 2, kind: 'jump' },
      { action: 92, repetitions: 1, direction: 'west', tileDistance: 1, kind: 'jump' },
      { action: 95, repetitions: 1, direction: 'east', tileDistance: 2, kind: 'jump' },
    ])
  })

  it('rejects truncated and unterminated movement data', () => {
    expect(() => decodeFieldMovement(new Uint8Array([12, 0]), 0)).toThrow('tronque')
    expect(() => decodeFieldMovement(new Uint8Array(1024), 0)).toThrow('terminateur')
  })

  it('keeps the native HGSS speed bands instead of one renderer duration', () => {
    const actions = decodeFieldMovement(new Uint8Array([
      4, 0, 1, 0,
      8, 0, 1, 0,
      12, 0, 1, 0,
      16, 0, 1, 0,
      20, 0, 1, 0,
      254, 0, 0, 0,
    ]), 0)

    expect(actions.map(getFieldMovementDurationFrames)).toEqual([32, 16, 8, 4, 2])
  })

  it('builds the two native Vermilion stopper movements through the shared decoder', () => {
    expect(createFieldMovementAction(22)).toEqual({ action: 22, repetitions: 1, direction: 'west', tileDistance: 0, kind: 'walk' })
    expect(createFieldMovementAction(23)).toEqual({ action: 23, repetitions: 1, direction: 'east', tileDistance: 0, kind: 'walk' })
    expect(getFieldMovementDurationFrames(createFieldMovementAction(22))).toBe(2)
  })

  it('accepts an explicit duration for native field-task phases', () => {
    expect(getFieldMovementDurationFrames({
      action: 4,
      repetitions: 1,
      direction: 'north',
      tileDistance: 0,
      kind: 'walk',
      durationFrames: 64,
    })).toBe(64)
  })
})
