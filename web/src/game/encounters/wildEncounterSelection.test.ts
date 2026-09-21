import { describe, expect, it } from 'vitest'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import { applyHgssFishingLeadAbilityRate, classifyWildEncounterTerrain, createHgssFieldEncounterSession, getHgssFollowerFishingReactionChance, getHgssLandEncounterTime, getHgssStepEncounterRateBoost, isVeryTallGrass, prepareHgssFishingWildEncounter, prepareHgssLandOrSurfWildEncounter, prepareHgssLandWildEncounter, prepareHgssSurfWildEncounter, resolveHgssFishingEncounterRate, rollHgssEncounterLevel, rollHgssLandEncounterSlot, rollHgssWildEncounterRate, selectHgssFishingEncounterSlot, selectHgssLandEncounterSlot, selectHgssSurfEncounterSlot } from './wildEncounterSelection'
import { applyHgssLandOrSurfEncounterRateModifiers } from './hgssEncounterRateModifiers'

function createSequenceRng(values: number[]): HgssLcrng {
  let cursor = 0
  return {
    getSeed: () => 0,
    nextU16: () => {
      const value = values[cursor]
      if (value === undefined) throw new Error('Tirage RNG inattendu.')
      cursor += 1
      return value
    },
  }
}

describe('HGSS wild encounter selection', () => {
  it('classifies native encounter terrain from the low attribute byte', () => {
    expect(classifyWildEncounterTerrain(0x8002)).toBe('land')
    expect(classifyWildEncounterTerrain(3)).toBe('land')
    expect(classifyWildEncounterTerrain(16)).toBe('surfing')
    expect(classifyWildEncounterTerrain(21)).toBe('surfing')
    expect(classifyWildEncounterTerrain(0x8021)).toBe('none')
    expect(classifyWildEncounterTerrain(undefined)).toBe('none')
    expect(isVeryTallGrass(0x8003)).toBe(true)
  })

  it('uses the native 12-slot land distribution boundaries', () => {
    expect([0, 19, 20, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 84, 85, 89, 90, 93, 94, 97, 98, 99].map(selectHgssLandEncounterSlot))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 11])
    expect(rollHgssLandEncounterSlot(createSequenceRng([0xffff]))).toBe(selectHgssLandEncounterSlot(0xffff % 100))
  })

  it('selects the native morning, day, and night land tables', () => {
    const slots = (base: number) => Array.from({ length: 12 }, (_, index) => ({ speciesId: base + index, level: index + 2 }))
    const encounters = {
      bankId: 3,
      land: { morning: slots(10), day: slots(30), night: slots(50) },
    } as unknown as HgssWildEncounterData
    expect([3, 4, 9, 10, 19, 20, 23].map(getHgssLandEncounterTime)).toEqual(['night', 'morning', 'morning', 'day', 'day', 'night', 'night'])
    expect(prepareHgssLandWildEncounter(encounters, 9, createSequenceRng([98]))).toEqual({
      bankId: 3,
      slotIndex: 10,
      method: 'land',
      time: 'morning',
      speciesId: 20,
      level: 12,
    })
    expect(prepareHgssLandWildEncounter(encounters, 21, createSequenceRng([99])).speciesId).toBe(61)
  })

  it('uses the native Surf distribution and inclusive ROM level ranges', () => {
    expect([0, 59, 60, 89, 90, 94, 95, 98, 99].map(selectHgssSurfEncounterSlot))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4])
    expect(rollHgssEncounterLevel({ speciesId: 60, minLevel: 12, maxLevel: 10 }, createSequenceRng([2]))).toBe(12)
    const encounters = {
      bankId: 4,
      surfing: Array.from({ length: 5 }, (_, index) => ({ speciesId: 60 + index, minLevel: 10 + index, maxLevel: 12 + index })),
    } as unknown as HgssWildEncounterData
    expect(prepareHgssSurfWildEncounter(encounters, createSequenceRng([99, 1]))).toEqual({
      bankId: 4,
      slotIndex: 4,
      method: 'surfing',
      speciesId: 64,
      minLevel: 14,
      maxLevel: 16,
      level: 15,
    })
  })

  it('shares ROM swarm/radio tables and lead-slot rules between step and forced encounters', () => {
    const land = Array.from({ length: 12 }, (_, index) => ({ speciesId: 100 + index, level: 5 + index }))
    land[5] = { speciesId: 100, level: 20 }
    const encounters = {
      bankId: 4,
      land: { morning: land, day: land, night: land },
      hoennSoundSpecies: [200, 201], sinnohSoundSpecies: [202, 203],
      surfing: Array.from({ length: 5 }, (_, index) => ({ speciesId: 300 + index, minLevel: 10, maxLevel: 15 })),
      swarm: { landSpeciesId: 210, surfingSpeciesId: 211, nightFishingSpeciesId: 0, fishingSpeciesId: 0 },
    } as unknown as HgssWildEncounterData
    const base = { mapId: 9, massOutbreak: { active: true, randomValue: 0 } }
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'land', 12, createSequenceRng([0]), base))
      .toMatchObject({ slotIndex: 0, speciesId: 210 })
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'land', 12, createSequenceRng([40]), { ...base, radioEffect: 'hoenn' }))
      .toMatchObject({ slotIndex: 2, speciesId: 200 })
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'surf', 12, createSequenceRng([0, 0]), {
      ...base, mapId: 91, massOutbreak: { active: true, randomValue: 5 },
    })).toMatchObject({ slotIndex: 0, speciesId: 211 })

    const types = (speciesId: number): readonly number[] => speciesId === 106 || speciesId === 108 ? [8] : [0]
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'land', 12, createSequenceRng([0, 1]), {
      mapId: 1, lead: { abilityId: 42, isEgg: false, level: 10 }, resolveSpeciesTypes: types,
    })).toMatchObject({ slotIndex: 8, speciesId: 108 })
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'land', 12, createSequenceRng([0, 1]), {
      mapId: 1, lead: { abilityId: 46, isEgg: false, level: 10 },
    })).toMatchObject({ slotIndex: 5, speciesId: 100, level: 20 })
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'surf', 12, createSequenceRng([0, 2, 1]), {
      mapId: 1, lead: { abilityId: 72, isEgg: false, level: 10 },
    })).toMatchObject({ slotIndex: 0, level: 15 })
  })

  it('suppresses only non-forced low-level encounters with Intimidate or Keen Eye', () => {
    const land = Array.from({ length: 12 }, () => ({ speciesId: 152, level: 5 }))
    const encounters = { bankId: 0, land: { morning: land, day: land, night: land } } as HgssWildEncounterData
    const lead = { abilityId: 22, isEgg: false, level: 20 }
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'land', 12, createSequenceRng([0, 0]), { mapId: 1, lead })).toBeUndefined()
    expect(prepareHgssLandOrSurfWildEncounter(encounters, 'land', 12, createSequenceRng([0]), { mapId: 1, lead, isSweetScent: true }))
      .toMatchObject({ speciesId: 152, level: 5 })
  })

  it('uses the native fishing bite, slot, friendship, and night replacement rules', () => {
    expect([0, 39, 40, 69, 70, 84, 85, 94, 95, 99].map(selectHgssFishingEncounterSlot))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
    expect([0, 99, 100, 149, 150, 199, 200, 249, 250, 255].map(getHgssFollowerFishingReactionChance))
      .toEqual([0, 0, 20, 20, 30, 30, 40, 40, 50, 50])
    expect(applyHgssFishingLeadAbilityRate(40, { abilityId: 21, isEgg: false, level: 10 })).toBe(80)
    expect(applyHgssFishingLeadAbilityRate(60, { abilityId: 60, isEgg: false, level: 10 })).toBe(100)
    expect(applyHgssFishingLeadAbilityRate(40, { abilityId: 21, isEgg: true, level: 1 })).toBe(40)
    expect(resolveHgssFishingEncounterRate(70, 200, { abilityId: 0, isEgg: false, level: 10 })).toBe(100)
    expect(resolveHgssFishingEncounterRate(70, 200, { abilityId: 0, isEgg: true, level: 1 })).toBe(110)
    expect(resolveHgssFishingEncounterRate(40, 100, { abilityId: 21, isEgg: false, level: 10 })).toBe(100)
    expect(resolveHgssFishingEncounterRate(250, 100, { abilityId: 0, isEgg: true, level: 1 })).toBe(14)
    const slots = Array.from({ length: 5 }, (_, index) => ({ speciesId: 60 + index, minLevel: 10, maxLevel: 10 }))
    const encounters = {
      bankId: 4,
      rates: { walking: 0, surfing: 0, rockSmash: 0, oldRod: 10, goodRod: 10, superRod: 10 },
      oldRod: slots, goodRod: slots, superRod: slots,
      swarm: { landSpeciesId: 0, surfingSpeciesId: 0, nightFishingSpeciesId: 170, fishingSpeciesId: 171 },
    } as HgssWildEncounterData
    expect(prepareHgssFishingWildEncounter(encounters, 'goodRod', 22, createSequenceRng([0, 85, 0]))).toMatchObject({
      rateRoll: { triggered: true, modifiedRate: 10, firstRoll: 0 },
      encounter: { method: 'fishing', rod: 'goodRod', slotIndex: 3, speciesId: 170, level: 10 },
    })
    expect(prepareHgssFishingWildEncounter(encounters, 'oldRod', 12, createSequenceRng([25]))).toBeUndefined()
    expect(prepareHgssFishingWildEncounter(encounters, 'oldRod', 12, createSequenceRng([15, 70, 0]), false, undefined, { abilityId: 21, isEgg: false, level: 10 })).toMatchObject({
      encounter: { slotIndex: 2, speciesId: 62 },
    })
    expect(prepareHgssFishingWildEncounter(encounters, 'oldRod', 12, createSequenceRng([25, 70, 0]), false, undefined, { abilityId: 0, isEgg: false, level: 10 }, 100)).toMatchObject({
      rateRoll: { triggered: true, modifiedRate: 30, firstRoll: 25 },
      encounter: { slotIndex: 2, speciesId: 62 },
    })
    expect(prepareHgssFishingWildEncounter(encounters, 'superRod', 12, createSequenceRng([0]), false, (rod) => ({
      method: 'safari', safariMethod: rod, speciesId: 129, level: 15, areaId: 0, areaSlot: 0, slotIndex: 7, time: 'day',
    }))).toMatchObject({
      rateRoll: { triggered: true, firstRoll: 0 },
      encounter: { method: 'safari', safariMethod: 'superRod', speciesId: 129, slotIndex: 7 },
    })

    const types = (speciesId: number): readonly number[] => speciesId === 62 || speciesId === 64 ? [8, 0] : [0, 0]
    expect(prepareHgssFishingWildEncounter(encounters, 'oldRod', 12, createSequenceRng([0, 0, 1, 0]), false, undefined,
      { abilityId: 42, isEgg: false, level: 10 }, undefined, types)).toMatchObject({
      encounter: { slotIndex: 4, speciesId: 64, level: 10 },
    })
    expect(prepareHgssFishingWildEncounter(encounters, 'oldRod', 12, createSequenceRng([0, 1, 70, 0]), false, undefined,
      { abilityId: 42, isEgg: false, level: 10 }, undefined, types)).toMatchObject({
      encounter: { slotIndex: 2, speciesId: 62 },
    })

    const rangedSlots = Array.from({ length: 5 }, (_, index) => ({ speciesId: 70 + index, minLevel: 10, maxLevel: 15 }))
    const ranged = { ...encounters, oldRod: rangedSlots } as HgssWildEncounterData
    expect(prepareHgssFishingWildEncounter(ranged, 'oldRod', 12, createSequenceRng([0, 0, 0, 1]), false, undefined,
      { abilityId: 46, isEgg: false, level: 10 })).toMatchObject({ encounter: { level: 15 } })
    expect(prepareHgssFishingWildEncounter(ranged, 'oldRod', 12, createSequenceRng([0, 0, 0, 0]), false, undefined,
      { abilityId: 22, isEgg: false, level: 20 })).toBeUndefined()
  })

  it('applies the native step boost and short-circuits the second roll', () => {
    expect([0, 1, 2, 3, 4, 20].map(getHgssStepEncounterRateBoost)).toEqual([0, 0, 30, 40, 60, 60])
    expect(rollHgssWildEncounterRate(createSequenceRng([20]), 25, 'walking', 0, false)).toEqual({
      triggered: false,
      modifiedRate: 20,
      firstRoll: 20,
    })
    expect(rollHgssWildEncounterRate(createSequenceRng([19, 24]), 25, 'walking', 0, false)).toEqual({
      triggered: true,
      modifiedRate: 20,
      firstRoll: 19,
      secondRoll: 24,
    })
    expect(rollHgssWildEncounterRate(createSequenceRng([79, 24]), 25, 'walking', 4, false).triggered).toBe(true)
    expect(rollHgssWildEncounterRate(createSequenceRng([69, 99]), 255, 'cycling', 0, false).triggered).toBe(true)
  })

  it('applies native land/Surf ability, weather, flute, and held-item rates in ROM order', () => {
    const lead = (abilityId: number, heldItemId = 0, isEgg = false) => ({ abilityId, heldItemId, isEgg })
    expect(applyHgssLandOrSurfEncounterRateModifiers(60, { lead: lead(71) })).toBe(100)
    expect(applyHgssLandOrSurfEncounterRateModifiers(60, { lead: lead(35) })).toBe(100)
    expect(applyHgssLandOrSurfEncounterRateModifiers(60, { lead: lead(99) })).toBe(100)
    expect(applyHgssLandOrSurfEncounterRateModifiers(51, { lead: lead(81), weatherType: 5 })).toBe(25)
    expect(applyHgssLandOrSurfEncounterRateModifiers(51, { lead: lead(81), weatherType: 4 })).toBe(51)
    expect([1, 73, 95].map((abilityId) => applyHgssLandOrSurfEncounterRateModifiers(51, { lead: lead(abilityId) })))
      .toEqual([25, 25, 25])
    expect(applyHgssLandOrSurfEncounterRateModifiers(90, { lead: lead(0), flutePlayed: 1 })).toBe(45)
    expect(applyHgssLandOrSurfEncounterRateModifiers(51, { lead: lead(0), flutePlayed: 2 })).toBe(76)
    expect(applyHgssLandOrSurfEncounterRateModifiers(51, { lead: lead(0, 224) })).toBe(34)
    expect(applyHgssLandOrSurfEncounterRateModifiers(51, { lead: lead(0, 320) })).toBe(34)
    // Talent -> Flûte -> objet : 80 plafonné à 100, /2, puis *2/3.
    expect(applyHgssLandOrSurfEncounterRateModifiers(80, { lead: lead(71, 224), flutePlayed: 1 })).toBe(33)
    // Un œuf saute le talent et le plafond, mais pas les deux étapes suivantes en u8.
    expect(applyHgssLandOrSurfEncounterRateModifiers(200, { lead: lead(71, 0, true), flutePlayed: 2 })).toBe(44)
  })

  it('feeds the fully modified native rate into the field encounter second roll', () => {
    const slots = Array.from({ length: 12 }, () => ({ speciesId: 152, level: 2 }))
    const encounters = {
      bankId: 0,
      rates: { walking: 60 },
      land: { morning: slots, day: slots, night: slots },
    } as HgssWildEncounterData
    const session = createHgssFieldEncounterSession([encounters], createSequenceRng([0, 40, 0]), () => new Date(2026, 2, 12, 12), 'east')
    const check = () => session.checkStep({
      mapId: 1,
      bankId: 0,
      terrainAttribute: 2,
      direction: 'east',
      rateContext: { lead: { abilityId: 1, heldItemId: 0, isEgg: false } },
    })
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    // Puanteur réduit 60 à 30 : le second jet 40 échoue.
    expect(check()).toBeUndefined()
  })

  it('resets map inhibition and boosts only opposite encounter directions', () => {
    const slots = Array.from({ length: 12 }, () => ({ speciesId: 152, level: 2 }))
    const encounters = {
      bankId: 0,
      rates: { walking: 100 },
      land: { morning: slots, day: slots, night: slots },
    } as HgssWildEncounterData
    const session = createHgssFieldEncounterSession([encounters], createSequenceRng([99, 0, 0, 0]), () => new Date(2026, 2, 12, 12), 'east')
    const step = (direction: 'east' | 'west') => session.checkStep({ mapId: 1, bankId: 0, terrainAttribute: 2, direction })
    expect(step('east')).toBeUndefined()
    expect(step('east')).toBeUndefined()
    expect(step('east')).toBeUndefined()
    expect(step('west')).toBeUndefined()
    expect(step('east')).toMatchObject({
      rateRoll: { triggered: true, modifiedRate: 50, firstRoll: 0, secondRoll: 0 },
    })
    session.reset('north')
    expect(step('east')).toBeUndefined()
    expect(step('east')).toBeUndefined()
    expect(step('east')).toBeUndefined()
  })

  it('prepares Surf encounters only while the avatar is surfing', () => {
    const encounters = {
      bankId: 0,
      rates: { walking: 0, surfing: 100 },
      surfing: Array.from({ length: 5 }, () => ({ speciesId: 60, minLevel: 10, maxLevel: 10 })),
    } as HgssWildEncounterData
    const session = createHgssFieldEncounterSession([encounters], createSequenceRng([0, 0, 0, 0]), () => new Date(2026, 2, 12, 12), 'east')
    const step = (movementMode: 'walking' | 'surfing') => session.checkStep({
      mapId: 1, bankId: 0, terrainAttribute: 16, direction: 'east', movementMode,
    })
    expect(step('walking')).toBeUndefined()
    expect(step('walking')).toBeUndefined()
    expect(step('walking')).toBeUndefined()
    expect(step('surfing')).toMatchObject({ encounter: { method: 'surfing', speciesId: 60, level: 10 } })
  })

  it('selects a roaming Pokémon after the rate roll and before consuming a normal slot roll', () => {
    const slots = Array.from({ length: 12 }, () => ({ speciesId: 152, level: 2 }))
    const encounters = {
      bankId: 0,
      rates: { walking: 100 },
      land: { morning: slots, day: slots, night: slots },
    } as HgssWildEncounterData
    const session = createHgssFieldEncounterSession([encounters], createSequenceRng([0, 0]), () => new Date(2026, 2, 12, 12), 'east')
    const check = () => session.checkStep({
      mapId: 39,
      bankId: 0,
      terrainAttribute: 2,
      direction: 'east',
      prepareSpecialEncounter: () => ({ bankId: 0, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 0 }),
    })
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    expect(check()).toMatchObject({ encounter: { method: 'roamer', speciesId: 243, roamerId: 0 } })
  })

  it('conserve les roamers tout en laissant les acteurs visibles supprimer le slot ordinaire', () => {
    const slots = Array.from({ length: 12 }, () => ({ speciesId: 152, level: 2 }))
    const encounters = {
      bankId: 0,
      rates: { walking: 100 },
      land: { morning: slots, day: slots, night: slots },
    } as HgssWildEncounterData
    const session = createHgssFieldEncounterSession(
      [encounters],
      createSequenceRng([0, 0, 0, 0, 0, 0]),
      () => new Date(2026, 2, 12, 12),
      'east',
    )
    let roamerAvailable = true
    const check = () => session.checkStep({
      mapId: 39,
      bankId: 0,
      terrainAttribute: 2,
      direction: 'east',
      suppressOrdinaryEncounter: true,
      prepareSpecialEncounter: () => roamerAvailable
        ? { bankId: 0, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 0 }
        : undefined,
    })
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    roamerAvailable = false
    expect(check()).toBeUndefined()
    roamerAvailable = true
    expect(check()).toMatchObject({ encounter: { method: 'roamer', speciesId: 243 } })
  })

  it('does not reset inhibition for a roamer or any Repel-suppressed encounter', () => {
    const slots = Array.from({ length: 12 }, () => ({ speciesId: 152, level: 2 }))
    const encounters = { bankId: 0, rates: { walking: 100 }, land: { morning: slots, day: slots, night: slots } } as HgssWildEncounterData
    const session = createHgssFieldEncounterSession([encounters], createSequenceRng([0, 0, 0, 0, 0, 0, 0, 0]), () => new Date(2026, 2, 12, 12), 'east')
    let roamer = true
    const check = (repelLeadLevel?: number) => session.checkStep({
      mapId: 39, bankId: 0, terrainAttribute: 2, direction: 'east', repelLeadLevel,
      prepareSpecialEncounter: () => roamer ? { bankId: 0, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 0 } : undefined,
    })
    expect(check()).toBeUndefined(); expect(check()).toBeUndefined(); expect(check()).toBeUndefined()
    expect(check()).toMatchObject({ encounter: { method: 'roamer' } })
    roamer = false
    expect(check(10)).toBeUndefined()
    // Le slot précédent a été supprimé par Repousse, donc le pas suivant est
    // immédiatement éligible au lieu de subir de nouveau trois pas d'inhibition.
    expect(check()).toMatchObject({ encounter: { method: 'land', speciesId: 152 } })
  })

  it('routes forced encounters through the same table while preserving the forced-roamer counter quirk', () => {
    const slots = Array.from({ length: 12 }, (_, index) => ({ speciesId: 152 + index, level: 2 }))
    const encounters = {
      bankId: 0, rates: { walking: 100 }, land: { morning: slots, day: slots, night: slots },
      hoennSoundSpecies: [252, 253], sinnohSoundSpecies: [254, 255],
    } as unknown as HgssWildEncounterData
    const ordinary = createHgssFieldEncounterSession([encounters], createSequenceRng([40]), () => new Date(2026, 2, 12, 12), 'east')
    expect(ordinary.prepareForced({ mapId: 1, bankId: 0, method: 'land', encounterRate: 100, generationContext: { radioEffect: 'hoenn' } }))
      .toMatchObject({ encounter: { slotIndex: 2, speciesId: 252 }, rateRoll: { firstRoll: 0 } })
    expect(ordinary.checkStep({ mapId: 1, bankId: 0, terrainAttribute: 2, direction: 'east' })).toBeUndefined()

    const roamer = createHgssFieldEncounterSession([encounters], createSequenceRng([0, 0, 0]), () => new Date(2026, 2, 12, 12), 'east')
    for (let step = 0; step < 3; step += 1) {
      expect(roamer.checkStep({ mapId: 1, bankId: 0, terrainAttribute: 2, direction: 'east' })).toBeUndefined()
    }
    expect(roamer.prepareForced({
      mapId: 1, bankId: 0, method: 'land', encounterRate: 100,
      prepareSpecialEncounter: () => ({ bankId: 0, slotIndex: 0, method: 'roamer', speciesId: 243, level: 40, roamerId: 0 }),
    })).toMatchObject({ encounter: { method: 'roamer' } })
    expect(roamer.checkStep({ mapId: 1, bankId: 0, terrainAttribute: 2, direction: 'east' }))
      .toMatchObject({ encounter: { method: 'land' } })
  })

  it('substitue une table de contexte après le roamer sans repli sauvage si elle supprime le slot', () => {
    const slots = Array.from({ length: 12 }, () => ({ speciesId: 152, level: 2 }))
    const encounters = {
      bankId: 0,
      rates: { walking: 100 },
      land: { morning: slots, day: slots, night: slots },
    } as HgssWildEncounterData
    const session = createHgssFieldEncounterSession([encounters], createSequenceRng([0, 0, 0, 0, 0]), () => new Date(2026, 2, 12, 12), 'east')
    let suppress = true
    const check = () => session.checkStep({
      mapId: 357,
      bankId: 0,
      terrainAttribute: 2,
      direction: 'east',
      prepareContextEncounter: () => suppress
        ? undefined
        : { method: 'safari', safariMethod: 'land', speciesId: 74, level: 17, areaId: 0, areaSlot: 0, slotIndex: 4, time: 'day' },
    })
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    expect(check()).toBeUndefined()
    suppress = false
    expect(check()).toMatchObject({ encounter: { method: 'safari', safariMethod: 'land', speciesId: 74 } })
  })
})
