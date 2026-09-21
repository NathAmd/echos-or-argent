import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import { baseGameplayExtensionPorts } from '../extensions/gameplayExtensionPorts'
import { resolveHgssVisibleSafariEncounterCandidate } from '../encounters/hgssVisibleSafariEncounterCandidates'
import type { PreparedSafariWildEncounter } from '../encounters/wildEncounterSelection'
import { createVisibleWildPokemonRuntime } from './modules/visibleWildPokemonRule'
import { visibleWildPokemonModuleId } from './modules/visibleWildPokemonModule'
import {
  createNewGamePlusDynamicPokemonWorldHost,
  type NewGamePlusDynamicPokemonWorldContext,
  type NewGamePlusDynamicPokemonWorldHostOptions,
} from './newGamePlusDynamicPokemonWorldHost'
import type { NewGamePlusGameplayRuntime } from './newGamePlusGameplayRuntime'

function safariMap(): OpeningMapPreview {
  return {
    id: 357,
    header: { mapId: 357, wildEncounterBank: 0xff },
    matrix: {
      matrixIndex: 212,
      name: 'm_safari_',
      width: 5,
      height: 4,
      hasHeaders: true,
      headers: new Uint16Array([
        0, 0, 0, 0, 0,
        0, 357, 357, 357, 0,
        0, 357, 357, 357, 0,
        0, 0, 357, 0, 0,
      ]),
      altitudes: new Uint8Array(20),
      modelIds: new Uint16Array(20),
    },
    terrain: { width: 2, height: 1, attributes: new Uint16Array([0, 16]) },
    events: { objects: [], warps: [], backgrounds: [], coordinateEvents: [] },
  } as unknown as OpeningMapPreview
}

function runtimeWithVisible(
  includeSafari: boolean,
  state?: unknown,
  movement: 'stationary' | 'wander' = 'stationary',
  actorsPerMap = 1,
) {
  const visible = createVisibleWildPokemonRuntime({
    seed: 'dynamic-host-safari', actorsPerMap, includeSafari, movement,
  }, state)
  const runtime = {
    profile: {} as never,
    ports: baseGameplayExtensionPorts,
    applyFieldStateMigrations: () => undefined,
    snapshotExtensions: () => undefined,
    getModuleRuntime: (moduleId: string) => moduleId === visibleWildPokemonModuleId ? visible : undefined,
  } satisfies NewGamePlusGameplayRuntime
  return { runtime, visible }
}

function safariContext(
  prepareSafariEncounter: NewGamePlusDynamicPokemonWorldContext['prepareSafariEncounter'],
): NewGamePlusDynamicPokemonWorldContext {
  return {
    map: safariMap(),
    encounterCatalog: [],
    hour: 12,
    radioEffect: 'none',
    massOutbreak: { active: false, randomValue: 0 },
    isSafari: true,
    ...(prepareSafariEncounter ? { prepareSafariEncounter } : {}),
    isTileBlocked: () => false,
  }
}

function preparedFor(method: 'land' | 'surf', speciesId: number): PreparedSafariWildEncounter {
  return {
    method: 'safari', safariMethod: method, time: 'day', areaId: 0, areaSlot: 0,
    slotIndex: method === 'land' ? 0 : 1, speciesId, level: method === 'land' ? 12 : 14,
  }
}

function normalMap(): OpeningMapPreview {
  const width = 8, height = 6
  const attributes = new Uint16Array(width * height).fill(0x8000)
  for (let z = 1; z < height - 1; z += 1) for (let x = 1; x < width - 1; x += 1) {
    attributes[z * width + x] = x < 4 ? 0 : 16
  }
  return {
    id: 9,
    header: { mapId: 9, wildEncounterBank: 1 },
    matrix: {
      matrixIndex: 1, name: 'normal', width: 1, height: 1, hasHeaders: false,
      headers: new Uint16Array([9]), altitudes: new Uint8Array(1), modelIds: new Uint16Array(1),
    },
    terrain: { width, height, attributes },
    events: {
      objects: [{ id: 1, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 1,
        facingDirection: 0, xRange: 0, zRange: 0, x: 2, z: 2 }],
      warps: [{ x: 1, z: 3, header: 0, anchor: 0 }],
      backgrounds: [{ scriptId: 1, type: 0, x: 6, z: 3, y: 0, direction: 0 }],
      coordinateEvents: [{ scriptId: 1, x: 5, z: 2, width: 1, height: 1, y: 0, expectedValue: 0, variableId: 0 }],
    },
  } as unknown as OpeningMapPreview
}

