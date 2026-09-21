import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createBattleMoveLearningModel, formatMoveReplacementConfirmation } from './battleMoveLearningPresentation'

function fixture() {
  const catalog = createPokemonTestCatalog()
  const pokemon = createCanonicalPokemon(catalog, {
    speciesId: 152,
    level: 30,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 0 },
    individualValues: { kind: 'fixed', value: 1 },
    originalTrainer: { id: 1, name: 'LUTH', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    ballId: 4,
  })
  return { catalog, pokemon, typeNames: Array.from({ length: 18 }, (_, id) => `Type ${id}`) }
}

describe('apprentissage visuel des capacités', () => {
  it('expose uniquement les noms, types et statistiques du catalogue ROM', () => {
    const { catalog, pokemon, typeNames } = fixture()
    const moveId = 33
    const model = createBattleMoveLearningModel(pokemon, moveId, catalog, typeNames)
    expect(model.newMoveName).toBe(catalog.moveNames[moveId])
    expect(model.newMoveDetail).toContain(typeNames[catalog.moves[moveId]!.type])
    expect(model.choices).toHaveLength(pokemon.moves.length)
    expect(model.choices[0]?.name).toBe(catalog.moveNames[pokemon.moves[0]!.moveId])
  })

  it('refuse un nom localisé manquant au lieu d’en inventer un', () => {
    const { catalog, pokemon, typeNames } = fixture()
    catalog.moveNames[33] = ''
    expect(() => createBattleMoveLearningModel(pokemon, 33, catalog, typeNames)).toThrow('nom ROM')
  })

  it('formule explicitement le remplacement avant la confirmation préselectionnée sur Non', () => {
    expect(formatMoveReplacementConfirmation('Effacer une ancienne capacité pour {106 1,0}?', 'TRANCH’HERBE')).toBe(
      'Effacer une ancienne capacité pour TRANCH’HERBE?',
    )
  })

  it('retire aussi les contrôles de présentation ROM de la confirmation', () => {
    expect(formatMoveReplacementConfirmation('{205}Effacer {106 1,0}?{202 2}', 'CHARGE')).toBe('Effacer CHARGE?')
  })
})
