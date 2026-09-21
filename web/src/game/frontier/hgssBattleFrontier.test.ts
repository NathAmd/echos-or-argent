import { describe, expect, it } from 'vitest'
import { createPokemonParty } from '../pokemon/pokemonParty'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { isHgssPartyValidForBattleFrontier, isHgssPartyValidForBattleHall } from './hgssBattleFrontier'

function createPokemon(speciesId: number, heldItemId = 0) {
  return createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId,
    level: 50,
    heldItemId,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 50, metTerrain: 12 },
    ballId: 4,
  })
}

describe('validation de l’équipe Tour de Combat HGSS', () => {
  it('cherche une combinaison admissible du nombre demandé', () => {
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty([createPokemon(152)]), 2)).toBe(false)
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty([createPokemon(152), createPokemon(155)]), 2)).toBe(true)
  })

  it('rejette espèces, objets et Pokémon interdits comme la ROM', () => {
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty([createPokemon(152), createPokemon(152)]), 2)).toBe(false)
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty([createPokemon(152, 1), createPokemon(155, 1)]), 2)).toBe(false)
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty([createPokemon(150), createPokemon(155)]), 2)).toBe(false)
    const egg = createPokemon(152)
    egg.isEgg = true
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty([egg, createPokemon(155)]), 2)).toBe(false)
  })

  it('applique les règles particulières de la Scène de Combat et des objets dupliqués', () => {
    const sameSpecies = [createPokemon(152, 1), createPokemon(152, 1)]
    expect(isHgssPartyValidForBattleHall(createPokemonParty(sameSpecies), 2)).toBe(true)
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty(sameSpecies), 2)).toBe(false)
    expect(isHgssPartyValidForBattleFrontier(createPokemonParty([createPokemon(152, 1), createPokemon(155, 1)]), 2, false)).toBe(true)
    sameSpecies[0]!.level = 29
    expect(isHgssPartyValidForBattleHall(createPokemonParty(sameSpecies), 2)).toBe(false)
  })
})
