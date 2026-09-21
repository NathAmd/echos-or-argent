import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon, type CanonicalPokemon } from './canonicalPokemon'
import { resolvePokemonFollowerSelection } from './followerSelection'
import { createHgssLcrng } from './hgssPokemonRng'
import { createPokemonParty, swapPokemonPartyMembers } from './pokemonParty'
import { createPokemonTestCatalog } from './pokemonTestCatalog'

function createPokemon(speciesId: 152 | 155 | 158): CanonicalPokemon {
  return createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
}

function createFollowerCatalog() {
  const catalog = createPokemonTestCatalog().followers
  catalog.modelIndexBySpecies[152] = 153
  catalog.modelIndexBySpecies[155] = 157
  catalog.modelIndexBySpecies[158] = 160
  catalog.parameters.push({ modelIndex: 159, size: 0, values: [0, 0, 0, 0] })
  catalog.parameters.push({ modelIndex: 160, size: 0, values: [0, 0, 0, 0] })
  return catalog
}

describe('HGSS follower selection', () => {
  it('selects the first alive non-egg party member', () => {
    const fainted = createPokemon(152)
    fainted.currentHp = 0
    const egg = createPokemon(155)
    egg.isEgg = true
    const alive = createPokemon(158)

    expect(resolvePokemonFollowerSelection(createPokemonParty([fainted, egg, alive]), { id: 60, followMode: 2 }, createFollowerCatalog())).toMatchObject({
      slot: 2,
      pokemon: { speciesId: 158 },
      parameterIndex: 160,
      active: true,
      permitted: true,
      visible: true,
    })
  })

  it('suit immédiatement le nouvel ordre canonique de l’équipe', () => {
    const party = createPokemonParty([createPokemon(152), createPokemon(155)])
    const catalog = createFollowerCatalog()

    expect(resolvePokemonFollowerSelection(party, { id: 60, followMode: 2 }, catalog)?.pokemon.speciesId).toBe(152)
    swapPokemonPartyMembers(party, 0, 1)
    expect(resolvePokemonFollowerSelection(party, { id: 60, followMode: 2 }, catalog)).toMatchObject({
      slot: 0,
      pokemon: { speciesId: 155 },
      parameterIndex: 157,
    })
  })

  it('keeps the first non-egg identity but remains inactive when the whole party is fainted', () => {
    const first = createPokemon(152)
    first.currentHp = 0
    const second = createPokemon(155)
    second.currentHp = 0

    expect(resolvePokemonFollowerSelection(createPokemonParty([first, second]), { id: 60, followMode: 2 }, createFollowerCatalog())).toMatchObject({
      slot: 0,
      pokemon: { speciesId: 152 },
      active: false,
      permitted: true,
      visible: false,
    })
  })

  it('applies prevent, height-restricted, and allow map modes from ROM parameters', () => {
    const party = createPokemonParty([createPokemon(152)])
    const catalog = createFollowerCatalog()
    catalog.parameters[153] = { modelIndex: 153, size: 1, values: [0, 1, 0, 0] }

    expect(resolvePokemonFollowerSelection(party, { id: 60, followMode: 0 }, catalog)).toMatchObject({ permitted: false, visible: false })
    expect(resolvePokemonFollowerSelection(party, { id: 61, followMode: 1 }, catalog)).toMatchObject({ size: 1, permitted: false, visible: false })
    expect(resolvePokemonFollowerSelection(party, { id: 60, followMode: 2 }, catalog)).toMatchObject({ permitted: true, visible: true })
    expect(() => resolvePokemonFollowerSelection(party, { id: 60, followMode: 3 }, catalog)).toThrow('mode follower HGSS 3')
  })

  it('applies the native Bell Tower exception for Diglett and Dugtrio', () => {
    const diglett = createPokemon(152)
    diglett.speciesId = 50
    const party = createPokemonParty([diglett])

    expect(resolvePokemonFollowerSelection(party, { id: 111, followMode: 2 }, createFollowerCatalog())).toMatchObject({ permitted: false, visible: false })
    expect(resolvePokemonFollowerSelection(party, { id: 60, followMode: 2 }, createFollowerCatalog())).toMatchObject({ permitted: true, visible: true })
  })

  it('returns no follower when the party has no non-egg member', () => {
    const egg = createPokemon(152)
    egg.isEgg = true
    expect(resolvePokemonFollowerSelection(createPokemonParty([egg]), { id: 60, followMode: 2 }, createFollowerCatalog())).toBeUndefined()
  })
})
