import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createVisibleWildPokemonRuntime } from '../newGamePlus/modules/visibleWildPokemonRule'
import { tryStartVisibleWildPokemonInteraction } from '../newGamePlus/modules/visibleWildPokemonHostAdapter'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createFieldWildEncounterIdentityPort } from './fieldWildEncounterIdentityPort'
import {
  prepareHgssVisibleSafariMapCandidates,
  resolveHgssVisibleSafariEncounterCandidate,
  type HgssVisibleSafariCandidateRequest,
  type HgssVisibleSafariEncounterPreparer,
} from './hgssVisibleSafariEncounterCandidates'

function safariMap(): OpeningMapPreview {
  return {
    id: 357,
    header: { mapId: 357 },
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
  } as OpeningMapPreview
}

const landTiles = Object.freeze([
  Object.freeze({ tileX: 1, tileZ: 2 }),
  Object.freeze({ tileX: 34, tileZ: 3 }),
])
const surfTiles = Object.freeze([
  Object.freeze({ tileX: 4, tileZ: 5 }),
  Object.freeze({ tileX: 36, tileZ: 6 }),
])

function preparer(): HgssVisibleSafariEncounterPreparer {
  return ({ method, worldTileX, worldTileZ, hour, rng }) => {
    const areaSlot = Math.floor((worldTileX - 32) / 32)
    return {
      method: 'safari',
      safariMethod: method,
      time: hour < 10 ? 'morning' : hour < 20 ? 'day' : 'night',
      areaId: (areaSlot + 2) as never,
      areaSlot: areaSlot as never,
      slotIndex: rng.nextU16() % 10,
      speciesId: 20 + (rng.nextU16() % 20),
      level: 10 + ((worldTileX + worldTileZ) % 10),
    }
  }
}

function request(overrides: Partial<HgssVisibleSafariCandidateRequest> = {}): HgssVisibleSafariCandidateRequest {
  return {
    seed: 'safari-visible-tests',
    map: safariMap(),
    hour: 12,
    candidateCount: 4,
    prepareSafariEncounter: preparer(),
    resolveSafeSpawnTiles: (method) => method === 'land' ? landTiles : surfTiles,
    ...overrides,
  }
}

