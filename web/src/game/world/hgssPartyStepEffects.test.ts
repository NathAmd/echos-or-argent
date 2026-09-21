import { describe, expect, it } from 'vitest'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng, type HgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  advanceHgssFieldPoisonStep,
  advanceHgssWalkingFriendshipStep,
  cureHgssFieldPoisonSurvivors,
} from './hgssPartyStepEffects'

function pokemon(speciesId: number, friendship = 100): CanonicalPokemon {
  return createCanonicalPokemon(createPokemonTestCatalog(200), {
    speciesId,
    level: 20,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 10 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 42, metLevel: 20, metTerrain: 0 },
    friendship,
    ballId: 4,
  })
}

function sequenceRng(values: readonly number[]): { rng: HgssLcrng, calls: () => number } {
  let index = 0
  return {
    calls: () => index,
    rng: {
      getSeed: () => index,
      nextU16: () => values[index++] ?? 0,
    },
  }
}

describe('HGSS party step effects', () => {
  it('applies field poison damage exactly every fourth processable step', () => {
    const poisoned = pokemon(155)
    poisoned.currentHp = 5
    poisoned.status = 0x08
    const state = createFieldScriptState('male', 'JO', { party: [poisoned] })

    for (let step = 1; step < 4; step += 1) {
      expect(advanceHgssFieldPoisonStep(state)).toEqual({
        triggered: false,
        effect: 'none',
        affectedSlots: [],
        survivors: [],
      })
      expect(state.party.members[0]?.currentHp).toBe(5)
      expect(state.poisonStepCounter).toBe(step)
    }

    expect(advanceHgssFieldPoisonStep(state)).toMatchObject({
      triggered: true,
      effect: 'damage',
      affectedSlots: [0],
      survivors: [],
    })
    expect(state.party.members[0]?.currentHp).toBe(4)
    expect(state.poisonStepCounter).toBe(0)
  })

  it('keeps poison survivors at one HP, applies the native friendship loss, then cures them in the script phase', () => {
    const highFriendship = pokemon(155, 205)
    highFriendship.currentHp = 2
    highFriendship.status = 0x80 | 0x500
    const lowFriendship = pokemon(158, 3)
    lowFriendship.currentHp = 1
    lowFriendship.status = 0x08
    const egg = pokemon(152)
    egg.isEgg = true
    egg.currentHp = 2
    egg.status = 0x08
    const fainted = pokemon(153)
    fainted.currentHp = 0
    fainted.status = 0x08
    const stillPoisoned = pokemon(156)
    stillPoisoned.currentHp = 5
    stillPoisoned.status = 0x08
    const state = createFieldScriptState('male', 'JO', {
      party: [highFriendship, lowFriendship, egg, fainted, stillPoisoned],
    })
    state.poisonStepCounter = 3

    expect(advanceHgssFieldPoisonStep(state)).toEqual({
      triggered: true,
      effect: 'survive',
      affectedSlots: [0, 1, 4],
      survivors: [
        { slot: 0, friendshipBefore: 205, friendshipAfter: 195 },
        { slot: 1, friendshipBefore: 3, friendshipAfter: 0 },
      ],
    })
    expect(state.party.members.map(({ currentHp }) => currentHp)).toEqual([1, 1, 2, 0, 4])
    expect(cureHgssFieldPoisonSurvivors(state)).toEqual([0, 1])
    expect(state.party.members.map(({ status }) => status)).toEqual([0, 0, 0x08, 0x08, 0x08])
  })

  it('rolls friendship independently every 128 steps and preserves the native modifier order', () => {
    const boosted = pokemon(155)
    boosted.ballId = 11
    boosted.heldItemId = 7
    boosted.origin.eggLocation = 42
    const rejected = pokemon(156)
    const egg = pokemon(157)
    egg.isEgg = true
    const capped = pokemon(158, 255)
    const metLocationOnly = pokemon(159)
    metLocationOnly.origin.metLocation = 42
    metLocationOnly.origin.eggLocation = 41
    const state = createFieldScriptState('male', 'JO', {
      party: [boosted, rejected, egg, capped, metLocationOnly],
    })
    state.friendshipStepCounter = 126

    const heldItems = [] as unknown[]
    heldItems[7] = { holdEffect: 53 }
    const itemCatalog = { items: heldItems, pocketNames: [] } as unknown as HgssItemCatalog
    const sequence = sequenceRng([0, 1, 0, 0, 0])

    expect(advanceHgssWalkingFriendshipStep({ state, mapSectionId: 42, rng: sequence.rng, itemCatalog }))
      .toEqual({ triggered: false, gains: [] })
    expect(sequence.calls()).toBe(0)
    expect(advanceHgssWalkingFriendshipStep({ state, mapSectionId: 42, rng: sequence.rng, itemCatalog })).toEqual({
      triggered: true,
      gains: [
        { slot: 0, friendshipBefore: 100, friendshipAfter: 104 },
        { slot: 4, friendshipBefore: 100, friendshipAfter: 101 },
      ],
    })
    expect(sequence.calls()).toBe(5)
    expect(state.party.members.map(({ friendship }) => friendship)).toEqual([104, 100, 100, 255, 101])
    expect(state.friendshipStepCounter).toBe(0)
  })
})