function wanderingSafariMap(): OpeningMapPreview {
  const map = safariMap(), width = 96, height = 64
  const attributes = new Uint16Array(width * height).fill(0x8000)
  for (let row = 0; row < 2; row += 1) for (let column = 0; column < 3; column += 1) {
    for (let offset = 0; offset < 32; offset += 1) {
      attributes[(row * 32 + 4) * width + column * 32 + offset] = 0
      attributes[(row * 32 + 6) * width + column * 32 + offset] = 16
    }
  }
  return {
    ...map,
    terrain: { width, height, attributes },
    events: {
      objects: [{ id: 1, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 1,
        facingDirection: 0, xRange: 0, zRange: 0, x: 47, z: 36 }],
      warps: [{ x: 79, z: 38, header: 0, anchor: 0 }],
      backgrounds: [], coordinateEvents: [],
    },
  } as unknown as OpeningMapPreview
}

function encounterTable(): HgssWildEncounterData {
  const land = Array.from({ length: 12 }, (_, index) => ({ speciesId: 19 + index, level: 5 }))
  const water = Array.from({ length: 5 }, (_, index) => ({ speciesId: 129 + index, minLevel: 10, maxLevel: 10 }))
  return {
    bankId: 1,
    rates: { walking: 20, surfing: 10, rockSmash: 0, oldRod: 0, goodRod: 0, superRod: 0 },
    land: { morning: land, day: land, night: land },
    hoennSoundSpecies: [19, 20], sinnohSoundSpecies: [21, 22],
    surfing: water, rockSmash: water.slice(0, 2), oldRod: water, goodRod: water, superRod: water,
    swarm: { landSpeciesId: 19, surfingSpeciesId: 129, nightFishingSpeciesId: 129, fishingSpeciesId: 129 },
  }
}

