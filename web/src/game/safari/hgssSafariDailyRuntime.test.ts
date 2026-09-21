import { describe, expect, it } from 'vitest'
import { createHgssSafariProgressionState } from './hgssSafariProgression'
import { createHgssSafariState, setHgssSafariObjectUnlockLevel, startHgssSafariSession } from './hgssSafariState'
import { refreshHgssSafariForCurrentDay } from './hgssSafariDailyRuntime'

describe('actualisation quotidienne du Parc Safari HGSS', () => {
  const signature = (set: ReturnType<typeof createHgssSafariState>['areaSets'][0], slot: number): string => {
    const area = set.areas[slot]!
    return `${area.areaId}:${Math.floor(set.areaLevels[area.areaId] / 10)}`
  }

  it('vieillit les identités de zone et prépare le trigger 6 avec les zones changées', () => {
    const state = {
      safariZone: setHgssSafariObjectUnlockLevel(createHgssSafariState(0), 1),
      safariProgression: { ...createHgssSafariProgressionState(), lastAreaUpdateDay: '2026-8-1' },
      phoneCallTriggers: new Set<number>(),
    }
    refreshHgssSafariForCurrentDay(state, new Date(2026, 7, 11, 12), signature)
    expect(state.phoneCallTriggers.has(6)).toBe(true)
    expect(state.safariProgression.pendingEncounterAreaIds).toEqual(state.safariZone.areaSets[0].areas.map(({ areaId }) => areaId))
  })

  it('diffère le vieillissement pendant une session sans écraser un appel déjà en attente', () => {
    const state = {
      safariZone: startHgssSafariSession(setHgssSafariObjectUnlockLevel(createHgssSafariState(0), 1), 0),
      safariProgression: { ...createHgssSafariProgressionState(), lastAreaUpdateDay: '2026-8-1', pendingEncounterAreaIds: [0 as const] },
      phoneCallTriggers: new Set<number>([6]),
    }
    refreshHgssSafariForCurrentDay(state, new Date(2026, 7, 4, 12), signature)
    expect(state.safariZone.pendingAreaDays).toBe(3)
    expect(state.phoneCallTriggers.has(6)).toBe(true)
    expect(state.safariProgression.pendingEncounterAreaIds).toEqual([0])
  })

  it('initialise la référence des anciennes sauvegardes sans inventer de jours écoulés', () => {
    const state = {
      safariZone: setHgssSafariObjectUnlockLevel(createHgssSafariState(0), 1),
      safariProgression: createHgssSafariProgressionState(),
      phoneCallTriggers: new Set<number>(),
    }
    refreshHgssSafariForCurrentDay(state, new Date(2026, 7, 22, 12), signature)
    expect(state.safariZone.areaSets[0].areaLevels.every((level) => level === 0)).toBe(true)
    expect(state.safariProgression.lastAreaUpdateDay).toBe('2026-8-22')
  })

  it('perd les jours sous pénalité RTC comme le hook quotidien natif', () => {
    const state = {
      safariZone: setHgssSafariObjectUnlockLevel(createHgssSafariState(0), 1),
      safariProgression: { ...createHgssSafariProgressionState(), lastAreaUpdateDay: '2026-8-10' },
      phoneCallTriggers: new Set<number>(),
    }
    refreshHgssSafariForCurrentDay(state, new Date(2026, 7, 12, 12), signature, true)
    expect(state.safariProgression.lastAreaUpdateDay).toBe('2026-8-12')
    expect(state.safariZone.areaSets[0].areaLevels.every((level) => level === 0)).toBe(true)
    expect(state.safariZone.pendingAreaDays).toBe(0)
    expect(state.phoneCallTriggers.has(6)).toBe(false)

    refreshHgssSafariForCurrentDay(state, new Date(2026, 7, 13, 12), signature)
    expect(state.safariZone.areaSets[0].areaLevels.filter((level) => level === 1)).toHaveLength(6)
  })
})
