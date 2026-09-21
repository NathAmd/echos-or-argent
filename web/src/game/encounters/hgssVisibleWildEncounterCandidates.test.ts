import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import {
  tryStartVisibleWildPokemonInteraction,
  type VisibleWildPokemonEncounterHost,
} from '../newGamePlus/modules/visibleWildPokemonHostAdapter'
import {
  createVisibleWildPokemonRuntime,
  type VisibleWildMapPreparation,
} from '../newGamePlus/modules/visibleWildPokemonRule'
import {
  createAllPokemonAccessibleEncounterPort,
  type AllPokemonAccessibilityPlan,
} from '../newGamePlus/modules/allPokemonAccessibilityPlanner'
import { createFieldWildEncounterIdentityPort } from './fieldWildEncounterIdentityPort'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  prepareHgssVisibleWildMapCandidates,
  resolveHgssVisibleWildEncounterCandidate,
  type HgssVisibleWildCandidateRequest,
} from './hgssVisibleWildEncounterCandidates'

function map(mapId = 9, encounterBankId = 1): Pick<OpeningMapPreview, 'id' | 'header'> {
  return {
    id: mapId,
    header: { mapId, wildEncounterBank: encounterBankId },
  } as Pick<OpeningMapPreview, 'id' | 'header'>
}

function slots(count: number, firstSpeciesId: number, minimumLevel: number) {
  return Array.from({ length: count }, (_, index) => ({
    speciesId: firstSpeciesId + index,
    minLevel: minimumLevel + index,
    maxLevel: minimumLevel + index + 2,
  }))
}

function landSlots(firstSpeciesId: number, level: number) {
  return Array.from({ length: 12 }, (_, index) => ({ speciesId: firstSpeciesId + index, level: level + index }))
}

function encounterTable(bankId = 1): HgssWildEncounterData {
  return {
    bankId,
    rates: { walking: 20, surfing: 10, rockSmash: 0, oldRod: 0, goodRod: 0, superRod: 0 },
    land: {
      morning: landSlots(10, 3),
      day: landSlots(100, 13),
      night: landSlots(200, 23),
    },
    hoennSoundSpecies: [250, 251],
    sinnohSoundSpecies: [252, 253],
    surfing: slots(5, 300, 30),
    rockSmash: slots(2, 320, 20),
    oldRod: slots(5, 330, 5),
    goodRod: slots(5, 340, 10),
    superRod: slots(5, 350, 20),
    swarm: {
      landSpeciesId: 400,
      surfingSpeciesId: 401,
      nightFishingSpeciesId: 402,
      fishingSpeciesId: 403,
    },
  }
}

function catalog(table = encounterTable()): HgssWildEncounterData[] {
  const result = [] as HgssWildEncounterData[]
  result[table.bankId] = table
  return result
}

const safeTiles = Object.freeze([
  Object.freeze({ tileX: 14, tileZ: 8 }),
  Object.freeze({ tileX: 9, tileZ: 4 }),
  Object.freeze({ tileX: 3, tileZ: 17 }),
  Object.freeze({ tileX: 22, tileZ: 11 }),
])

function request(overrides: Partial<HgssVisibleWildCandidateRequest> = {}): HgssVisibleWildCandidateRequest {
  return {
    seed: 'visible-candidate-tests',
    map: map(),
    encounterCatalog: catalog(),
    method: 'land',
    hour: 12,
    candidateCount: 3,
    resolveSafeSpawnTiles: () => safeTiles,
    ...overrides,
  }
}