describe('host du monde Pokemon dynamique NG+', () => {
  it('ne rend rien a chaque pas quand aucun runtime NG+ n est actif', () => {
    const renderActors = vi.fn()
    const host = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => undefined,
      readContext: () => safariContext(undefined),
      renderActors,
      startPreparedWildEncounter: () => false,
      startQuestWildEncounter: () => false,
    })

    expect(host.advanceMovement()).toEqual([])
    expect(renderActors).not.toHaveBeenCalled()
    expect(host.replacesStepEncounters()).toBe(false)
  })

  it('ne peuple ni ne remplace les rencontres Safari quand includeSafari est desactive', () => {
    const { runtime, visible } = runtimeWithVisible(false)
    const prepareSafariEncounter = vi.fn(() => preparedFor('land', 19))
    const renderActors = vi.fn()
    const host = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => runtime,
      readContext: () => safariContext(prepareSafariEncounter),
      renderActors,
      startPreparedWildEncounter: () => true,
      startQuestWildEncounter: () => false,
    })

    expect(host.syncCurrentMap()).toEqual([])
    expect(visible.registry.size()).toBe(0)
    expect(prepareSafariEncounter).not.toHaveBeenCalled()
    expect(host.replacesStepEncounters()).toBe(false)
  })

  it('demarre l identite Safari visible exacte, puis repeuple ou rend le fallback HGSS', () => {
    const { runtime, visible } = runtimeWithVisible(true)
    const prepareSafariEncounter = vi.fn<NonNullable<NewGamePlusDynamicPokemonWorldContext['prepareSafariEncounter']>>(({ method }) => (
      preparedFor(method, method === 'land' ? 19 : 129)
    ))
    const context = safariContext(prepareSafariEncounter)
    const startPreparedWildEncounter = vi.fn(() => true)
    const renderActors = vi.fn()
    const options: NewGamePlusDynamicPokemonWorldHostOptions = {
      readRuntime: () => runtime,
      readContext: () => context,
      renderActors,
      startPreparedWildEncounter,
      startQuestWildEncounter: () => false,
    }
    const host = createNewGamePlusDynamicPokemonWorldHost(options)

    const [firstActor] = host.syncCurrentMap()
    expect(firstActor?.kind).toBe('visible-wild')
    expect(prepareSafariEncounter.mock.calls.map(([entry]) => ({
      method: entry.method, worldTileX: entry.worldTileX, worldTileZ: entry.worldTileZ,
    }))).toEqual(expect.arrayContaining([
      { method: 'land', worldTileX: 32, worldTileZ: 32 },
      { method: 'surf', worldTileX: 33, worldTileZ: 32 },
    ]))
    expect(host.replacesStepEncounters()).toBe(true)

    const persisted = visible.snapshotState().actors[0]!
    expect(host.tryInteract(firstActor!.id)).toBe(true)
    expect(startPreparedWildEncounter).toHaveBeenCalledWith(expect.objectContaining({
      encounter: expect.objectContaining({
        method: 'safari', speciesId: persisted.speciesId, level: persisted.level,
      }),
    }), expect.objectContaining({ encounterMethod: 'safari' }))
    expect(visible.registry.get(firstActor!.id)).toBeUndefined()
    expect(host.replacesStepEncounters()).toBe(false)

    const repopulated = host.syncCurrentMap()
    expect(repopulated).toHaveLength(1)
    expect(repopulated[0]!.id).not.toBe(firstActor!.id)
    expect(host.replacesStepEncounters()).toBe(true)

    expect(host.tryInteract(repopulated[0]!.id)).toBe(true)
    expect(host.syncCurrentMap()).toEqual([])
    expect(host.replacesStepEncounters()).toBe(false)
    const pendingSave = JSON.parse(JSON.stringify(visible.snapshotState()))
    expect(pendingSave.populationCycles).toContainEqual(expect.objectContaining({
      mapId: 357, repopulationPending: true,
    }))

    const restored = runtimeWithVisible(true, pendingSave)
    const restoredHost = createNewGamePlusDynamicPokemonWorldHost({
      ...options,
      readRuntime: () => restored.runtime,
    })
    // `main.ts` appelle advanceMovement au pas suivant, avant de decider si
    // un check aleatoire HGSS doit etre arme.
    const [nextGeneration] = restoredHost.advanceMovement()
    expect(nextGeneration).toMatchObject({ kind: 'visible-wild' })
    expect(restored.visible.snapshotState().populationCycles).toContainEqual(expect.objectContaining({
      mapId: 357, generation: 1, repopulationPending: false,
    }))
  })

  it('conserve l acteur quand le starter refuse le combat', () => {
    const { runtime, visible } = runtimeWithVisible(true)
    const host = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => runtime,
      readContext: () => safariContext(({ method }) => preparedFor(method, 25)),
      renderActors: () => undefined,
      startPreparedWildEncounter: () => false,
      startQuestWildEncounter: () => false,
    })
    const [actor] = host.syncCurrentMap()
    expect(host.tryInteract(actor!.id)).toBe(false)
    expect(visible.registry.get(actor!.id)).toBeDefined()
    expect(host.replacesStepEncounters()).toBe(true)
  })

  it('resout une cle Safari restauree sans relancer le peuplement', () => {
    const initial = runtimeWithVisible(true)
    const populationHost = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => initial.runtime,
      readContext: () => safariContext(({ method }) => preparedFor(method, method === 'land' ? 19 : 129)),
      renderActors: () => undefined,
      startPreparedWildEncounter: () => false,
      startQuestWildEncounter: () => false,
    })
    const [actor] = populationHost.syncCurrentMap()
    const snapshot = JSON.parse(JSON.stringify(initial.visible.snapshotState()))
    const restored = runtimeWithVisible(true, snapshot)
    const startPreparedWildEncounter = vi.fn(() => true)
    const restoredHost = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => restored.runtime,
      readContext: () => safariContext(undefined),
      renderActors: () => undefined,
      startPreparedWildEncounter,
      startQuestWildEncounter: () => false,
    })

    expect(restoredHost.tryInteract(actor!.id)).toBe(true)
    expect(startPreparedWildEncounter).toHaveBeenCalledWith(
      expect.objectContaining({ encounter: expect.objectContaining({ method: 'safari' }) }),
      expect.objectContaining({ actorId: actor!.id, encounterMethod: 'safari' }),
    )
  })

  it('garde terre et Surf sur leur surface, dans la carte et hors evenements pendant 1 000 ticks', () => {
    const { runtime, visible } = runtimeWithVisible(false, undefined, 'wander', 2)
    const map = normalMap()
    let restrictSpawn = true
    const dynamicNpc = { tileX: 3, tileZ: 2 }
    const isTileBlocked = vi.fn((_mapId: number, tileX: number, tileZ: number) => (
      restrictSpawn
        ? !((tileX === 1 && tileZ === 1) || (tileX === 6 && tileZ === 1))
        : tileX === dynamicNpc.tileX && tileZ === dynamicNpc.tileZ
    ))
    const context: NewGamePlusDynamicPokemonWorldContext = {
      map,
      encounterCatalog: Object.assign([] as HgssWildEncounterData[], { 1: encounterTable() }),
      hour: 12,
      radioEffect: 'none',
      massOutbreak: { active: false, randomValue: 0 },
      isSafari: false,
      isTileBlocked,
    }
    const host = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => runtime,
      readContext: () => context,
      renderActors: () => undefined,
      startPreparedWildEncounter: () => false,
      startQuestWildEncounter: () => false,
    })

    const spawned = host.syncCurrentMap()
    expect(spawned).toHaveLength(2)
    expect(new Set(spawned.map((actor) => visible.getInteraction(actor.id)?.encounterMethod)))
      .toEqual(new Set(['land', 'surfing']))
    const initialPositions = new Map(spawned.map((actor) => [actor.id, `${actor.tileX}:${actor.tileZ}`]))
    restrictSpawn = false
    const forbidden = new Set(['2:2', '1:3', '6:3', '5:2', `${dynamicNpc.tileX}:${dynamicNpc.tileZ}`])
    let moved = false

    for (let tick = 0; tick < 1_000; tick += 1) {
      for (const actor of host.advanceMovement()) {
        const interaction = visible.getInteraction(actor.id)
        const attribute = map.terrain!.attributes[actor.tileZ * map.terrain!.width + actor.tileX]
        expect(actor.tileX).toBeGreaterThanOrEqual(0)
        expect(actor.tileX).toBeLessThan(map.terrain!.width)
        expect(actor.tileZ).toBeGreaterThanOrEqual(0)
        expect(actor.tileZ).toBeLessThan(map.terrain!.height)
        expect(forbidden.has(`${actor.tileX}:${actor.tileZ}`)).toBe(false)
        expect(interaction?.encounterMethod === 'surfing' ? attribute === 16 : attribute === 0).toBe(true)
        if (`${actor.tileX}:${actor.tileZ}` !== initialPositions.get(actor.id)) moved = true
      }
    }
    expect(moved).toBe(true)
    expect(isTileBlocked).toHaveBeenCalledWith(9, expect.any(Number), expect.any(Number), expect.stringMatching(/^ngp-visible-wild:/))
  })

  it('maintient chaque Pokemon Safari dans son areaSlot et sur sa surface pendant 1 000 ticks', () => {
    const { runtime, visible } = runtimeWithVisible(true, undefined, 'wander', 6)
    const map = wanderingSafariMap()
    const spawnAnchors = new Set<string>()
    for (let areaSlot = 0; areaSlot < 6; areaSlot += 1) {
      const baseX = (areaSlot % 3) * 32, baseZ = Math.floor(areaSlot / 3) * 32
      spawnAnchors.add(`${baseX + 31}:${baseZ + 4}`)
      spawnAnchors.add(`${baseX + 31}:${baseZ + 6}`)
    }
    let restrictSpawn = true
    const context: NewGamePlusDynamicPokemonWorldContext = {
      map, encounterCatalog: [], hour: 12, radioEffect: 'none',
      massOutbreak: { active: false, randomValue: 0 }, isSafari: true,
      prepareSafariEncounter: ({ method, worldTileX, worldTileZ, hour, rng }) => {
        const column = Math.floor(worldTileX / 32) - 1
        const row = Math.floor(worldTileZ / 32) - 1
        const areaSlot = row * 3 + column
        return {
          method: 'safari', safariMethod: method, time: hour < 10 ? 'morning' : hour < 20 ? 'day' : 'night',
          areaId: areaSlot as never, areaSlot: areaSlot as never, slotIndex: rng.nextU16() % 10,
          speciesId: (method === 'land' ? 20 : 120) + areaSlot, level: 15,
        }
      },
      isTileBlocked: (_mapId, tileX, tileZ) => restrictSpawn
        ? !spawnAnchors.has(`${tileX}:${tileZ}`)
        : tileX === 10 && tileZ === 4,
    }
    const host = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => runtime, readContext: () => context, renderActors: () => undefined,
      startPreparedWildEncounter: () => false, startQuestWildEncounter: () => false,
    })

    const spawned = host.syncCurrentMap()
    expect(spawned).toHaveLength(6)
    restrictSpawn = false
    let moved = false
    const initialPositions = new Map(spawned.map((actor) => [actor.id, `${actor.tileX}:${actor.tileZ}`]))
    for (let tick = 0; tick < 1_000; tick += 1) for (const actor of host.advanceMovement()) {
      const interaction = visible.getInteraction(actor.id)!
      const encounter = resolveHgssVisibleSafariEncounterCandidate(
        { seed: visible.config.seed, map }, interaction.encounterKey,
      )!.prepared.encounter
      if (encounter.method !== 'safari') throw new Error('Rencontre Safari attendue.')
      const areaSlot = Math.floor(actor.tileZ / 32) * 3 + Math.floor(actor.tileX / 32)
      const attribute = map.terrain!.attributes[actor.tileZ * map.terrain!.width + actor.tileX]
      expect(areaSlot).toBe(encounter.areaSlot)
      expect(encounter.safariMethod === 'surf' ? attribute === 16 : attribute === 0).toBe(true)
      expect(['15:4', '47:6', '10:4'].includes(`${actor.tileX}:${actor.tileZ}`)).toBe(false)
      if (`${actor.tileX}:${actor.tileZ}` !== initialPositions.get(actor.id)) moved = true
    }
    expect(moved).toBe(true)
  })
})
