import { describe, expect, it } from 'vitest'
import type {
  HgssSafariAreaEncounterData,
  HgssSafariEncounterCatalog,
  HgssSafariEncounterMethod,
  HgssSafariEncounterMethodData,
  HgssSafariEncounterTime,
} from '../../rom/safari/safariEncounterData'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  HGSS_SAFARI_WATER_FALLBACK_SPECIES_ID,
  createHgssSafariMorningEncounterSignature,
  generateHgssSafariFieldEncounter,
  prepareHgssSafariEncounter,
  resolveHgssSafariEncounterSlots,
  resolveHgssSafariEncounterTimeByHour,
} from './hgssSafariEncounters'
import { createHgssSafariAreaSet, createHgssSafariState, placeHgssSafariObject, type HgssSafariAreaId } from './hgssSafariState'

const times = ['morning', 'day', 'night'] as const satisfies readonly HgssSafariEncounterTime[]
const methods = ['land', 'surf', 'oldRod', 'goodRod', 'superRod'] as const satisfies readonly HgssSafariEncounterMethod[]

function methodData(areaId: number, methodIndex: number, bonusCount = 2): HgssSafariEncounterMethodData {
  const base = Object.fromEntries(times.map((time, timeIndex) => [
    time,
    Array.from({ length: 10 }, (_, slot) => ({ speciesId: areaId * 100 + methodIndex * 20 + timeIndex * 10 + slot + 1, level: 5 + slot })),
  ])) as HgssSafariEncounterMethodData['base']
  const bonus = Object.fromEntries(times.map((time, timeIndex) => [
    time,
    Array.from({ length: bonusCount }, (_, slot) => ({ speciesId: 400 + methodIndex * 20 + timeIndex * 2 + slot, level: 30 + slot })),
  ])) as HgssSafariEncounterMethodData['bonus']
  return {
    bonusCount,
    base,
    bonus,
    bonusConditions: Array.from({ length: bonusCount }, (_, index) => ({
      blockType1: 1,
      blockCount1: index + 1,
      blockType2: 0,
      blockCount2: 0,
    })),
  }
}

function catalog(surfBonusCount = 2): HgssSafariEncounterCatalog {
  return Array.from({ length: 12 }, (_, areaId): HgssSafariAreaEncounterData => ({
    areaId: areaId as HgssSafariAreaId,
    methods: Object.fromEntries(methods.map((method, methodIndex) => [
      method,
      methodData(areaId, methodIndex, method === 'surf' ? surfBonusCount : 2),
    ])) as HgssSafariAreaEncounterData['methods'],
  }))
}

function fixedRng(value: number): HgssLcrng {
  return { getSeed: () => 0, nextU16: () => value }
}

