import { describe, expect, it } from 'vitest'
import { resolveHgssTrainerEncounterMusic } from './trainerEncounterMusic'

describe('HGSS trainer encounter music', () => {
  it('uses the exact ROM themes for ordinary and special trainer classes', () => {
    expect(resolveHgssTrainerEncounterMusic(2, 0)).toBe(1108)
    expect(resolveHgssTrainerEncounterMusic(47, 0)).toBe(1111)
    expect(resolveHgssTrainerEncounterMusic(55, 1)).toBe(1112)
  })

  it('keeps the native regional Scientist difference and default', () => {
    expect(resolveHgssTrainerEncounterMusic(113, 0)).toBe(1112)
    expect(resolveHgssTrainerEncounterMusic(113, 1)).toBe(1109)
    expect(resolveHgssTrainerEncounterMusic(0, 0)).toBe(1108)
  })
})
