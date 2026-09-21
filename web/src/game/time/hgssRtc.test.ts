import { describe, expect, it } from 'vitest'
import {
  isHgssNighttime,
  resolveHgssBattlePaletteTime,
  resolveHgssFieldVisualTime,
  resolveHgssTimeOfDayByHour,
  resolveHgssWeekday,
  resolveHgssWildTimeOfDay,
} from './hgssRtc'

describe('RTC HGSS', () => {
  it('reproduit exactement les cinq plages horaires de la ROM', () => {
    expect(Array.from({ length: 24 }, (_, hour) => resolveHgssTimeOfDayByHour(hour))).toEqual([
      4, 4, 4, 4,
      0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1,
      2, 2, 2,
      3, 3, 3, 3,
    ])
  })

  it('projette chaque période dans la table attendue par son consommateur', () => {
    expect(([0, 1, 2, 3, 4] as const).map(resolveHgssWildTimeOfDay)).toEqual([0, 1, 1, 2, 2])
    expect(([0, 1, 2, 3, 4] as const).map(resolveHgssFieldVisualTime)).toEqual([0, 1, 2, 3, 3])
    expect(([0, 1, 2, 3, 4] as const).map(resolveHgssBattlePaletteTime)).toEqual([0, 0, 1, 2, 2])
    expect(([0, 1, 2, 3, 4] as const).map(isHgssNighttime)).toEqual([false, false, false, true, true])
  })

  it('conserve le dimanche comme premier jour de semaine RTC', () => {
    expect(resolveHgssWeekday(new Date(2026, 7, 16, 12))).toBe(0)
    expect(resolveHgssWeekday(new Date(2026, 7, 19, 12))).toBe(3)
  })

  it('refuse une heure hors de la table ROM', () => {
    expect(() => resolveHgssTimeOfDayByHour(-1)).toThrow(/invalide/)
    expect(() => resolveHgssTimeOfDayByHour(24)).toThrow(/invalide/)
  })
})
