import { describe, expect, it } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createNewGamePlusCreationModuleOption } from './newGamePlusCreationConfigChoices'
import { monotypeModuleId } from './modules/monotypeModule'
import { soloRunModuleId } from './modules/soloRunModule'

function inventory(): RomInventory {
  const pokemonCatalog = createPokemonTestCatalog()
  pokemonCatalog.personalData[1] = { ...pokemonCatalog.personalData[1]!, types: [10, 10] }
  pokemonCatalog.personalData[2] = { ...pokemonCatalog.personalData[2]!, types: [12, 12] }
  return {
    pokemonCatalog,
    pokedexCatalog: { typeNames: Array.from({ length: 18 }, (_, id) => `TYPE ${id}`) },
  } as RomInventory
}

describe('choix de configuration à la création NG+', () => {
  it('propose seulement les types possédant une espèce complète et place la valeur par défaut en premier', () => {
    const option = createNewGamePlusCreationModuleOption({
      id: monotypeModuleId, title: 'Monotype', description: 'Test', enabledByDefault: false,
      defaultConfig: { typeId: 12 },
    }, inventory())
    expect(option.configChoices).toHaveLength(3)
    expect(option.configChoices[0]).toEqual({ label: 'TYPE 12', config: { typeId: 12 } })
    expect(option.configChoices).not.toContainEqual({ label: 'TYPE 9', config: { typeId: 9 } })
  })

  it('ne propose que les espèces réellement présentes dans le catalogue ROM', () => {
    const option = createNewGamePlusCreationModuleOption({
      id: soloRunModuleId, title: 'Solo', description: 'Test', enabledByDefault: false,
      defaultConfig: { speciesId: 152, form: 0 },
    }, inventory())
    expect(option.configChoices[0]).toMatchObject({ config: { speciesId: 152, form: 0 } })
    expect(option.configChoices.every(({ config }) => {
      const speciesId = (config as { speciesId: number }).speciesId
      return speciesId >= 1 && speciesId <= 493
    })).toBe(true)
  })
})