describe('candidats de rencontres sauvages visibles HGSS', () => {
  it('prépare plusieurs rencontres stables sans avancer le RNG normal', () => {
    const gameplayRng = createHgssLcrng(0x1234_5678)
    const gameplaySeed = gameplayRng.getSeed()
    const tileResolver = vi.fn(() => [...safeTiles].reverse())
    const first = prepareHgssVisibleWildMapCandidates(request({ resolveSafeSpawnTiles: tileResolver }))
    const second = prepareHgssVisibleWildMapCandidates(request({ resolveSafeSpawnTiles: () => safeTiles }))

    expect(gameplayRng.getSeed()).toBe(gameplaySeed)
    expect(first.encounters).toEqual(second.encounters)
    expect(first.spawnTiles).toEqual(second.spawnTiles)
    expect(first.encounters).toHaveLength(3)
    expect(first.prepareEncounters()).toBe(first.encounters)
    const directSyncPreparation: VisibleWildMapPreparation = first
    const directHostResolver: Pick<VisibleWildPokemonEncounterHost, 'resolvePreparedEncounter'> = {
      resolvePreparedEncounter: first.resolvePreparedEncounter,
    }
    expect(directSyncPreparation.prepareEncounters()).toBe(first.encounters)
    expect(directHostResolver.resolvePreparedEncounter({ encounterKey: first.encounters[0]!.encounterKey } as never))
      .toEqual(first.encounters[0]!.prepared)
    expect(new Set(first.encounters.map(({ encounterKey }) => encounterKey)).size).toBe(3)
    expect(first.encounters.every(({ prepared }) => (
      prepared.encounter.method === 'land'
      && prepared.encounter.time === 'day'
      && prepared.rateRoll.triggered
      && prepared.rateRoll.modifiedRate === 20
    ))).toBe(true)
    expect(tileResolver).toHaveBeenCalledWith({ mapId: 9, encounterBankId: 1, method: 'land' })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.encounters[0]?.prepared.encounter)).toBe(true)
  })

  it('dérive chaque slot indépendamment et conserve le préfixe quand le nombre varie', () => {
    const two = prepareHgssVisibleWildMapCandidates(request({ candidateCount: 2 }))
    const four = prepareHgssVisibleWildMapCandidates(request({ candidateCount: 4 }))

    expect(four.encounters.slice(0, 2)).toEqual(two.encounters)
    expect(four.encounters).toHaveLength(4)
    expect(four.encounters.map(({ encounterKey }) => encounterKey)).toEqual([
      expect.stringMatching(/:0$/),
      expect.stringMatching(/:1$/),
      expect.stringMatching(/:2$/),
      expect.stringMatching(/:3$/),
    ])
  })

  it('respecte les tables matin/jour/nuit et ne fait pas varier Surf avec l’heure', () => {
    const morning = prepareHgssVisibleWildMapCandidates(request({ hour: 7 }))
    const night = prepareHgssVisibleWildMapCandidates(request({ hour: 22 }))
    const surfMorning = prepareHgssVisibleWildMapCandidates(request({ method: 'surfing', hour: 7 }))
    const surfNight = prepareHgssVisibleWildMapCandidates(request({ method: 'surfing', hour: 22 }))

    expect(morning.time).toBe('morning')
    expect(night.time).toBe('night')
    expect(morning.encounters.every(({ prepared }) => prepared.encounter.speciesId < 100)).toBe(true)
    expect(night.encounters.every(({ prepared }) => prepared.encounter.speciesId >= 200)).toBe(true)
    expect(surfMorning.time).toBeUndefined()
    expect(surfMorning.encounters).toEqual(surfNight.encounters)
    expect(surfMorning.encounters.every(({ prepared }) => (
      prepared.encounter.method === 'surfing'
      && prepared.encounter.speciesId >= 300
      && prepared.encounter.speciesId <= 304
    ))).toBe(true)
  })

  it('reconstruit une ancienne clé horaire et refuse une autre carte ou un autre seed', () => {
    const morning = prepareHgssVisibleWildMapCandidates(request({ hour: 7, candidateCount: 1 }))
    const key = morning.encounters[0]!.encounterKey
    const night = prepareHgssVisibleWildMapCandidates(request({ hour: 22, candidateCount: 1 }))

    expect(night.resolvePreparedEncounter(key)).toEqual(morning.encounters[0]!.prepared)
    expect(night.resolvePreparedEncounter({ encounterKey: key })).toEqual(morning.encounters[0]!.prepared)
    expect(resolveHgssVisibleWildEncounterCandidate(request(), key)?.prepared)
      .toEqual(morning.encounters[0]!.prepared)
    expect(resolveHgssVisibleWildEncounterCandidate({ ...request(), seed: 'changed-seed' }, key)).toBeUndefined()
    expect(resolveHgssVisibleWildEncounterCandidate({ ...request(), map: map(10) }, key)).toBeUndefined()
    expect(resolveHgssVisibleWildEncounterCandidate(request(), 'not-a-visible-key')).toBeUndefined()
    const legacyKey = key.replace('hgss-vw2:', 'hgss-vw1:')
    const legacy = resolveHgssVisibleWildEncounterCandidate(request(), legacyKey)
    expect(legacy).toBeDefined()
    expect(resolveHgssVisibleWildEncounterCandidate(request(), legacyKey)).toEqual(legacy)
  })

  it('se branche directement sur le runtime visible et son adaptateur de combat', () => {
    const preparation = prepareHgssVisibleWildMapCandidates(request({ candidateCount: 1 }))
    const runtime = createVisibleWildPokemonRuntime({
      seed: 'visible-runtime-bridge',
      actorsPerMap: 1,
      includeSafari: false,
      movement: 'stationary',
    })
    const [actor] = runtime.syncMap(preparation)
    const startPreparedEncounter = vi.fn(() => true)

    expect(actor).toMatchObject({
      speciesId: preparation.encounters[0]!.prepared.encounter.speciesId,
      level: preparation.encounters[0]!.prepared.encounter.level,
    })
    expect(tryStartVisibleWildPokemonInteraction(runtime, actor!.id, {
      resolvePreparedEncounter: preparation.resolvePreparedEncounter,
      startPreparedEncounter,
    })).toBe(true)
    expect(startPreparedEncounter).toHaveBeenCalledWith(
      preparation.encounters[0]!.prepared,
      expect.objectContaining({ encounterKey: preparation.encounters[0]!.encounterKey }),
    )
  })

  it('applique les variantes HGSS disponibles et le port d’identité visible', () => {
    const identityPort = createFieldWildEncounterIdentityPort((identity, context) => {
      expect(context).toEqual({ mapId: 9, source: 'visible-world' })
      return { ...identity, speciesId: identity.speciesId + 1 }
    })
    const native = prepareHgssVisibleWildMapCandidates(request({
      candidateCount: 4,
      generationContext: { radioEffect: 'hoenn', massOutbreak: { active: true, randomValue: 0 } },
    }))
    const transformed = prepareHgssVisibleWildMapCandidates(request({
      candidateCount: 4,
      generationContext: { radioEffect: 'hoenn', massOutbreak: { active: true, randomValue: 0 } },
      fieldWildEncounterIdentityPort: identityPort,
    }))

    expect(native.encounters.some(({ prepared }) => (
      [250, 251, 400].includes(prepared.encounter.speciesId)
    ))).toBe(true)
    expect(transformed.encounters.map(({ prepared }) => prepared.encounter.speciesId)).toEqual(
      native.encounters.map(({ prepared }) => prepared.encounter.speciesId + 1),
    )
    expect(transformed.encounters.map(({ encounterKey }) => encounterKey))
      .toEqual(native.encounters.map(({ encounterKey }) => encounterKey))
    expect(transformed.resolvePreparedEncounter(transformed.encounters[0]!.encounterKey))
      .toEqual(transformed.encounters[0]!.prepared)
  })

  it('couvre exactement les 100 rolls natifs, y compris les slots rares transformes', () => {
    const fieldWildEncounterIdentityPort = (prepared: Parameters<NonNullable<HgssVisibleWildCandidateRequest['fieldWildEncounterIdentityPort']>>[0]) => ({
      ...prepared,
      encounter: { ...prepared.encounter, speciesId: 300 + prepared.encounter.slotIndex },
    }) as typeof prepared
    const land = prepareHgssVisibleWildMapCandidates(request({
      candidateCount: 100,
      resolveSafeSpawnTiles: () => [{ tileX: 1, tileZ: 1 }],
      fieldWildEncounterIdentityPort,
    }))
    const surf = prepareHgssVisibleWildMapCandidates(request({
      method: 'surfing',
      candidateCount: 100,
      resolveSafeSpawnTiles: () => [{ tileX: 2, tileZ: 2 }],
      fieldWildEncounterIdentityPort,
    }))
    const countSlots = (entries: typeof land.encounters) => entries.reduce((counts, { prepared }) => {
      counts[prepared.encounter.slotIndex] = (counts[prepared.encounter.slotIndex] ?? 0) + 1
      return counts
    }, {} as Record<number, number>)

    expect(countSlots(land.encounters)).toEqual({ 0: 20, 1: 20, 2: 10, 3: 10, 4: 10, 5: 10, 6: 5, 7: 5, 8: 4, 9: 4, 10: 1, 11: 1 })
    expect(countSlots(surf.encounters)).toEqual({ 0: 60, 1: 30, 2: 5, 3: 4, 4: 1 })
    expect(land.encounters.some(({ prepared }) => prepared.encounter.speciesId === 311)).toBe(true)
    expect(surf.encounters.some(({ prepared }) => prepared.encounter.speciesId === 304)).toBe(true)

    const runtime = createVisibleWildPokemonRuntime({
      seed: 'exhaustive-visible-rotation', actorsPerMap: 1, includeSafari: false, movement: 'stationary',
    })
    let actors = runtime.syncMap(land)
    const encounteredKeys = new Set<string>(), encounteredSpecies = new Set<number>()
    for (let index = 0; index < 100; index += 1) {
      const actor = actors[0]!
      encounteredKeys.add(runtime.getInteraction(actor.id)!.encounterKey)
      encounteredSpecies.add(actor.speciesId)
      runtime.commitEncounterStarted(actor.id)
      actors = runtime.syncMap(land)
    }
    expect(encounteredKeys.size).toBe(100)
    expect(encounteredSpecies.has(311)).toBe(true)
    expect(actors).toEqual([])
    expect(runtime.hasPendingRepopulation(9)).toBe(true)
  })

  it('rend visible un placement rare du plan Tous-les-Pokemon sans coupler les runtimes', () => {
    const rareSpeciesId = 493
    const plan = {
      revision: 1,
      nativeSpeciesIds: [],
      ordinaryPlacements: [{
        speciesId: rareSpeciesId,
        mapId: 9,
        mapSectionId: 1,
        encounterBankId: 1,
        method: 'land',
        variant: 'day',
        slotIndex: 11,
        replacedSpeciesId: 111,
        minimumLevel: 24,
        maximumLevel: 24,
        habitat: 'open-land',
      }],
      quests: [],
      coveredSpeciesIds: [],
    } as const satisfies AllPokemonAccessibilityPlan
    const preparation = prepareHgssVisibleWildMapCandidates(request({
      candidateCount: 100,
      resolveSafeSpawnTiles: () => [{ tileX: 1, tileZ: 1 }],
      fieldWildEncounterIdentityPort: createAllPokemonAccessibleEncounterPort(plan),
    }))

    expect(preparation.encounters.filter(({ prepared }) => prepared.encounter.slotIndex === 11))
      .toEqual([expect.objectContaining({
        prepared: expect.objectContaining({
          encounter: expect.objectContaining({ speciesId: rareSpeciesId, method: 'land', time: 'day' }),
        }),
      })])
  })

  it('ne fabrique aucune case et borne les rencontres aux cases sûres fournies', () => {
    const oneTile = prepareHgssVisibleWildMapCandidates(request({
      candidateCount: 8,
      resolveSafeSpawnTiles: () => [{ tileX: -3, tileZ: 4 }],
    }))
    expect(oneTile.spawnTiles).toEqual([{ tileX: -3, tileZ: 4 }])
    expect(oneTile.encounters).toHaveLength(8)

    const noEncounterMapCallback = vi.fn(() => safeTiles)
    const noEncounterMap = prepareHgssVisibleWildMapCandidates(request({
      map: map(9, 0xff),
      resolveSafeSpawnTiles: noEncounterMapCallback,
    }))
    expect(noEncounterMap.spawnTiles).toEqual([])
    expect(noEncounterMap.encounters).toEqual([])
    expect(noEncounterMapCallback).not.toHaveBeenCalled()

    const noSurfTable = encounterTable()
    noSurfTable.rates.surfing = 0
    const noSurfCallback = vi.fn(() => safeTiles)
    const noSurf = prepareHgssVisibleWildMapCandidates(request({
      encounterCatalog: catalog(noSurfTable),
      method: 'surfing',
      resolveSafeSpawnTiles: noSurfCallback,
    }))
    expect(noSurf.encounters).toEqual([])
    expect(noSurfCallback).not.toHaveBeenCalled()
  })

  it('rejette les sources et callbacks incohérents avant de publier un résultat', () => {
    expect(() => prepareHgssVisibleWildMapCandidates(request({ seed: ' bad' }))).toThrow(/seed/)
    expect(() => prepareHgssVisibleWildMapCandidates(request({ hour: 24 }))).toThrow(/heure/)
    expect(() => prepareHgssVisibleWildMapCandidates(request({ candidateCount: 101 }))).toThrow(/nombre/)
    expect(() => prepareHgssVisibleWildMapCandidates(request({ map: map(9, 2) }))).toThrow(/table sauvage 2/i)
    expect(() => prepareHgssVisibleWildMapCandidates(request({
      resolveSafeSpawnTiles: () => [{ tileX: 1, tileZ: 2 }, { tileX: 1, tileZ: 2 }],
    }))).toThrow(/plusieurs fois/)
    expect(() => prepareHgssVisibleWildMapCandidates(request({
      resolveSafeSpawnTiles: () => [{ tileX: Number.NaN, tileZ: 2 }],
    }))).toThrow(/coordonnée X/)
    expect(() => prepareHgssVisibleWildMapCandidates(request({
      resolveSafeSpawnTiles: () => [{ tileX: '2' as never, tileZ: 2 }],
    }))).toThrow(/coordonnée X/)
    expect(() => prepareHgssVisibleWildMapCandidates(request({
      map: { ...map(), header: { ...map().header, mapId: 8 } },
    }))).toThrow(/incohérent/)
  })
})
