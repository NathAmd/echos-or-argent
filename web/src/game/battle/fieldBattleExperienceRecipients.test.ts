import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { resolveFieldBattleExperienceRecipients } from './fieldBattleExperienceRecipients'

const catalog = createPokemonTestCatalog()
const player = { id: 1, name: 'JO', gender: 'male' as const }
function pokemon(speciesId: number, owner = player) {
  return createCanonicalPokemon(catalog, {
    speciesId, level: 5, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 }, originalTrainer: owner,
    origin: { language: owner.id === 1 ? 3 : 2, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    ballId: 4,
  })
}

describe('field battle experience recipients', () => {
  it('réunit participants et Multi Exp dans leur ordre sans doublon', () => {
    const party = [pokemon(152), pokemon(155), pokemon(158, { id: 2, name: 'RED', gender: 'male' })]
    party[1]!.heldItemId = 10
    party[2]!.heldItemId = 10
    const recipients = resolveFieldBattleExperienceRecipients({
      party,
      participantPartyIndexes: new Set([0, 2]),
      player,
      nativeLanguage: 3,
      currentLocationId: 61,
      readHeldItem: (value) => ({ effect: value.heldItemId === 10 ? 51 : 0, parameter: 7 }),
    })

    expect(recipients.map(({ partyIndex }) => partyIndex)).toEqual([0, 2, 1])
    expect(recipients.map(({ experienceDivisor }) => experienceDivisor)).toEqual([2, 2, 2])
    expect(recipients[0]?.modifiers).toMatchObject({ participated: true, hasExpShare: false, traded: 'none' })
    expect(recipients[1]?.modifiers).toMatchObject({ participated: true, hasExpShare: true, traded: 'foreign-language' })
    expect(recipients[2]?.modifiers).toMatchObject({ participated: false, hasExpShare: true, expShareCount: 2 })
  })

  it('écarte œufs et Pokémon K.O. avant toute politique de progression', () => {
    const party = [pokemon(152), pokemon(155)]
    party[0]!.currentHp = 0
    party[1]!.isEgg = true
    expect(resolveFieldBattleExperienceRecipients({
      party,
      participantPartyIndexes: new Set([0, 1]),
      player,
      readHeldItem: () => ({ effect: 51, parameter: 0 }),
    })).toEqual([])
  })
})
