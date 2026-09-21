import { describe, expect, it } from 'vitest'
import { decodeHgssFollowerReactionRule, type HgssFollowerReactionCatalog } from '../../rom/overworld/followerReactions'
import type { HgssLcrng } from './hgssPokemonRng'
import {
  applyHgssFollowerReactionEffects,
  createHgssFollowerReactionContext,
  matchesHgssFollowerReactionRule,
  resolveHgssFollowerFacingClass,
  resolveHgssFollowerTimeOfDayClass,
  selectHgssFollowerReaction,
  type HgssFollowerReactionContext,
} from './followerReactionSelection'

function createRule(reactionId: number, probability = 100, configure?: (payload: Uint8Array, view: DataView) => void) {
  const payload = new Uint8Array(20)
  const view = new DataView(payload.buffer)
  view.setUint16(10, reactionId << 6, true)
  payload[17] = probability
  configure?.(payload, view)
  return decodeHgssFollowerReactionRule(payload)
}

function createContext(overrides: Partial<HgssFollowerReactionContext> = {}): HgssFollowerReactionContext {
  return {
    heldItemPresent: false,
    heldItemClass: 0,
    hpClass: 1,
    statusClass: 1,
    levelClass: 0,
    primaryTypeClass: 1,
    secondaryTypeClass: 1,
    friendship: 70,
    natureClass: 1,
    genderClass: 1,
    speciesReactionClass: 30,
    shinyLeafMask: 0,
    nearbyObjectCount: 0,
    hiddenItemCount: 0,
    weatherClass: 1,
    metatileBehavior: 1,
    terrainClass: 1,
    mapId: 60,
    timeOfDayClass: 1,
    mood: 0,
    pokeathlonStatClass: 1,
    facingClass: 1,
    hasFlag: () => false,
    ...overrides,
  }
}

