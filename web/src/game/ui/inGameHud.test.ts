import { describe, expect, it } from 'vitest'
import { formatHgssClock, formatHgssMoney, resolveHgssDayPhase, resolveHgssTimeOfDay } from './inGameHud'

describe('in-game HUD', () => {
  it('reprend les cinq périodes horaires natives HGSS', () => {
    expect(resolveHgssDayPhase(0)).toBe('morning')
    expect(resolveHgssDayPhase(1)).toBe('day')
    expect(resolveHgssDayPhase(2)).toBe('evening')
    expect(resolveHgssDayPhase(3)).toBe('night')
    expect(resolveHgssDayPhase(4)).toBe('late')
    expect(resolveHgssTimeOfDay(new Date(2026, 7, 19, 7))).toBe(0)
    expect(resolveHgssTimeOfDay(new Date(2026, 7, 19, 12))).toBe(1)
    expect(resolveHgssTimeOfDay(new Date(2026, 7, 19, 18))).toBe(2)
    expect(resolveHgssTimeOfDay(new Date(2026, 7, 19, 22))).toBe(3)
    expect(resolveHgssTimeOfDay(new Date(2026, 7, 19, 2))).toBe(4)
  })

  it('formate l’heure sur 24 heures et borne la monnaie affichée', () => {
    expect(formatHgssClock(new Date(2026, 7, 19, 7, 5))).toBe('07:05')
    expect(formatHgssMoney(12345)).toMatch(/^12[\s\u202f]345 ₽$/)
    expect(formatHgssMoney(-4)).toBe('0 ₽')
  })
})
