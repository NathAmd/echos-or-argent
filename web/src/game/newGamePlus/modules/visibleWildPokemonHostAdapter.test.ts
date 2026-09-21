import { describe, expect, it, vi } from 'vitest'
import type { PreparedFieldWildEncounter } from '../../encounters/wildEncounterSelection'
import { tryStartVisibleWildPokemonInteraction } from './visibleWildPokemonHostAdapter'
import {
  createVisibleWildPokemonRuntime,
  type VisibleWildInteraction,
} from './visibleWildPokemonRule'

const prepared: PreparedFieldWildEncounter = Object.freeze({
  rateRoll: Object.freeze({ triggered: true, modifiedRate: 20, firstRoll: 4 }),
  encounter: Object.freeze({
    bankId: 1,
    slotIndex: 0,
    method: 'land' as const,
    time: 'day' as const,
    speciesId: 16,
    level: 4,
  }),
})

function createRuntimeWithActor() {
  const runtime = createVisibleWildPokemonRuntime({
    seed: 'host-adapter',
    actorsPerMap: 1,
    includeSafari: true,
    movement: 'stationary',
  })
  const [actor] = runtime.syncMap({
    mapId: 7,
    spawnTiles: [{ tileX: 4, tileZ: 5 }],
    prepareEncounters: () => [{ encounterKey: 'map-7:land:0', prepared }],
  })
  return { runtime, actor: actor! }
}

describe('adaptateur hôte des Pokémon visibles', () => {
  it('réutilise par référence la rencontre et le starter sauvage existants', () => {
    const { runtime, actor } = createRuntimeWithActor()
    const resolvePreparedEncounter = vi.fn((interaction: VisibleWildInteraction) => {
      void interaction
      return prepared
    })
    const startPreparedEncounter = vi.fn((
      preparedEncounter: PreparedFieldWildEncounter,
      interaction: VisibleWildInteraction,
    ) => {
      void preparedEncounter
      void interaction
      return true
    })

    expect(tryStartVisibleWildPokemonInteraction(runtime, actor.id, {
      resolvePreparedEncounter,
      startPreparedEncounter,
    })).toBe(true)
    expect(resolvePreparedEncounter).toHaveBeenCalledOnce()
    expect(resolvePreparedEncounter.mock.calls[0]![0]).toMatchObject({
      actorId: actor.id,
      encounterKey: 'map-7:land:0',
      source: 'visible-world',
    })
    expect(startPreparedEncounter).toHaveBeenCalledOnce()
    expect(startPreparedEncounter.mock.calls[0]![0]).toBe(prepared)
    expect(startPreparedEncounter.mock.calls[0]![1]).toMatchObject({
      actorId: actor.id,
      encounterKey: 'map-7:land:0',
      source: 'visible-world',
    })
    expect(runtime.registry.get(actor.id)).toBeUndefined()
  })

  it('conserve l’acteur si la résolution ou le démarrage hôte échoue', () => {
    const unresolved = createRuntimeWithActor()
    expect(tryStartVisibleWildPokemonInteraction(unresolved.runtime, unresolved.actor.id, {
      resolvePreparedEncounter: () => undefined,
      startPreparedEncounter: () => { throw new Error('unreachable') },
    })).toBe(false)
    expect(unresolved.runtime.registry.get(unresolved.actor.id)).toBeDefined()

    const refused = createRuntimeWithActor()
    expect(tryStartVisibleWildPokemonInteraction(refused.runtime, refused.actor.id, {
      resolvePreparedEncounter: () => prepared,
      startPreparedEncounter: () => false,
    })).toBe(false)
    expect(refused.runtime.registry.get(refused.actor.id)).toBeDefined()

    const failed = createRuntimeWithActor()
    expect(() => tryStartVisibleWildPokemonInteraction(failed.runtime, failed.actor.id, {
      resolvePreparedEncounter: () => prepared,
      startPreparedEncounter: () => { throw new Error('battle failed') },
    })).toThrow('battle failed')
    expect(failed.runtime.registry.get(failed.actor.id)).toBeDefined()
  })
})