describe('rencontres du Parc Safari HGSS', () => {
  it('résout les trois tables temporelles avec les heures exactes HGSS', () => {
    expect(resolveHgssSafariEncounterTimeByHour(4)).toBe('morning')
    expect(resolveHgssSafariEncounterTimeByHour(12)).toBe('day')
    expect(resolveHgssSafariEncounterTimeByHour(23)).toBe('night')
  })

  it('remplace les premiers slots par les bonus satisfaits, dans leur ordre ROM', () => {
    let state = createHgssSafariState(0)
    state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: 1, y: 0, z: 1 })

    const slots = resolveHgssSafariEncounterSlots(catalog(), state.areaSets[0], 0, 'land', 'morning')
    expect(slots[0]).toEqual({ speciesId: 400, level: 30 })
    expect(slots[1]).toEqual({ speciesId: 2, level: 6 })
  })

  it('conserve le repli Rattata/Magicarpe niveau 5 quand les données aquatiques sont absentes', () => {
    const areaSet = createHgssSafariAreaSet([0, 1, 2, 3, 4, 5])
    expect(resolveHgssSafariEncounterSlots(catalog(0), areaSet, 0, 'land', 'day')[0]!.speciesId).toBe(11)
    for (const method of ['surf', 'oldRod', 'goodRod', 'superRod'] as const) {
      expect(resolveHgssSafariEncounterSlots(catalog(0), areaSet, 0, method, 'night')).toEqual(
        Array.from({ length: 10 }, () => ({ speciesId: HGSS_SAFARI_WATER_FALLBACK_SPECIES_ID, level: 5 })),
      )
    }
  })

  it('sélectionne uniformément un des dix slots après remplacement', () => {
    const areaSet = createHgssSafariAreaSet([0, 1, 2, 3, 4, 5])
    const encounter = prepareHgssSafariEncounter(catalog(), areaSet, 0, 'land', 'morning', fixedRng(27))
    expect(encounter).toMatchObject({ areaId: 0, areaSlot: 0, slotIndex: 7, speciesId: 8, level: 12 })
  })

  it('applique Magnépiège et Statik uniquement si une partie de la table correspond', () => {
    const encounterCatalog = catalog()
    const areaSet = createHgssSafariAreaSet([0, 1, 2, 3, 4, 5])
    const pokemonCatalog = createPokemonTestCatalog()
    for (let speciesId = 1; speciesId <= 10; speciesId += 1) {
      pokemonCatalog.personalData[speciesId]!.types = speciesId === 4 ? [8, 8] : [0, 0]
    }
    const magnetPull = generateHgssSafariFieldEncounter(encounterCatalog, areaSet, 0, 'land', 'morning', {
      pokemonCatalog,
      lead: { abilityId: 42, isEgg: false, level: 5 },
      rng: { getSeed: () => 0, nextU16: (() => {
        const values = [0, 0]
        return () => values.shift() ?? 0
      })() },
    })
    expect(magnetPull.encounter).toMatchObject({ speciesId: 4, slotIndex: 3 })
  })

  it('cherche le niveau maximal de la même espèce et applique les suppressions après le choix', () => {
    const encounterCatalog = catalog()
    encounterCatalog[0]!.methods.land.base.morning[1] = { speciesId: 1, level: 25 }
    const areaSet = createHgssSafariAreaSet([0, 1, 2, 3, 4, 5])
    const pokemonCatalog = createPokemonTestCatalog()
    const pressure = generateHgssSafariFieldEncounter(encounterCatalog, areaSet, 0, 'land', 'morning', {
      pokemonCatalog,
      lead: { abilityId: 46, isEgg: false, level: 5 },
      rng: { getSeed: () => 0, nextU16: (() => {
        const values = [0, 1]
        return () => values.shift() ?? 0
      })() },
    })
    expect(pressure.encounter).toMatchObject({ speciesId: 1, level: 25, slotIndex: 1 })

    const intimidated = generateHgssSafariFieldEncounter(encounterCatalog, areaSet, 0, 'land', 'morning', {
      pokemonCatalog,
      lead: { abilityId: 22, isEgg: false, level: 30 },
      rng: fixedRng(0),
    })
    expect(intimidated).toEqual({ suppressedBy: 'ability' })
    expect(generateHgssSafariFieldEncounter(encounterCatalog, areaSet, 0, 'land', 'morning', {
      pokemonCatalog,
      lead: { abilityId: 22, isEgg: false, level: 30 },
      isSweetScent: true,
      rng: fixedRng(0),
    }).encounter).toBeDefined()

    const repelled = generateHgssSafariFieldEncounter(encounterCatalog, areaSet, 0, 'land', 'morning', {
      pokemonCatalog,
      lead: { abilityId: 0, isEgg: false, level: 5 },
      repelLeadLevel: 15,
      rng: fixedRng(9),
    })
    expect(repelled).toEqual({ suppressedBy: 'repel' })
  })

  it('fait évoluer la signature seulement quand les tables réellement résolues changent', () => {
    const encounterCatalog = catalog()
    let state = createHgssSafariState(0)
    const before = createHgssSafariMorningEncounterSignature(encounterCatalog, state.areaSets[0], 0)
    state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: 1, y: 0, z: 1 })
    const after = createHgssSafariMorningEncounterSignature(encounterCatalog, state.areaSets[0], 0)
    expect(after).not.toBe(before)
  })
})
