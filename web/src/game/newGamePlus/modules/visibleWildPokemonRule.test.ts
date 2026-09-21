import { describe, expect, it, vi } from 'vitest'
import type { PreparedFieldWildEncounter } from '../../encounters/wildEncounterSelection'
import {
  createVisibleWildPokemonRuntime,
  visibleWildPokemonSaveExtension,
  visibleWildPokemonSaveExtensionKey,
  visibleWildPokemonSaveExtensionVersion,
  type VisibleWildPreparedCandidate,
} from './visibleWildPokemonRule'

const rateRoll = Object.freeze({ triggered: true, modifiedRate: 20, firstRoll: 4 })

function preparedLand(speciesId: number, level: number, slotIndex = 0): PreparedFieldWildEncounter {
  return {
    rateRoll,
    encounter: { bankId: 1, slotIndex, method: 'land', time: 'day', speciesId, level },
  }
}

function preparedSurf(speciesId: number, level: number, slotIndex = 0): PreparedFieldWildEncounter {
  return {
    rateRoll,
    encounter: { bankId: 1, slotIndex, method: 'surfing', speciesId, minLevel: level, maxLevel: level, level },
  }
}

function preparedSafari(speciesId: number, level: number, slotIndex = 0): PreparedFieldWildEncounter {
  return {
    rateRoll,
    encounter: {
      areaId: 2,
      areaSlot: 1,
      method: 'safari',
      safariMethod: 'land',
      time: 'day',
      slotIndex,
      speciesId,
      level,
    },
  }
}

function preparedFishing(speciesId: number, level: number): PreparedFieldWildEncounter {
  return {
    rateRoll,
    encounter: {
      bankId: 1,
      slotIndex: 0,
      method: 'fishing',
      rod: 'oldRod',
      speciesId,
      minLevel: level,
      maxLevel: level,
      level,
    },
  }
}

function candidate(encounterKey: string, prepared: PreparedFieldWildEncounter): VisibleWildPreparedCandidate {
  return { encounterKey, prepared }
}

const config = Object.freeze({
  seed: 'visible-runtime-test',
  actorsPerMap: 3,
  includeSafari: true,
  movement: 'wander' as const,
})
const tiles = Object.freeze([
  Object.freeze({ tileX: 10, tileZ: 10 }),
  Object.freeze({ tileX: 11, tileZ: 10 }),
  Object.freeze({ tileX: 12, tileZ: 10 }),
])
const candidates = Object.freeze([
  candidate('map-7:land:0', preparedLand(16, 4, 0)),
  candidate('map-7:land:1', preparedLand(19, 5, 1)),
  candidate('map-7:land:2', preparedLand(25, 6, 2)),
])

