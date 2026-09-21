import { describe, expect, it } from 'vitest'
import {
  createInitialHardcoreState,
  hardcoreStateFormat,
  isHardcoreStateV1,
  parseHardcoreStateV1,
} from './hardcoreState'

describe('état sauvegardable Hardcore', () => {
  it('crée et restaure un instantané JSON strict', () => {
    const state = { ...createInitialHardcoreState(), highestProgression: 4 }
    const restored = parseHardcoreStateV1(JSON.parse(JSON.stringify(state)))

    expect(restored).toEqual({
      format: hardcoreStateFormat,
      version: 1,
      highestProgression: 4,
    })
    expect(Object.isFrozen(restored)).toBe(true)
    expect(isHardcoreStateV1(restored)).toBe(true)
  })

  it.each([
    [{ format: hardcoreStateFormat, version: 1, highestProgression: -1 }],
    [{ format: hardcoreStateFormat, version: 2, highestProgression: 0 }],
    [{ format: hardcoreStateFormat, version: 1, highestProgression: 0, extra: true }],
    [{ format: hardcoreStateFormat, version: 1 }],
    [new Date()],
  ])('refuse un état invalide %#', (value) => {
    expect(isHardcoreStateV1(value)).toBe(false)
    expect(() => parseHardcoreStateV1(value)).toThrow()
  })
})
