import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { decodeHgssItemData, hgssItemDataSize, hgssItemPocketLabels, type HgssItemCatalog, type HgssItemPocket } from '../../rom/items/itemData'
import { createBagMenuModel } from './bagMenuModel'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'

function createItem(itemId: number, pocket: HgssItemPocket, hpRestore = false) {
  const payload = new Uint8Array(hgssItemDataSize)
  new DataView(payload.buffer).setUint16(8, pocket << 7, true)
  if (hpRestore) {
    payload[0x0c] = 1
    payload[0x13] = 0x04
    payload[0x1b] = 20
  }
  return decodeHgssItemData(payload, itemId, `OBJET ${itemId}`, 'Description')
}

function createCatalog(): HgssItemCatalog {
  const items = Array.from({ length: 537 }) as HgssItemCatalog['items']
  items[4] = createItem(4, 2)
  items[17] = createItem(17, 1, true)
  items[18] = createItem(18, 1)
  items[94] = createItem(94, 0)
  items[328] = createItem(328, 3)
  items[420] = createItem(420, 3)
  return { items, pocketNames: hgssItemPocketLabels }
}

const pokemonCatalog = createPokemonTestCatalog()

const pokemon = {
  speciesName: 'GERMIGNON',
  moves: [{ moveId: 33 }],
} as CanonicalPokemon

describe('createBagMenuModel', () => {
  it('sépare les objets dans les poches HGSS non vides', () => {
    const model = createBagMenuModel(new Map([[4, 3], [17, 2], [18, 1]]), createCatalog(), [pokemon], pokemonCatalog, {})

    expect(model).toMatchObject({ selectedPocket: 1, selectedItemId: 17 })
    expect(model.items.map(({ id }) => id)).toEqual([
      'bag-pocket:1', 'bag-pocket:2', 'bag-item:17', 'bag-item:18', 'bag-action-use:17', 'bag-action-give:17', 'bag-action-cancel:17',
    ])
    expect(model.items[0]?.label).toBe('MEDICAMENTS (2)')
  })

  it('change de poche et ne montre que ses objets', () => {
    const model = createBagMenuModel(new Map([[4, 3], [17, 2]]), createCatalog(), [pokemon], pokemonCatalog, { pocket: 2, itemId: 17 })

    expect(model).toMatchObject({ selectedPocket: 2, selectedItemId: 4 })
    expect(model.items.map(({ id }) => id)).toEqual(['bag-pocket:1', 'bag-pocket:2', 'bag-item:4', 'bag-action-give:4', 'bag-action-cancel:4'])
  })

  it('retombe sur le premier objet restant après consommation du dernier exemplaire', () => {
    const model = createBagMenuModel(new Map([[18, 1]]), createCatalog(), [pokemon], pokemonCatalog, { pocket: 1, itemId: 17 })

    expect(model).toMatchObject({ selectedPocket: 1, selectedItemId: 18 })
    expect(model.items.map(({ id }) => id)).toEqual(['bag-pocket:1', 'bag-item:18', 'bag-action-give:18', 'bag-action-cancel:18'])
  })

  it('rend un Sac vide sans sélection fantôme', () => {
    expect(createBagMenuModel(new Map(), createCatalog(), [], pokemonCatalog, { pocket: 1, itemId: 17 })).toEqual({ items: [] })
  })

  it('propose une cible compatible puis un remplacement explicite pour une CT', () => {
    pokemonCatalog.moves[264] = { ...pokemonCatalog.moves[33]!, moveId: 264, pp: 20, power: 70 }
    pokemonCatalog.moveNames[264] = 'MITRA-POING'
    pokemonCatalog.personalData[152] = { ...pokemonCatalog.personalData[152]!, tmHmCompatibility: [1, 0, 0, 0] }
    const target = {
      ...pokemon,
      speciesId: 152,
      form: 0,
      isEgg: false,
      moves: [33, 33, 33, 33].map((moveId) => ({ moveId, pp: 35, maxPp: 35, ppUps: 0, data: pokemonCatalog.moves[moveId]! })),
    } as CanonicalPokemon

    const choiceModel = createBagMenuModel(new Map([[328, 1]]), createCatalog(), [target], pokemonCatalog, { itemId: 328 })
    expect(choiceModel.items.map(({ id }) => id)).toContain('bag-action-use:328')
    expect(choiceModel.items.find(({ id }) => id === 'bag-item:328')?.label).toBe('OBJET 328 · MITRA-POING × 1')
    const targetModel = createBagMenuModel(new Map([[328, 1]]), createCatalog(), [target], pokemonCatalog, { itemId: 328, action: 'use' })
    expect(targetModel.items.map(({ id }) => id)).toContain('bag-machine-target:328:0')
    const replacementModel = createBagMenuModel(new Map([[328, 1]]), createCatalog(), [target], pokemonCatalog, { itemId: 328, machinePartySlot: 0 })
    expect(replacementModel.items.map(({ id }) => id)).toEqual([
      'bag-pocket:3', 'bag-item:328',
      'bag-machine-replace:328:0:0', 'bag-machine-replace:328:0:1',
      'bag-machine-replace:328:0:2', 'bag-machine-replace:328:0:3',
      'bag-machine-cancel:328:0',
    ])
    expect(replacementModel.items.find(({ id }) => id === 'bag-machine-replace:328:0:0')?.label).toBe(pokemonCatalog.moveNames[33])
  })

  it('sépare le choix Utiliser ou Donner de la sélection du Pokémon', () => {
    const inventory = new Map([[17, 2]])
    const choice = createBagMenuModel(inventory, createCatalog(), [pokemon], pokemonCatalog, { itemId: 17 })
    const useTargets = createBagMenuModel(inventory, createCatalog(), [pokemon], pokemonCatalog, { itemId: 17, action: 'use' })
    const giveTargets = createBagMenuModel(inventory, createCatalog(), [pokemon], pokemonCatalog, { itemId: 17, action: 'give' })

    expect(choice.items.map(({ id }) => id).filter((id) => id.startsWith('bag-action-'))).toEqual(['bag-action-use:17', 'bag-action-give:17', 'bag-action-cancel:17'])
    expect(useTargets.items.map(({ id }) => id).filter((id) => id.startsWith('bag-use:'))).toEqual(['bag-use:17:0'])
    expect(giveTargets.items.map(({ id }) => id).filter((id) => id.startsWith('bag-give:'))).toEqual(['bag-give:17:0'])
  })

  it('route le Miel vers le Task partagé de rencontre forcée sans cible Pokémon', () => {
    const choice = createBagMenuModel(new Map([[94, 2]]), createCatalog(), [pokemon], pokemonCatalog, { itemId: 94 })
    const use = createBagMenuModel(new Map([[94, 2]]), createCatalog(), [pokemon], pokemonCatalog, { itemId: 94, action: 'use' })

    expect(choice.items.map(({ id }) => id)).toContain('bag-action-use:94')
    expect(use.items.map(({ id }) => id)).toContain('bag-sweet-scent:94')
    expect(use.items.some(({ id }) => id.startsWith('bag-use:'))).toBe(false)
  })
})
