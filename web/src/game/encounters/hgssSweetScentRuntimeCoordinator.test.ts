import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import { createHgssSweetScentRuntimeCoordinator } from './hgssSweetScentRuntimeCoordinator'

const table = {
  bankId: 1, rates: { walking: 20, surfing: 10, rockSmash: 0, oldRod: 0, goodRod: 0, superRod: 0 },
  land: { morning: [], day: Array.from({ length: 12 }, () => ({ speciesId: 74, level: 17 })), night: [] },
  hoennSoundSpecies: [0, 0], sinnohSoundSpecies: [0, 0], surfing: [], rockSmash: [], oldRod: [], goodRod: [], superRod: [],
  swarm: { landSpeciesId: 0, surfingSpeciesId: 0, nightFishingSpeciesId: 0, fishingSpeciesId: 0 },
} as HgssWildEncounterData

afterEach(() => vi.useRealTimers())

describe('Task Miel / Doux Parfum HGSS', () => {
  it('consomme le Miel avant le refus météo puis lance le script ROM 2019 après 20 ticks', async () => {
    vi.useFakeTimers()
    let honey = 1
    const scripts: number[] = []
    const coordinator = createHgssSweetScentRuntimeCoordinator({
      readContext: () => ({ mapId: 357, weatherId: 1, terrainAttribute: 2, encounters: table, eventFlags: new Set(), hour: 12, rng: createHgssLcrng(1) }),
      consumeHoney: () => { honey -= 1; return true }, closeMenu: () => undefined,
      presentAnimation: () => { throw new Error('animation interdite sous cette météo') },
      dismissAnimation: () => { throw new Error('fermeture interdite sous cette météo') },
      presentFailureScript: (scriptId) => scripts.push(scriptId), startEncounter: () => false, persist: () => undefined,
    })
    expect(coordinator.use('honey')).toBe(true)
    expect(honey).toBe(0)
    await vi.advanceTimersByTimeAsync(20 * 1000 / 60 + 1)
    expect(scripts).toEqual([2019])
  })

  it('anime avant la garde de case et route le Safari forcé sans Repousse', async () => {
    const order: string[] = []
    const start = vi.fn((prepared: unknown) => Boolean(prepared))
    const coordinator = createHgssSweetScentRuntimeCoordinator({
      readContext: () => ({
        mapId: 357, weatherId: 0, terrainAttribute: 2, encounters: table, eventFlags: new Set(), hour: 12, rng: createHgssLcrng(1),
        prepareContextEncounter: (method) => ({ method: 'safari', safariMethod: method, speciesId: 74, level: 17, areaId: 0, areaSlot: 0, slotIndex: 0, time: 'day' }),
      }),
      consumeHoney: () => false, closeMenu: () => order.push('close'), presentAnimation: async () => { order.push('animation') },
      dismissAnimation: async (successful) => { order.push(`dismiss:${successful}`) },
      presentFailureScript: () => undefined, startEncounter: (prepared) => { order.push('battle'); return start(prepared) }, persist: () => order.push('persist'),
    })
    expect(coordinator.use('move')).toBe(true)
    await Promise.resolve(); await Promise.resolve()
    expect(order).toEqual(['close', 'animation', 'dismiss:true', 'persist', 'battle'])
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ encounter: expect.objectContaining({ method: 'safari', safariMethod: 'land' }) }))
  })
})
