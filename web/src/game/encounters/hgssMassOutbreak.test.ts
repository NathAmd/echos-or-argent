import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import { hgssMassOutbreakLocations, isHgssMassOutbreakActiveForMap, resolveHgssMassOutbreak, resolveHgssMassOutbreakAnnouncement } from './hgssMassOutbreak'

describe('HGSS mass outbreaks', () => {
  it('ports every ROM swarm location and method in daily-random order', () => {
    expect(hgssMassOutbreakLocations).toHaveLength(20)
    expect(resolveHgssMassOutbreak({ active: true, randomValue: 0 })).toEqual([9, 'land'])
    expect(resolveHgssMassOutbreak({ active: true, randomValue: 3 })).toEqual([20, 'fishing'])
    expect(resolveHgssMassOutbreak({ active: true, randomValue: 18 })).toEqual([54, 'surf'])
    expect(resolveHgssMassOutbreak({ active: true, randomValue: 39 })).toEqual([73, 'fishing'])
  })

  it('requires both the selected map and the native encounter method', () => {
    const context = { active: true, randomValue: 5 }
    expect(isHgssMassOutbreakActiveForMap(context, 91, 'surf')).toBe(true)
    expect(isHgssMassOutbreakActiveForMap(context, 91, 'land')).toBe(false)
    expect(isHgssMassOutbreakActiveForMap({ ...context, active: false }, 91, 'surf')).toBe(false)
  })

  it('announces the species from the selected map encounter bank', () => {
    const maps = [{ id: 20, header: { wildEncounterBank: 2 } }] as OpeningMapPreview[]
    const catalog = Array.from({ length: 3 }) as HgssWildEncounterData[]
    catalog[2] = { swarm: { landSpeciesId: 1, surfingSpeciesId: 2, nightFishingSpeciesId: 3, fishingSpeciesId: 223 } } as HgssWildEncounterData
    expect(resolveHgssMassOutbreakAnnouncement({ active: true, randomValue: 3 }, maps, catalog))
      .toEqual({ mapId: 20, speciesId: 223 })
  })
})