describe('runtime NG+ des Pokémon visibles', () => {
  it('expose un contributeur de sauvegarde versionné autonome', () => {
    const source = createVisibleWildPokemonRuntime(config)
    source.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 10, tileZ: 10 }],
      prepareEncounters: () => [candidates[0]!],
    })
    const snapshot = visibleWildPokemonSaveExtension.save(source)
    expect(visibleWildPokemonSaveExtension.key).toBe(visibleWildPokemonSaveExtensionKey)
    expect(visibleWildPokemonSaveExtension.version).toBe(visibleWildPokemonSaveExtensionVersion)
    expect(snapshot && visibleWildPokemonSaveExtension.validate(snapshot)).toBe(true)

    const destination = createVisibleWildPokemonRuntime(config)
    visibleWildPokemonSaveExtension.load(destination, snapshot!)
    expect(destination.snapshotState()).toEqual(source.snapshotState())
  })

  it('génère les mêmes acteurs indépendamment de l’ordre hôte et les restaure sans nouveau tirage', () => {
    const first = createVisibleWildPokemonRuntime(config)
    const second = createVisibleWildPokemonRuntime(config)
    const firstPrepare = vi.fn(() => candidates)
    const secondPrepare = vi.fn(() => [...candidates].reverse())

    first.syncMap({ mapId: 7, spawnTiles: tiles, prepareEncounters: firstPrepare })
    second.syncMap({ mapId: 7, spawnTiles: [...tiles].reverse(), prepareEncounters: secondPrepare })
    expect(first.snapshotState()).toEqual(second.snapshotState())
    expect(firstPrepare).toHaveBeenCalledOnce()
    expect(secondPrepare).toHaveBeenCalledOnce()

    const restored = createVisibleWildPokemonRuntime(
      config,
      JSON.parse(JSON.stringify(first.snapshotState())),
    )
    const shouldNotPrepare = vi.fn(() => candidates)
    expect(restored.syncMap({ mapId: 7, spawnTiles: [], prepareEncounters: shouldNotPrepare }))
      .toEqual(first.registry.getActorsOnMap(7))
    expect(shouldNotPrepare).not.toHaveBeenCalled()
  })

  it('fournit collision/action et résout uniquement la rencontre hôte de même identité', () => {
    const runtime = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 1 })
    const prepared = preparedLand(16, 4)
    const [actor] = runtime.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 4, tileZ: 5 }],
      prepareEncounters: () => [candidate('map-7:land:0', prepared)],
    })
    expect(actor).toBeDefined()
    expect(runtime.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(7, 4, 5)).toEqual([actor])
    expect(runtime.worldSessionExtensionPorts.dynamicActors.getInteractableActorsAt(7, 4, 5)).toEqual([actor])

    const interaction = runtime.getInteraction(actor!.id)
    expect(interaction).toEqual({
      actorId: actor!.id,
      encounterKey: 'map-7:land:0',
      mapId: 7,
      source: 'visible-world',
      encounterMethod: 'land',
      identity: { speciesId: 16, form: 0, level: 4 },
    })
    const resolved = runtime.resolvePreparedInteraction(actor!.id, () => prepared)
    expect(resolved?.prepared).toBe(prepared)
    expect(() => runtime.resolvePreparedInteraction(actor!.id, () => preparedLand(19, 4))).toThrow(/ne correspond pas/)
    expect(runtime.resolvePreparedInteraction('missing', () => prepared)).toBeUndefined()
  })

  it('ne retire un acteur qu’après confirmation du démarrage et persiste ce retrait', () => {
    const runtime = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 1 })
    const prepared = preparedLand(16, 4)
    const [actor] = runtime.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 4, tileZ: 5 }],
      prepareEncounters: () => [candidate('map-7:land:0', prepared)],
    })
    expect(runtime.getInteraction(actor!.id)).toBeDefined()
    expect(runtime.commitEncounterStarted(actor!.id)).toMatchObject({ encounterKey: 'map-7:land:0' })
    expect(runtime.registry.get(actor!.id)).toBeUndefined()
    expect(runtime.commitEncounterStarted(actor!.id)).toBeUndefined()

    const restored = createVisibleWildPokemonRuntime(config, runtime.snapshotState())
    expect(restored.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 4, tileZ: 5 }],
      prepareEncounters: () => [candidate('map-7:land:0', prepared)],
    })).toEqual([])
  })

  it('inclut ou exclut Safari explicitement et ne matérialise ni pêche ni roamer', () => {
    const mixed = [
      candidate('land', preparedLand(16, 4)),
      candidate('safari', preparedSafari(118, 17)),
      candidate('fishing', preparedFishing(129, 5)),
    ]
    const included = createVisibleWildPokemonRuntime(config)
    const excluded = createVisibleWildPokemonRuntime({ ...config, includeSafari: false })
    const includedActors = included.syncMap({ mapId: 357, spawnTiles: tiles, prepareEncounters: () => mixed })
    const excludedActors = excluded.syncMap({ mapId: 357, spawnTiles: tiles, prepareEncounters: () => mixed })

    expect(includedActors.map(({ speciesId }) => speciesId).sort((a, b) => a - b)).toEqual([16, 118])
    expect(excludedActors.map(({ speciesId }) => speciesId)).toEqual([16])
  })

  it('conserve le lien entre une identite Safari et sa case de zone preferee', () => {
    const runtime = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 2 })
    runtime.syncMap({
      mapId: 357,
      spawnTiles: [{ tileX: 10, tileZ: 10 }, { tileX: 12, tileZ: 10 }],
      prepareEncounters: () => [
        { ...candidate('safari-a', preparedSafari(118, 17)), spawnTile: { tileX: 12, tileZ: 10 } },
        { ...candidate('safari-b', preparedSafari(119, 18, 1)), spawnTile: { tileX: 10, tileZ: 10 } },
      ],
    })
    expect(runtime.snapshotState().actors.map(({ encounterKey, tileX, tileZ }) => ({ encounterKey, tileX, tileZ })))
      .toEqual(expect.arrayContaining([
        { encounterKey: 'safari-a', tileX: 12, tileZ: 10 },
        { encounterKey: 'safari-b', tileX: 10, tileZ: 10 },
      ]))
  })

  it('laisse le host séparer strictement les surfaces de placement terre et Surf', () => {
    const runtime = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 2 })
    const landTile = { tileX: 2, tileZ: 3 }
    const surfTile = { tileX: 7, tileZ: 8 }
    runtime.syncMap({
      mapId: 7,
      spawnTiles: [landTile, surfTile],
      prepareEncounters: () => [
        candidate('surface-land', preparedLand(19, 5)),
        candidate('surface-surf', preparedSurf(129, 10)),
      ],
      canPlaceCandidate: ({ encounterMethod }, tile) => encounterMethod === 'land'
        ? tile.tileX === landTile.tileX && tile.tileZ === landTile.tileZ
        : tile.tileX === surfTile.tileX && tile.tileZ === surfTile.tileZ,
    })
    const byMethod = new Map(runtime.snapshotState().actors.map((actor) => [
      actor.encounterMethod,
      { tileX: actor.tileX, tileZ: actor.tileZ },
    ]))
    expect(byMethod.get('land')).toEqual(landTile)
    expect(byMethod.get('surfing')).toEqual(surfTile)
  })

  it('evince les acteurs des anciennes cartes mais garde leurs retraits persistants', () => {
    const runtime = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 1 })
    const map7Candidates = [
      candidate('map-7:land:0', preparedLand(16, 4)),
      candidate('map-7:land:1', preparedLand(19, 5, 1)),
    ]
    const [first] = runtime.syncMap({
      mapId: 7, spawnTiles: [{ tileX: 4, tileZ: 5 }], prepareEncounters: () => map7Candidates,
    })
    const retiredKey = runtime.getInteraction(first!.id)!.encounterKey
    runtime.commitEncounterStarted(first!.id)
    runtime.syncMap({
      mapId: 8,
      spawnTiles: [{ tileX: 1, tileZ: 2 }],
      prepareEncounters: () => [candidate('map-8:land:0', preparedLand(25, 6))],
    })
    expect(runtime.snapshotState().actors.map(({ mapId }) => mapId)).toEqual([8])
    expect(runtime.snapshotState().retiredEncounters).toEqual([{ mapId: 7, encounterKey: retiredKey }])

    const repopulated = runtime.syncMap({
      mapId: 7, spawnTiles: [{ tileX: 4, tileZ: 5 }], prepareEncounters: () => map7Candidates,
    })
    expect(repopulated).toHaveLength(1)
    expect(runtime.snapshotState().actors.every(({ mapId }) => mapId === 7)).toBe(true)
    expect(runtime.snapshotState().retiredEncounters).toHaveLength(1)
    expect(runtime.getInteraction(repopulated[0]!.id)?.encounterKey)
      .not.toBe(runtime.snapshotState().retiredEncounters[0]!.encounterKey)
  })

  it('repeuple par cycles avec une fenetre HGSS et survit a de nombreuses sauvegardes', () => {
    const cycleConfig = { ...config, actorsPerMap: 1, movement: 'stationary' as const }
    const preparation = {
      mapId: 7,
      spawnTiles: [{ tileX: 4, tileZ: 5 }],
      prepareEncounters: () => [
        candidate('map-7:cycle:0', preparedLand(16, 4)),
        candidate('map-7:cycle:1', preparedLand(19, 5, 1)),
      ],
    }
    let runtime = createVisibleWildPokemonRuntime(cycleConfig)
    let actors = runtime.syncMap(preparation)
    let fallbackWindows = 0
    for (let capture = 0; capture < 200; capture += 1) {
      const actor = actors[0]!
      const retiredKey = runtime.getInteraction(actor.id)!.encounterKey
      runtime.commitEncounterStarted(actor.id)
      actors = runtime.syncMap(preparation)
      if (actors.length > 0) continue
      fallbackWindows += 1
      const pending = runtime.snapshotState()
      expect(pending.populationCycles).toContainEqual(expect.objectContaining({
        mapId: 7, repopulationPending: true,
      }))
      expect(pending.retiredEncounters.length).toBeLessThanOrEqual(2)
      runtime = createVisibleWildPokemonRuntime(cycleConfig, JSON.parse(JSON.stringify(pending)))
      actors = runtime.syncMap(preparation)
      expect(actors).toHaveLength(1)
      expect(runtime.getInteraction(actors[0]!.id)!.encounterKey).not.toBe(retiredKey)
    }
    expect(fallbackWindows).toBe(100)
    expect(runtime.snapshotState().populationCycles[0]).toMatchObject({
      mapId: 7, generation: 100, repopulationPending: false,
    })
  })

  it('borne la memoire des retraits pendant une exploration extreme', () => {
    const runtime = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 1, movement: 'stationary' })
    for (let mapId = 1; mapId <= 4_200; mapId += 1) {
      const [actor] = runtime.syncMap({
        mapId,
        spawnTiles: [{ tileX: 1, tileZ: 1 }],
        prepareEncounters: () => [candidate(`map-${mapId}:long-run:0`, preparedLand(16, 4))],
      })
      runtime.commitEncounterStarted(actor!.id)
    }
    const snapshot = runtime.snapshotState()
    expect(snapshot.retiredEncounters).toHaveLength(4_096)
    expect(snapshot.actors).toEqual([])
  })

  it('avance de façon déterministe, respecte la collision hôte et reste stable après reload', () => {
    const first = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 1 })
    first.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 10, tileZ: 10 }],
      prepareEncounters: () => [candidates[0]!],
    })
    const restored = createVisibleWildPokemonRuntime(config, first.snapshotState())
    const canOccupy = vi.fn(({ tileX }: { tileX: number }) => tileX !== 9)

    const movedFirst = first.advanceMovement({ mapId: 7, canOccupy })
    const movedRestored = restored.advanceMovement({ mapId: 7, canOccupy })
    expect(movedFirst).toEqual(movedRestored)
    expect(first.snapshotState()).toEqual(restored.snapshotState())
    expect(canOccupy).toHaveBeenCalled()

    const stationary = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 1, movement: 'stationary' })
    stationary.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 10, tileZ: 10 }],
      prepareEncounters: () => [candidates[0]!],
    })
    const before = stationary.snapshotState()
    expect(stationary.advanceMovement({ mapId: 7, canOccupy: () => true }))
      .toEqual(stationary.registry.getActorsOnMap(7))
    expect(stationary.snapshotState()).toEqual(before)
  })

  it('prépare génération et mouvement transactionnellement en cas d’échec hôte', () => {
    const runtime = createVisibleWildPokemonRuntime({ ...config, actorsPerMap: 1 })
    expect(() => runtime.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 4, tileZ: 5 }],
      prepareEncounters: () => { throw new Error('host preparation failed') },
    })).toThrow('host preparation failed')
    expect(runtime.registry.size()).toBe(0)

    runtime.syncMap({
      mapId: 7,
      spawnTiles: [{ tileX: 4, tileZ: 5 }],
      prepareEncounters: () => [candidates[0]!],
    })
    const before = runtime.snapshotState()
    expect(() => runtime.syncMap({
      mapId: 8,
      spawnTiles: [{ tileX: 1, tileZ: 2 }],
      prepareEncounters: () => { throw new Error('next map preparation failed') },
    })).toThrow('next map preparation failed')
    expect(runtime.snapshotState()).toEqual(before)
    expect(() => runtime.advanceMovement({
      mapId: 7,
      canOccupy: () => { throw new Error('host collision failed') },
    })).toThrow('host collision failed')
    expect(runtime.snapshotState()).toEqual(before)
  })
})
