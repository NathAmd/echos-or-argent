import { describe, expect, it, vi } from 'vitest'
import { createNewGamePlusRegistry } from '../newGamePlusRegistry'
import {
  decodeVisibleWildPokemonConfig,
  defaultVisibleWildPokemonConfig,
  visibleWildPokemonModule,
  visibleWildPokemonModuleId,
} from './visibleWildPokemonModule'

describe('module de profil Pokémon visibles', () => {
  it('reste optionnel et expose des valeurs par défaut explicites', () => {
    const registry = createNewGamePlusRegistry([visibleWildPokemonModule])
    expect(visibleWildPokemonModule.enabledByDefault).toBe(false)
    expect(registry.listModules()).toEqual([{
      id: visibleWildPokemonModuleId,
      revision: 1,
      title: 'Pokémon visibles',
      description: 'Matérialise des rencontres sauvages préparées comme acteurs du monde, y compris au Safari si demandé.',
      enabledByDefault: false,
      defaultConfig: defaultVisibleWildPokemonConfig,
    }])
  })

  it('valide exactement seed, densité, Safari et mouvement', () => {
    const config = decodeVisibleWildPokemonConfig({
      seed: 'Johto-visible-2026',
      actorsPerMap: 4,
      includeSafari: false,
      movement: 'stationary',
    })
    expect(config).toEqual({
      seed: 'Johto-visible-2026',
      seedSource: 'config-text',
      actorsPerMap: 4,
      includeSafari: false,
      movement: 'stationary',
    })
    expect(Object.isFrozen(config)).toBe(true)

    const accessor = Object.defineProperty({}, 'seed', { enumerable: true, get: vi.fn(() => 'secret') })
    for (const invalid of [
      null,
      {},
      { ...defaultVisibleWildPokemonConfig, seed: '' },
      { ...defaultVisibleWildPokemonConfig, seed: ' seed' },
      { ...defaultVisibleWildPokemonConfig, actorsPerMap: 0 },
      { ...defaultVisibleWildPokemonConfig, actorsPerMap: 9 },
      { ...defaultVisibleWildPokemonConfig, includeSafari: 'yes' },
      { ...defaultVisibleWildPokemonConfig, movement: 'random' },
      { ...defaultVisibleWildPokemonConfig, seedSource: 'rom-text' },
      { ...defaultVisibleWildPokemonConfig, secret: true },
      Object.create(defaultVisibleWildPokemonConfig),
      accessor,
    ]) expect(() => decodeVisibleWildPokemonConfig(invalid)).toThrow()
  })
})