describe('candidats Safari visibles HGSS', () => {
  it('utilise des coordonnees monde et des RNG isoles sans avancer le gameplay', () => {
    const gameplayRng = createHgssLcrng(0x1234_5678)
    const gameplaySeed = gameplayRng.getSeed()
    const prepareSafariEncounter = vi.fn(preparer())

    const result = prepareHgssVisibleSafariMapCandidates(request({ prepareSafariEncounter }))

    expect(gameplayRng.getSeed()).toBe(gameplaySeed)
    expect(result.encounters).toHaveLength(4)
    expect(prepareSafariEncounter.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(prepareSafariEncounter.mock.calls.every(([entry]) => entry.rng !== gameplayRng)).toBe(true)
    expect(new Set(prepareSafariEncounter.mock.calls.map(([entry]) => `${entry.worldTileX}:${entry.worldTileZ}`)))
      .toEqual(new Set(['33:34', '66:35', '36:37', '68:38']))
    expect(prepareSafariEncounter.mock.calls.every(([entry]) => entry.isSweetScent === true)).toBe(true)
    expect(result.encounters.every(({ prepared }) => prepared.encounter.method === 'safari')).toBe(true)
  })

  it('couvre les dix slots de chaque methode avec une population visible bornee', () => {
    const preparation = prepareHgssVisibleSafariMapCandidates(request({
      candidateCount: 20,
      resolveSafeSpawnTiles: (method) => method === 'land' ? [landTiles[0]!] : [surfTiles[0]!],
      prepareSafariEncounter: ({ method, hour, rng }) => {
        const slotIndex = rng.nextU16() % 10
        return {
          method: 'safari',
          safariMethod: method,
          time: hour < 10 ? 'morning' : hour < 20 ? 'day' : 'night',
          areaId: 2,
          areaSlot: 0,
          slotIndex,
          speciesId: (method === 'land' ? 20 : 120) + slotIndex,
          level: 10 + slotIndex,
        }
      },
    }))

    expect(preparation.encounters).toHaveLength(20)
    expect(preparation.spawnTiles).toHaveLength(2)
    for (const method of ['land', 'surf'] as const) {
      expect(preparation.encounters.flatMap(({ prepared }) => (
        prepared.encounter.method === 'safari' && prepared.encounter.safariMethod === method
          ? [prepared.encounter.slotIndex]
          : []
      )).sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  })

  it('reste stable si le host change l ordre des cases et preserve chaque zone de spawn', () => {
    const first = prepareHgssVisibleSafariMapCandidates(request())
    const second = prepareHgssVisibleSafariMapCandidates(request({
      resolveSafeSpawnTiles: (method) => [...(method === 'land' ? landTiles : surfTiles)].reverse(),
    }))
    expect(second.encounters).toEqual(first.encounters)
    expect(second.spawnTiles).toEqual(first.spawnTiles)
    expect(second.time).toBe(first.time)

    const runtime = createVisibleWildPokemonRuntime({
      seed: 'runtime-safari-visible', actorsPerMap: 4, includeSafari: true, movement: 'stationary',
    })
    runtime.syncMap(first)
    const state = runtime.snapshotState()
    for (const actor of state.actors) {
      const candidate = first.encounters.find(({ encounterKey }) => encounterKey === actor.encounterKey)!
      expect({ tileX: actor.tileX, tileZ: actor.tileZ }).toEqual(candidate.spawnTile)
      expect(actor.speciesId).toBe(candidate.prepared.encounter.speciesId)
    }
  })

  it('reconstruit exactement une identite transformee apres reload sans rappeler le preparateur', () => {
    const prepareSafariEncounter = vi.fn(preparer())
    const preparation = prepareHgssVisibleSafariMapCandidates(request({
      candidateCount: 1,
      prepareSafariEncounter,
      fieldWildEncounterIdentityPort: createFieldWildEncounterIdentityPort((identity) => ({
        speciesId: identity.speciesId + 100,
        level: identity.level + 1,
      })),
    }))
    const candidate = preparation.encounters[0]!
    const callsAfterPopulation = prepareSafariEncounter.mock.calls.length
    const reconstructed = resolveHgssVisibleSafariEncounterCandidate(
      { seed: 'safari-visible-tests', map: safariMap() },
      candidate.encounterKey,
    )

    expect(reconstructed?.prepared).toEqual(candidate.prepared)
    expect(reconstructed?.prepared.encounter.speciesId).toBeGreaterThanOrEqual(120)
    expect(prepareSafariEncounter).toHaveBeenCalledTimes(callsAfterPopulation)
    const tampered = `${candidate.encounterKey.slice(0, -1)}${candidate.encounterKey.endsWith('0') ? '1' : '0'}`
    expect(resolveHgssVisibleSafariEncounterCandidate(request(), tampered)).toBeUndefined()
    expect(resolveHgssVisibleSafariEncounterCandidate({ ...request(), seed: 'other-seed' }, candidate.encounterKey)).toBeUndefined()
  })

  it('demarre transactionnellement la meme rencontre et respecte includeSafari', () => {
    const preparation = prepareHgssVisibleSafariMapCandidates(request({ candidateCount: 1 }))
    const enabled = createVisibleWildPokemonRuntime({
      seed: 'bridge-safari-visible', actorsPerMap: 1, includeSafari: true, movement: 'stationary',
    })
    const [actor] = enabled.syncMap(preparation)
    const startPreparedEncounter = vi.fn(() => true)
    expect(tryStartVisibleWildPokemonInteraction(enabled, actor!.id, {
      resolvePreparedEncounter: preparation.resolvePreparedEncounter,
      startPreparedEncounter,
    })).toBe(true)
    expect(startPreparedEncounter).toHaveBeenCalledWith(
      preparation.encounters[0]!.prepared,
      expect.objectContaining({ encounterMethod: 'safari' }),
    )
    expect(enabled.registry.get(actor!.id)).toBeUndefined()

    const disabled = createVisibleWildPokemonRuntime({
      seed: 'bridge-safari-visible', actorsPerMap: 1, includeSafari: false, movement: 'stationary',
    })
    expect(disabled.syncMap(preparation)).toEqual([])
  })

  it('ne consulte aucun callback quand aucun candidat n est demande', () => {
    const prepareSafariEncounter = vi.fn(preparer())
    const resolveSafeSpawnTiles = vi.fn(() => landTiles)
    const result = prepareHgssVisibleSafariMapCandidates(request({
      candidateCount: 0, prepareSafariEncounter, resolveSafeSpawnTiles,
    }))
    expect(result.encounters).toEqual([])
    expect(result.spawnTiles).toEqual([])
    expect(prepareSafariEncounter).not.toHaveBeenCalled()
    expect(resolveSafeSpawnTiles).not.toHaveBeenCalled()
  })
})
