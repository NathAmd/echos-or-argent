import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssRtcPenaltyState } from '../time/hgssRtcPenalty'
import type { WorldMoveResult } from './worldSession'
import {
  completeHgssFieldStep,
  hgssFieldStepInterruptScripts,
  isHgssProcessableFieldStep,
  resolveHgssFieldStepInterruptScript,
  type HgssFieldStepCompletion,
} from './hgssFieldStepCompletion'

const moved = {
  kind: 'moved',
  state: { map: { id: 1 }, tileX: 1, tileZ: 1, direction: 'east', locomotion: 'walking' },
  movement: 'walk',
} as Extract<WorldMoveResult, { kind: 'moved' }>

describe('HGSS field-step completion order', () => {
  it('processes a normal step and a held-direction warp candidate', () => {
    expect(isHgssProcessableFieldStep(moved)).toBe(true)
    expect(isHgssProcessableFieldStep({
      ...moved,
      warp: { kind: 'warp', header: 2, anchor: 0 },
      warpActivation: { trigger: 'completed-step-held', behavior: 108, transition: 'direct', direction: 'east', heldDirection: 'east' },
    })).toBe(true)
  })

  it('stops before step tasks for coordinates and immediate transitions', () => {
    expect(isHgssProcessableFieldStep({
      ...moved,
      coordinate: { kind: 'coordinate', scriptId: 1, x: 1, z: 1, y: 0, width: 1, height: 1, variableId: 0, expectedValue: 0 },
    })).toBe(false)
    expect(isHgssProcessableFieldStep({
      ...moved,
      warp: { kind: 'warp', header: 2, anchor: 0 },
      warpActivation: { trigger: 'completed-step', behavior: 110, transition: 'direct', direction: 'north' },
    })).toBe(false)
  })

  it('only skips the step task while the arrival tile continues forced movement', () => {
    expect(isHgssProcessableFieldStep({ ...moved, continuationDirection: 'east' })).toBe(false)
    expect(isHgssProcessableFieldStep({ ...moved, state: { ...moved.state, map: { ...moved.state.map, id: 2 } } })).toBe(true)
  })

  it('interrupts the cycle on egg or Repel scripts before wild, held warp and phone', () => {
    const base = {
      rtcPenaltyState: {
        schemaVersion: 1, lastObservedTimestampSeconds: 0, lastObservedDayOrdinal: 0,
        ownerRtcOffset: 0, penaltyMinutes: 0,
      },
      hadRtcPenaltyForDailyTasks: false,
      eggReadyToHatch: false,
      poison: { triggered: false, effect: 'none', affectedSlots: [], survivors: [] },
    } satisfies HgssFieldStepCompletion
    expect(resolveHgssFieldStepInterruptScript({ ...base, eggReadyToHatch: true }))
      .toBe(hgssFieldStepInterruptScripts.hatchEgg)
    expect(resolveHgssFieldStepInterruptScript({
      ...base,
      repel: { protected: true, expired: true, blocksEncounter: true },
    })).toBe(hgssFieldStepInterruptScripts.repelWoreOff)
    expect(resolveHgssFieldStepInterruptScript({
      ...base,
      repel: { protected: true, expired: false, blocksEncounter: false },
    })).toBeUndefined()
    expect(resolveHgssFieldStepInterruptScript({
      ...base,
      eggReadyToHatch: true,
      poison: { triggered: true, effect: 'survive', affectedSlots: [0], survivors: [{ slot: 0, friendshipBefore: 70, friendshipAfter: 65 }] },
    })).toBe(hgssFieldStepInterruptScripts.survivePoisoning)
  })

  it('expire le Pokérus au changement de jour RTC, même pendant la pénalité native', () => {
    const previous = new Date(2026, 2, 12, 23, 58)
    let now = new Date(2026, 2, 14, 0, 1)
    const catalog = createPokemonTestCatalog()
    const rng = createHgssLcrng(7)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152, level: 5, rng, personality: { kind: 'fixed', value: 7 },
      individualValues: { kind: 'fixed', value: 7 },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    pokemon.pokerus = 0x23
    const state = createFieldScriptState('male', 'JO', {
      party: [pokemon],
      pokemonRuntime: {
        catalog, rng, trainer: pokemon.originalTrainer, language: 3, gameVersion: 7, now: () => now,
      },
    })
    const rtcPenaltyState = { ...createHgssRtcPenaltyState(previous), penaltyMinutes: 1_440 }

    const first = completeHgssFieldStep({
      state, rtcPenaltyState, currentIgtMinutes: 0, mapSectionId: 1,
      onUrgentTriggerScheduled: () => undefined,
    })
    expect(first.hadRtcPenaltyForDailyTasks).toBe(true)
    expect(state.party.members[0]?.pokerus).toBe(0x21)

    now = new Date(2026, 2, 14, 12, 0)
    completeHgssFieldStep({
      state, rtcPenaltyState: first.rtcPenaltyState, currentIgtMinutes: 1, mapSectionId: 1,
      onUrgentTriggerScheduled: () => undefined,
    })
    expect(state.party.members[0]?.pokerus).toBe(0x21)
  })
})