describe('HGSS follower reaction selection', () => {
  it('applies native friendship, mood and shiny-leaf effects with their bounds', () => {
    const pokemon = { friendship: 250, shinyLeafMask: 0b00001 } as Parameters<typeof applyHgssFollowerReactionEffects>[0]
    const reaction = {
      reactionId: 1,
      steps: [],
      terminated: true,
      effects: {
        rawPrefix: [],
        friendshipDelta: 10,
        moodDelta: -20,
        fashionItemId: 7,
        shinyLeafIndex: 2,
      },
    }

    expect(applyHgssFollowerReactionEffects(pokemon, -120, reaction)).toEqual({
      friendship: 255,
      mood: -127,
      shinyLeafGranted: 2,
      fashionItemId: 7,
    })
    expect(pokemon).toMatchObject({ friendship: 255, shinyLeafMask: 0b00011 })
    expect(applyHgssFollowerReactionEffects(pokemon, 120, reaction)).toMatchObject({ shinyLeafGranted: 0 })
  })

  it('derives native Pokémon, terrain, weather, direction and RTC classes', () => {
    const pokemon = {
      speciesId: 155,
      heldItemId: 17,
      currentHp: 9,
      stats: { hp: 18 },
      status: 0x10,
      level: 5,
      friendship: 70,
      nature: 14,
      gender: 'male',
    } as Parameters<typeof createHgssFollowerReactionContext>[0]
    const personalData = { types: [10, 10] } as unknown as Parameters<typeof createHgssFollowerReactionContext>[1]
    const context = createHgssFollowerReactionContext(pokemon, personalData, 3, 31, 0b00101, {
      nearbyObjectCount: 5,
      hiddenItemCount: 1,
      weather: 1,
      metatileBehavior: 2,
      mapId: 60,
      time: new Date(2026, 7, 13, 18),
      mood: -30,
      pokeathlonStatClass: 4,
      facingClass: resolveHgssFollowerFacingClass('south'),
      hasFlag: (flagId) => flagId === 107,
    })

    expect(context).toMatchObject({
      heldItemPresent: true,
      heldItemClass: 1,
      hpClass: 3,
      statusClass: 2,
      levelClass: 4,
      primaryTypeClass: 2,
      friendship: 70,
      natureClass: 1,
      genderClass: 1,
      speciesReactionClass: 31,
      shinyLeafMask: 5,
      nearbyObjectCount: 5,
      weatherClass: 3,
      terrainClass: 1,
      timeOfDayClass: 3,
      mood: -30,
      facingClass: 4,
    })
    expect(resolveHgssFollowerTimeOfDayClass(new Date(2026, 7, 13, 2))).toBe(5)
    expect(resolveHgssFollowerTimeOfDayClass(new Date(2026, 7, 13, 8))).toBe(1)
    expect(resolveHgssFollowerTimeOfDayClass(new Date(2026, 7, 13, 12))).toBe(2)
    expect(resolveHgssFollowerTimeOfDayClass(new Date(2026, 7, 13, 22))).toBe(4)
  })

  it('matches every active native condition family', () => {
    const rule = createRule(123, 100, (payload, view) => {
      payload[0] = 3
      payload[1] = (4 << 4) | 3
      payload[2] = (7 << 5) | (2 << 3) | 2
      payload[3] = 9
      payload[4] = (4 << 5) | 12
      payload[5] = 2
      payload[6] = 250
      payload[7] = 3
      view.setUint16(8, (4 << 13) | 3, true)
      view.setUint16(10, (123 << 6) | (4 << 3) | 5, true)
      view.setUint16(12, 61, true)
      view.setUint16(14, 22, true)
      payload[16] = (4 << 5) | (2 << 1)
      view.setUint16(18, 107, true)
    })
    const context = createContext({
      heldItemPresent: true,
      hpClass: 3,
      statusClass: 2,
      levelClass: 2,
      primaryTypeClass: 12,
      friendship: 100,
      natureClass: 2,
      genderClass: 2,
      speciesReactionClass: 19,
      shinyLeafMask: 0b00011,
      nearbyObjectCount: 7,
      hiddenItemCount: 5,
      weatherClass: 3,
      metatileBehavior: 22,
      terrainClass: 2,
      timeOfDayClass: 4,
      mood: 50,
      pokeathlonStatClass: 4,
      facingClass: 4,
      hasFlag: (flagId) => flagId === 107,
    })

    expect(matchesHgssFollowerReactionRule(rule, context, 99)).toBe(true)
    expect(matchesHgssFollowerReactionRule(rule, { ...context, mapId: 61 }, 0)).toBe(false)
    expect(matchesHgssFollowerReactionRule(rule, { ...context, shinyLeafMask: 0b00111 }, 0)).toBe(false)
    expect(matchesHgssFollowerReactionRule(rule, { ...context, hasFlag: () => false }, 0)).toBe(false)
  })

  it('reproduces the native friendship, mood, status and species range boundaries', () => {
    const friendship = createRule(1, 100, (payload) => { payload[1] = 2 << 4 })
    expect(matchesHgssFollowerReactionRule(friendship, createContext({ friendship: 200 }), 0)).toBe(true)
    expect(matchesHgssFollowerReactionRule(friendship, createContext({ friendship: 255 }), 0)).toBe(false)

    const mood = createRule(1, 100, (payload) => { payload[1] = 6 })
    expect(matchesHgssFollowerReactionRule(mood, createContext({ mood: -49 }), 0)).toBe(true)
    expect(matchesHgssFollowerReactionRule(mood, createContext({ mood: -30 }), 0)).toBe(true)
    expect(matchesHgssFollowerReactionRule(mood, createContext({ mood: -50 }), 0)).toBe(false)
    expect(matchesHgssFollowerReactionRule(mood, createContext({ mood: -29 }), 0)).toBe(false)

    const status = createRule(1, 100, (payload) => { payload[2] = 7 << 5 })
    expect(matchesHgssFollowerReactionRule(status, createContext({ statusClass: 8 }), 0)).toBe(true)
    expect(matchesHgssFollowerReactionRule(status, createContext({ statusClass: 1 }), 0)).toBe(false)

    const species = createRule(1, 100, (payload) => { payload[6] = 252 })
    expect(matchesHgssFollowerReactionRule(species, createContext({ speciesReactionClass: 140 }), 0)).toBe(true)
    expect(matchesHgssFollowerReactionRule(species, createContext({ speciesReactionClass: 150 }), 0)).toBe(false)
  })

  it('consumes one LCRNG value per non-empty candidate and returns the first valid rule', () => {
    const empty = createRule(0)
    const rejectedByProbability = createRule(1, 0)
    const rejectedByHp = createRule(2, 100, (payload) => { payload[0] = 2 })
    const selected = createRule(3)
    const globalRules = [empty, rejectedByProbability, rejectedByHp, selected, ...Array.from({ length: 66 }, () => empty)]
    const sectionRules = [Array.from({ length: 30 }, () => empty)]
    const catalog: HgssFollowerReactionCatalog = {
      globalRules,
      sectionRules,
      reactions: [1, 2, 3].map((reactionId) => ({
        reactionId,
        steps: [],
        terminated: true,
        effects: { rawPrefix: [], friendshipDelta: 0, moodDelta: 0, fashionItemId: 0, shinyLeafIndex: 0 },
      })),
      movements: [],
      speciesReactionClasses: [],
      interactionMessages: {},
      auxiliaryMessages: {},
    }
    const values = [7, 8, 9]
    let calls = 0
    const rng: HgssLcrng = {
      getSeed: () => 0,
      nextU16: () => {
        const value = values[calls]
        calls += 1
        if (value === undefined) throw new Error('Tirage LCRNG inattendu.')
        return value
      },
    }

    expect(selectHgssFollowerReaction(catalog, 0, createContext(), rng)).toMatchObject({
      rule: { reactionId: 3 },
      reaction: { reactionId: 3 },
    })
    expect(calls).toBe(3)
  })
})
