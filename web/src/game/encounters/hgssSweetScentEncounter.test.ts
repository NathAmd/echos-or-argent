import { describe, expect, it } from 'vitest'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { HGSS_PAL_PARK_SYSTEM_FLAG, canSelectHgssSweetScentFieldMove, checkHgssSweetScentEncounter, prepareHgssSweetScentEncounter } from './hgssSweetScentEncounter'

function encounters(walking = 20, surfing = 10): HgssWildEncounterData {
  const land = Array.from({ length: 12 }, (_, index) => ({ speciesId: 10 + index, level: 5 + index }))
  return {
    bankId: 1, rates: { walking, surfing, rockSmash: 0, oldRod: 0, goodRod: 0, superRod: 0 },
    land: { morning: land, day: land, night: land }, hoennSoundSpecies: [0, 0], sinnohSoundSpecies: [0, 0],
    surfing: Array.from({ length: 5 }, (_, index) => ({ speciesId: 60 + index, minLevel: 10, maxLevel: 12 })),
    rockSmash: [], oldRod: [], goodRod: [], superRod: [],
    swarm: { landSpeciesId: 0, surfingSpeciesId: 0, nightFishingSpeciesId: 0, fishingSpeciesId: 0 },
  }
}

describe('Doux Parfum et Miel HGSS', () => {
  it('interdit seulement la sélection de capacité en Union, Colisée et Parc des Amis actif', () => {
    expect(canSelectHgssSweetScentFieldMove(2, new Set())).toBe(false)
    expect(canSelectHgssSweetScentFieldMove(4, new Set())).toBe(false)
    expect(canSelectHgssSweetScentFieldMove(5, new Set())).toBe(false)
    expect(canSelectHgssSweetScentFieldMove(109, new Set([HGSS_PAL_PARK_SYSTEM_FLAG]))).toBe(false)
    expect(canSelectHgssSweetScentFieldMove(357, new Set())).toBe(true)
  })

  it.each([1, 5, 9])('refuse la météo native %i avant toute vérification de terrain', (weatherId) => {
    expect(checkHgssSweetScentEncounter({ mapId: 357, weatherId, terrainAttribute: 2, encounters: encounters(), eventFlags: new Set() })).toEqual({ kind: 'weather-blocked' })
  })

  it('exige une case et un taux de rencontre compatibles, y compris la porte des puzzles Alpha', () => {
    expect(checkHgssSweetScentEncounter({ mapId: 357, weatherId: 0, terrainAttribute: 0, encounters: encounters(), eventFlags: new Set() })).toEqual({ kind: 'unavailable' })
    expect(checkHgssSweetScentEncounter({ mapId: 357, weatherId: 0, terrainAttribute: 2, encounters: encounters(0), eventFlags: new Set() })).toEqual({ kind: 'unavailable' })
    expect(checkHgssSweetScentEncounter({ mapId: 315, weatherId: 0, terrainAttribute: 2, encounters: encounters(), eventFlags: new Set() })).toEqual({ kind: 'unavailable' })
    expect(checkHgssSweetScentEncounter({ mapId: 315, weatherId: 0, terrainAttribute: 2, encounters: encounters(), eventFlags: new Set([0x978]) })).toEqual({ kind: 'ready', method: 'land', encounterRate: 20 })
    expect(checkHgssSweetScentEncounter({ mapId: 357, weatherId: 0, terrainAttribute: 16, encounters: encounters(), eventFlags: new Set() })).toEqual({ kind: 'ready', method: 'surf', encounterRate: 10 })
  })

  it('route le contexte Safari sans jet de taux ni Repousse', () => {
    const table = encounters()
    const check = checkHgssSweetScentEncounter({ mapId: 357, weatherId: 0, terrainAttribute: 2, encounters: table, eventFlags: new Set() })
    if (check.kind !== 'ready') throw new Error('garde inattendue')
    let method: string | undefined
    const prepared = prepareHgssSweetScentEncounter(check, table, 12, createHgssLcrng(1), (value) => {
      method = value
      return { method: 'safari', safariMethod: value, speciesId: 74, level: 17, areaId: 0, areaSlot: 0, slotIndex: 0, time: 'day' }
    })
    expect(method).toBe('land')
    expect(prepared).toMatchObject({ encounter: { method: 'safari', safariMethod: 'land' }, rateRoll: { triggered: true, modifiedRate: 20 } })
  })
})
