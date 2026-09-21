import { describe, expect, it, vi } from 'vitest'
import type { NitroGraphic, RomInventory } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { hgssPokedexMagic, type HgssPokedexState } from '../pokedex/hgssPokedex'
import { resolveUtilityMenuRomAsset, type UtilityMenuRomAssetContext } from './utilityMenuRomAsset'

function canvas(): HTMLCanvasElement {
  return { dataset: {} } as HTMLCanvasElement
}

function createPokedex(): HgssPokedexState {
  return {
    magic: hgssPokedexMagic,
    seenSpeciesIds: new Set([1]),
    caughtSpeciesIds: new Set([1]),
    caughtShinySpeciesIds: new Set([1]),
    seenGenders: new Map([[1, ['female']]]),
    spindaPersonality: 0,
    seenForms: new Map([[1, [2]]]),
    caughtUnownForms: [],
    caughtLanguages: new Map(),
    canDetectForms: true,
    internationalViewEnabled: false,
    enabled: true,
    nationalDexEnabled: false,
  }
}

function createContext(overrides: Partial<UtilityMenuRomAssetContext> = {}) {
  const graphics = new Map<number, NitroGraphic>([
    [17, { width: 1, height: 1 } as NitroGraphic],
    [18, { width: 1, height: 1 } as NitroGraphic],
  ])
  const inventory = {
    pokemonCatalog: {
      speciesNames: ['', 'Germignon'],
      personalData: [undefined, { types: [0, 0] }],
    },
    pokedexCatalog: {
      johtoDexNumbers: [0, 1],
      typeNames: ['Plante'],
      categoryNames: [],
      heightLabels: [],
      weightLabels: [],
      heartGoldDescriptions: [],
    },
    itemCatalog: {
      items: Object.assign([], {
        17: { itemId: 17, fieldPocket: 0 },
        18: { itemId: 18, fieldPocket: 1 },
      }),
    },
    itemIconResolver: (itemId: number) => graphics.get(itemId)!,
  } as unknown as RomInventory
  const party = [{
    speciesId: 1,
    form: 0,
    isEgg: false,
    shiny: false,
    gender: 'female',
    currentHp: 0,
  }] as CanonicalPokemon[]
  const createPokemonCanvas = vi.fn(() => canvas())
  const createGraphicCanvas = vi.fn(() => canvas())
  return {
    context: {
      inventory,
      party,
      bagInventory: new Map([[17, 2], [18, 1]]),
      pokedex: createPokedex(),
      selectedPokedexSpeciesId: 1,
      selectedBagItemId: 17,
      createPokemonCanvas,
      createGraphicCanvas,
      ...overrides,
    } satisfies UtilityMenuRomAssetContext,
    createPokemonCanvas,
    createGraphicCanvas,
  }
}

describe('resolveUtilityMenuRomAsset', () => {
  it('ne consulte aucun catalogue tant que la ROM est absente', () => {
    const fixture = createContext({ inventory: undefined })
    expect(resolveUtilityMenuRomAsset({ id: 'team', label: '', kind: 'screen' }, fixture.context)).toBeUndefined()
    expect(fixture.createPokemonCanvas).not.toHaveBeenCalled()
  })

  it('rend les Pokémon de l’équipe et marque ceux qui sont K.O.', () => {
    const fixture = createContext()
    const result = resolveUtilityMenuRomAsset({ id: 'team-member:0', label: '', kind: 'command' }, fixture.context)
    expect(fixture.createPokemonCanvas).toHaveBeenCalledWith(1, 0, false, false, 'female')
    expect(result?.dataset.romAssetState).toBe('fainted')
  })

  it('rend le Pokémon sélectionné du Pokédex avec son état ROM', () => {
    const fixture = createContext()
    const result = resolveUtilityMenuRomAsset({ id: 'pokedex', label: '', kind: 'screen' }, fixture.context)
    expect(fixture.createPokemonCanvas).toHaveBeenCalledWith(1, 2, false, true, 'female')
    expect(result?.dataset.romAssetState).toBe('caught')
  })

  it.each([
    ['bag', 17],
    ['bag-pocket:1', 18],
    ['bag-item:17', 17],
    ['bag-action-use:18', 18],
    ['bag-bike:17', 17],
    ['bag-use-party:18', 18],
  ] as const)('résout l’icône objet de %s', (id, expectedItemId) => {
    const fixture = createContext()
    resolveUtilityMenuRomAsset({ id, label: '', kind: id === 'bag' ? 'screen' : 'command' }, fixture.context)
    expect(fixture.createGraphicCanvas).toHaveBeenCalledOnce()
    expect(fixture.context.inventory?.itemIconResolver(expectedItemId)).toBeDefined()
  })

  it('résout la cible Pokémon des actions de Sac', () => {
    const fixture = createContext()
    resolveUtilityMenuRomAsset({ id: 'bag-machine-replace:17:0:3', label: '', kind: 'command' }, fixture.context)
    expect(fixture.createPokemonCanvas).toHaveBeenCalledWith(1, 0, false, false, 'female')
  })
})
