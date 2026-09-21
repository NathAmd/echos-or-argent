import { describe, expect, it } from 'vitest'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { refreshKenjiPhoneDay } from './phoneDailyState'

describe('Kenji phone daily state', () => {
  it('clears the active rematch and consumes elapsed native wait days', () => {
    const state = {
      kenjiActive: true,
      kenjiWaitDays: 4,
      kenjiDay: '2026-8-18',
      phoneRematchSeeking: new Set([16, 17]),
      phoneGiftItems: new Map([[16, 92], [17, 85]]),
    }
    refreshKenjiPhoneDay(state, new Date(2026, 7, 20, 12), createHgssLcrng(7))
    expect(state).toMatchObject({ kenjiActive: false, kenjiWaitDays: 2, kenjiDay: '2026-8-20' })
    expect(state.phoneRematchSeeking).toEqual(new Set([17]))
    expect(state.phoneGiftItems).toEqual(new Map([[17, 85]]))
  })

  it('does not consume RNG twice during the same RTC day', () => {
    const rng = createHgssLcrng(7)
    const state = { kenjiActive: false, kenjiWaitDays: 0, kenjiDay: '2026-8-19', phoneRematchSeeking: new Set<number>(), phoneGiftItems: new Map<number, number>() }
    refreshKenjiPhoneDay(state, new Date(2026, 7, 20, 12), rng)
    const snapshot = rng.getSeed()
    refreshKenjiPhoneDay(state, new Date(2026, 7, 20, 23), rng)
    expect(rng.getSeed()).toEqual(snapshot)
    expect(state.kenjiWaitDays).toBeGreaterThanOrEqual(1)
    expect(state.kenjiWaitDays).toBeLessThanOrEqual(6)
  })
})
