import { describe, expect, it } from 'vitest'
import { createHgssPokedex } from '../pokedex/hgssPokedex'
import { createCanonicalPokemon } from './canonicalPokemon'
import { hatchHgssPartyEgg, findHgssHatchableEggSlot } from './hgssEggHatching'
import { createHgssLcrng } from './hgssPokemonRng'
import { createPokemonParty } from './pokemonParty'
import { createPokemonTestCatalog } from './pokemonTestCatalog'

describe('HGSS egg hatching', () => {
  it("reproduit la mutation PK4, le mémo d'éclosion et le Pokédex", () => {
    const catalog = createPokemonTestCatalog(175)
    const trainer = { id: 42, name: 'JO', gender: 'male' as const }
    const egg = createCanonicalPokemon(catalog, {
      speciesId: 175,
      level: 1,
      rng: createHgssLcrng(7),
      personality: { kind: 'fixed', value: 0x12345678 },
      individualValues: { kind: 'fixed', value: 20 },
      originalTrainer: trainer,
      origin: {
        language: 3,
        gameVersion: 7,
        metLocation: 2013,
        metLevel: 0,
        metTerrain: 0,
        metDate: { year: 2026, month: 8, day: 1 },
      },
      friendship: 0,
      ballId: 4,
    })
    egg.isEgg = true
    egg.nickname = 'ŒUF'
    egg.nicknameSource = 'local-ref'
    egg.status = 4
    egg.currentHp = 1
    const party = createPokemonParty([egg])
    const pokedex = createHgssPokedex({ enabled: true })

    expect(findHgssHatchableEggSlot(party)).toBe(0)
    const result = hatchHgssPartyEgg(party, 0, {
      catalog,
      pokedex,
      trainer,
      language: 3,
      gameVersion: 7,
      mapSection: 126,
      now: new Date(2026, 7, 15),
      togepiEggIdentity: { personality: egg.personality, gender: egg.gender },
    })

    expect(result.isMrPokemonTogepi).toBe(true)
    expect(result.pokemon).toMatchObject({
      speciesId: 175,
      isEgg: false,
      nickname: undefined,
      nicknameSource: undefined,
      friendship: 120,
      status: 0,
      ballId: 4,
      origin: {
        eggLocation: 2013,
        eggDate: { year: 2026, month: 8, day: 1 },
        metLocation: 126,
        metLevel: 0,
        metTerrain: 6,
        metDate: { year: 2026, month: 8, day: 15 },
      },
    })
    expect(result.pokemon.currentHp).toBe(result.pokemon.stats.hp)
    expect(pokedex.seenSpeciesIds.has(175)).toBe(true)
    expect(pokedex.caughtSpeciesIds.has(175)).toBe(true)
  })

  it('marque uniquement le surnom saisi à l’éclosion comme texte joueur', () => {
    const catalog = createPokemonTestCatalog(175)
    const trainer = { id: 42, name: 'JO', gender: 'male' as const }
    const egg = createCanonicalPokemon(catalog, {
      speciesId: 175, level: 1, rng: createHgssLcrng(8),
      personality: { kind: 'fixed', value: 123 }, individualValues: { kind: 'fixed', value: 1 },
      originalTrainer: trainer,
      origin: { language: 3, gameVersion: 7, metLocation: 2013, metLevel: 0, metTerrain: 0 },
      friendship: 0, ballId: 4,
    })
    egg.isEgg = true
    egg.nickname = 'ŒUF'
    egg.nicknameSource = 'local-ref'

    const result = hatchHgssPartyEgg(createPokemonParty([egg]), 0, {
      catalog, pokedex: createHgssPokedex(), trainer, language: 3, gameVersion: 7,
      mapSection: 126, now: new Date(2026, 7, 15), nickname: 'ETOILE',
    })

    expect(result.pokemon).toMatchObject({ nickname: 'ETOILE', nicknameSource: 'user-text' })
  })

  it("refuse un œuf qui n'est pas arrivé à zéro cycle", () => {
    const catalog = createPokemonTestCatalog(175)
    const egg = createCanonicalPokemon(catalog, {
      speciesId: 175,
      level: 1,
      rng: createHgssLcrng(1),
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 2013, metLevel: 0, metTerrain: 0 },
      friendship: 1,
      ballId: 4,
    })
    egg.isEgg = true
    const party = createPokemonParty([egg])

    expect(findHgssHatchableEggSlot(party)).toBeUndefined()
    expect(() => hatchHgssPartyEgg(party, 0, {
      catalog,
      pokedex: createHgssPokedex(),
      trainer: egg.originalTrainer,
      language: 3,
      gameVersion: 7,
      mapSection: 1,
      now: new Date(),
    })).toThrow(/prêt à éclore/)
  })
})
