import { describe, expect, it } from 'vitest'
import { addHgssInGameTimeSeconds, createHgssInGameTimeClock, restoreHgssInGameTime } from './hgssInGameTime'

describe('HGSS in-game time', () => {
  it('reproduit les retenues et la saturation natives', () => {
    expect(addHgssInGameTimeSeconds({ hours: 12, minutes: 59, seconds: 58 }, 3)).toEqual({ hours: 13, minutes: 0, seconds: 1 })
    expect(addHgssInGameTimeSeconds({ hours: 998, minutes: 59, seconds: 59 }, 1)).toEqual({ hours: 999, minutes: 59, seconds: 59 })
    expect(addHgssInGameTimeSeconds({ hours: 999, minutes: 59, seconds: 59 }, 40)).toEqual({ hours: 999, minutes: 59, seconds: 59 })
  })

  it('ne compte que les périodes de jeu reprises', () => {
    let now = 1_000
    const clock = createHgssInGameTimeClock({ hours: 2, minutes: 3, seconds: 4 }, () => now)
    clock.resume()
    now += 61_900
    expect(clock.snapshot()).toEqual({ hours: 2, minutes: 4, seconds: 5 })
    clock.pause()
    now += 60_000
    expect(clock.snapshot()).toEqual({ hours: 2, minutes: 4, seconds: 5 })
    clock.resume()
    now += 2_000
    expect(clock.totalMinutes()).toBe(124)
    expect(clock.snapshot().seconds).toBe(7)
  })

  it('migre une sauvegarde antérieure et refuse les composantes invalides', () => {
    expect(restoreHgssInGameTime(undefined)).toEqual({ hours: 0, minutes: 0, seconds: 0 })
    expect(() => restoreHgssInGameTime({ hours: 1, minutes: 60, seconds: 0 })).toThrow('igt.minutes')
  })
})
