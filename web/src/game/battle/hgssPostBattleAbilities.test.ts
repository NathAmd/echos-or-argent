import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonParty } from '../pokemon/pokemonParty'
import { applyHgssPostBattleAbilityItems, applyHgssPostBattleProgression } from './hgssPostBattleAbilities'

function pokemon(abilityId: number, level: number) {
  const created = createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId: 152, level, rng: createHgssLcrng(1), personality: { kind: 'fixed', value: 1 }, individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: level, metTerrain: 0 }, ballId: 4, moveIds: [33],
  })
  created.abilityId = abilityId
  return created
}

describe('talents de fin de combat HGSS', () => {
  it('reproduit les tables commune et rare de Ramassage par tranche de niveau', () => {
    const common = pokemon(53, 1)
    expect(applyHgssPostBattleAbilityItems([common], { getSeed: () => 0, nextU16: (() => { const rolls = [0, 0]; return () => rolls.shift() ?? 0 })() })).toEqual([{ partySlot: 0, abilityId: 53, itemId: 17 }])
    const rare = pokemon(53, 100)
    expect(applyHgssPostBattleAbilityItems([rare], { getSeed: () => 0, nextU16: (() => { const rolls = [0, 99]; return () => rolls.shift() ?? 0 })() })).toEqual([{ partySlot: 0, abilityId: 53, itemId: 234 }])
  })

  it('applique Cherche Miel à toute l’équipe et respecte les objets déjà tenus', () => {
    const gatherer = pokemon(118, 100), occupied = pokemon(118, 100); occupied.heldItemId = 4
    expect(applyHgssPostBattleAbilityItems([gatherer, occupied], { getSeed: () => 0, nextU16: () => 0 })).toEqual([{ partySlot: 0, abilityId: 118, itemId: 94 }])
    expect(gatherer.heldItemId).toBe(94)
    expect(occupied.heldItemId).toBe(4)
  })

  it('enchaîne talents de victoire puis acquisition et propagation Pokérus dans l’ordre natif', () => {
    const party = createPokemonParty([pokemon(53, 1), pokemon(1, 5)])
    const rolls = [0, 0, 0x4000, 1, 3, 1]

    expect(applyHgssPostBattleProgression(party, {
      getSeed: () => 0,
      nextU16: () => rolls.shift() ?? 1,
    }, true)).toEqual({
      abilityItems: [{ partySlot: 0, abilityId: 53, itemId: 17 }],
      pokerus: { acquisition: { partySlot: 1, pokerus: 0x34 }, spreadSlots: [] },
    })
    expect(party.members[0]?.heldItemId).toBe(17)
    expect(party.members[1]?.pokerus).toBe(0x34)
    expect(rolls).toEqual([])
  })

  it('saute les talents après une issue non gagnée mais exécute toujours les deux tirages Pokérus', () => {
    const party = createPokemonParty([pokemon(53, 1)])
    const rolls = [0x4000, 0, 3, 1]

    const result = applyHgssPostBattleProgression(party, {
      getSeed: () => 0,
      nextU16: () => rolls.shift() ?? 1,
    }, false)

    expect(result).toEqual({
      abilityItems: [],
      pokerus: { acquisition: { partySlot: 0, pokerus: 0x34 }, spreadSlots: [] },
    })
    expect(party.members[0]).toMatchObject({ heldItemId: 0, pokerus: 0x34 })
    expect(rolls).toEqual([])
  })
})
