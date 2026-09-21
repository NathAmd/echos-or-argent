import { describe, expect, it } from 'vitest'
import { canSkipOpeningCinematic, createOpeningCinematicState, openingCinematicDurationMs } from './openingCinematic'

describe('opening cinematic', () => {
  it('crosses the five native scenes and completes at the declared duration', () => {
    expect(openingCinematicDurationMs).toBeCloseTo(2_198 * 1000 / 60)
    expect(createOpeningCinematicState(0).scene).toBe('copyright-sunrise')
    expect(createOpeningCinematicState(13_000).scene).toBe('players')
    expect(createOpeningCinematicState(20_000).scene).toBe('johto-rival')
    expect(createOpeningCinematicState(32_000).scene).toBe('starters')
    expect(createOpeningCinematicState(36_000).scene).toBe('final-scroll')
    expect(createOpeningCinematicState(openingCinematicDurationMs).complete).toBe(true)
  })

  it('does not accept an accidental input while the first fade is starting', () => {
    expect(canSkipOpeningCinematic(100)).toBe(false)
    expect(canSkipOpeningCinematic(1_850)).toBe(true)
  })

  it('keeps the native movie cuts as distinct shots with their own transitions', () => {
    expect(createOpeningCinematicState(0)).toMatchObject({ transition: 'fade-black', transitionProgress: 0 })
    expect(createOpeningCinematicState(500)).toMatchObject({ scene: 'copyright-sunrise', shot: 0, transition: 'cut' })
    expect(createOpeningCinematicState(600)).toMatchObject({ scene: 'copyright-sunrise', shot: 0, transition: 'fade-black' })
    expect(createOpeningCinematicState(4_000)).toMatchObject({ scene: 'copyright-sunrise', shot: 3, transition: 'cut' })
    expect(createOpeningCinematicState(20_250)).toMatchObject({ scene: 'johto-rival', shot: 3, transition: 'iris' })
    expect(createOpeningCinematicState(34_500)).toMatchObject({ scene: 'starters', shot: 3, transition: 'fade-black' })
    expect(createOpeningCinematicState(36_000)).toMatchObject({ scene: 'final-scroll', shot: 0, transition: 'fade-white' })
  })

  it('restarts local animation clocks at every native shot', () => {
    const playersStart = 746 * 1000 / 60
    expect(createOpeningCinematicState(playersStart)).toMatchObject({ scene: 'players', shot: 0, shotElapsedMs: 0 })
    expect(createOpeningCinematicState(playersStart + 65 * 1000 / 60 + 50)).toMatchObject({ scene: 'players', shot: 1, shotElapsedMs: 50 })
  })
})
