import { describe, expect, it } from 'vitest'
import {
  resolveBaseFieldWildEncounterRoute,
  type PreparedStandardWildEncounter,
} from './fieldWildEncounterRouteResolver'
import type { PreparedSafariWildEncounter } from './wildEncounterSelection'

const standardEncounters = [
  { bankId: 1, slotIndex: 0, method: 'land', time: 'day', speciesId: 16, level: 3 },
  { bankId: 1, slotIndex: 1, method: 'surfing', speciesId: 60, minLevel: 10, maxLevel: 10, level: 10 },
  { bankId: 1, slotIndex: 2, method: 'fishing', rod: 'oldRod', speciesId: 129, minLevel: 5, maxLevel: 5, level: 5 },
  { bankId: 1, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 0 },
] as const satisfies readonly PreparedStandardWildEncounter[]

const safariEncounter = {
  areaId: 0,
  areaSlot: 0,
  method: 'safari',
  safariMethod: 'land',
  time: 'day',
  slotIndex: 0,
  speciesId: 19,
  level: 5,
} as const satisfies PreparedSafariWildEncounter

describe('base field wild encounter route resolver', () => {
  it.each(standardEncounters)('routes $method encounters to the simple wild engine', (encounter) => {
    expect(resolveBaseFieldWildEncounterRoute(encounter)).toEqual({
      engine: 'simple',
      sessionKind: 'wild',
      encounter,
    })
  })

  it('routes Safari encounters to the Safari engine', () => {
    expect(resolveBaseFieldWildEncounterRoute(safariEncounter)).toEqual({
      engine: 'safari',
      encounter: safariEncounter,
    })
  })

  it('preserves the prepared encounter by identity without mutating it', () => {
    const encounter = Object.freeze({ ...safariEncounter })
    const route = resolveBaseFieldWildEncounterRoute(encounter)

    expect(route.encounter).toBe(encounter)
    expect(encounter).toEqual(safariEncounter)
  })
})
