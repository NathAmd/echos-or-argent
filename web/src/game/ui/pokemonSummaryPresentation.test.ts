import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createPokemonSummaryModel, movePokemonSummaryPage } from './pokemonSummaryPresentation'

describe('Pokémon summary presentation model', () => {
  it('uses only catalog-backed ROM names and cumulative experience', () => {
    const catalog = createPokemonTestCatalog()
    catalog.natureNames = Array.from({ length: 25 }, (_, id) => `Nature ${id}`)
    catalog.abilityNames = Array.from({ length: 124 }, (_, id) => `Talent ${id}`)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152, level: 5, rng: createHgssLcrng(1), personality: { kind: 'fixed', value: 0 },
      individualValues: { kind: 'fixed', value: 1 },
      originalTrainer: { id: 123, name: 'LUTH', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    const model = createPokemonSummaryModel(pokemon, catalog, { typeNames: Array.from({ length: 18 }, (_, id) => `Type ${id}`) })
    expect(model).toMatchObject({ natureName: 'Nature 0', trainerName: 'LUTH', trainerId: '00123', level: 5 })
    expect(model.moves[0]?.name).toBe(catalog.moveNames[model.moves[0]!.moveId])
  })

  it('wraps tabs in both directions without rebuilding game state', () => {
    expect(movePokemonSummaryPage('profile', -1)).toBe('ribbons')
    expect(movePokemonSummaryPage('ribbons', 1)).toBe('profile')
  })

  it('rejects missing localized ROM names', () => {
    const catalog = createPokemonTestCatalog()
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 152, level: 5, rng: createHgssLcrng(1), personality: { kind: 'fixed', value: 0 },
      individualValues: { kind: 'fixed', value: 1 },
      originalTrainer: { id: 1, name: 'LUTH', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    expect(() => createPokemonSummaryModel(pokemon, catalog, { typeNames: [] })).toThrow('nom ROM')
  })
})
