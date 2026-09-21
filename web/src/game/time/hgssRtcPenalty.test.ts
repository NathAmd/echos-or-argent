import { describe, expect, it } from 'vitest'
import {
  advanceHgssRtcPenaltyState,
  continueHgssRtcPenaltyState,
  createHgssRtcPenaltyState,
  getHgssRtcTimestampSeconds,
  hasHgssRtcPenalty,
  HGSS_RTC_SYSTEM_CHANGE_PENALTY_MINUTES,
  restoreHgssRtcPenaltyState,
} from './hgssRtcPenalty'

describe('pénalité RTC globale HGSS', () => {
  it('initialise la SysInfo RTC sans pénalité', () => {
    const now = new Date(2026, 7, 22, 12, 34, 56)
    const state = createHgssRtcPenaltyState(now, -120)
    expect(state).toMatchObject({ schemaVersion: 1, ownerRtcOffset: -120, penaltyMinutes: 0 })
    expect(hasHgssRtcPenalty(state)).toBe(false)
  })

  it('arme exactement 1440 minutes et recale les deux repères lors d’un changement système', () => {
    const before = createHgssRtcPenaltyState(new Date(2026, 7, 21, 8), -120)
    const continued = continueHgssRtcPenaltyState(before, new Date(2026, 7, 22, 9), {
      ownerRtcOffset: -60,
    })
    expect(HGSS_RTC_SYSTEM_CHANGE_PENALTY_MINUTES).toBe(1_440)
    expect(continued).toMatchObject({ ownerRtcOffset: -60, penaltyMinutes: 1_440 })
    expect(continued.lastObservedTimestampSeconds).not.toBe(before.lastObservedTimestampSeconds)
    expect(continueHgssRtcPenaltyState(before, new Date(2026, 7, 22, 9), {
      ownerRtcOffset: -120,
    })).toEqual(before)
    expect(continueHgssRtcPenaltyState(before, new Date(2026, 7, 22, 9), {
      ownerRtcOffset: -120,
      systemIdentityChanged: true,
    }).penaltyMinutes).toBe(1_440)
  })

  it('évalue les tâches quotidiennes avant de décrémenter la dernière minute', () => {
    const start = createHgssRtcPenaltyState(new Date(2026, 7, 21, 23, 59), 0)
    start.penaltyMinutes = 1
    const result = advanceHgssRtcPenaltyState(start, new Date(2026, 7, 22, 0, 0))
    expect(result).toMatchObject({ elapsedDays: 1, elapsedMinutes: 1, hadPenaltyForDailyTasks: true })
    expect(result.state.penaltyMinutes).toBe(0)
  })

  it('accumule les secondes sous la minute et reproduit la décrémentation native bornée', () => {
    const start = createHgssRtcPenaltyState(new Date(2026, 7, 22, 12, 0, 0), 0)
    start.penaltyMinutes = 0xffff_ffff
    const first = advanceHgssRtcPenaltyState(start, new Date(2026, 7, 22, 12, 0, 59))
    expect(first.elapsedMinutes).toBe(0)
    expect(first.state.lastObservedTimestampSeconds).toBe(start.lastObservedTimestampSeconds)
    const second = advanceHgssRtcPenaltyState(first.state, new Date(2026, 7, 22, 12, 1, 0))
    expect(second.state.penaltyMinutes).toBe(1_439)
  })

  it('recale une horloge qui recule sans créer ni décrémenter de pénalité', () => {
    const start = createHgssRtcPenaltyState(new Date(2026, 7, 22, 12), 0)
    start.penaltyMinutes = 30
    const result = advanceHgssRtcPenaltyState(start, new Date(2026, 7, 20, 12))
    expect(result).toMatchObject({ elapsedDays: 0, elapsedMinutes: 0, hadPenaltyForDailyTasks: true })
    expect(result.state.penaltyMinutes).toBe(30)
    expect(result.state.lastObservedDayOrdinal).toBeLessThan(start.lastObservedDayOrdinal)
  })

  it('migre une ancienne sauvegarde sans supposer un changement de console', () => {
    const now = new Date(2026, 7, 22, 12)
    expect(restoreHgssRtcPenaltyState(undefined, now, { ownerRtcOffset: -120 }))
      .toEqual(createHgssRtcPenaltyState(now, -120))
    expect(() => restoreHgssRtcPenaltyState({ schemaVersion: 1 }, now)).toThrow(/RTC/)
  })

  it('ne confond pas le fuseau/DST navigateur avec l’offset RTC matériel absent', () => {
    const before = createHgssRtcPenaltyState(new Date(2026, 2, 28, 12))
    expect(continueHgssRtcPenaltyState(before, new Date(2026, 2, 29, 12))).toEqual(before)
  })

  it('convertit les champs civils RTC sans passer par l’époque UTC du navigateur', () => {
    const now = new Date(2026, 2, 29, 12, 34, 56)
    expect(getHgssRtcTimestampSeconds(now)).toBe(Date.UTC(2026, 2, 29, 12, 34, 56) / 1_000)
  })
})
