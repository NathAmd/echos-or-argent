import { describe, expect, it } from 'vitest'
import { decodeHgssItemData, hgssItemDataSize, hgssItemPocketLabels, type HgssItemCatalog, type HgssItemPocket } from '../../rom/items/itemData'
import { addBagItem, canAddBagItem, getBagItemQuantity, hasBagItem, hgssBagPocketCapacities, takeBagItem, validateBagInventoryEntries } from './bagInventory'

function createCatalog(pockets: ReadonlyMap<number, HgssItemPocket>): HgssItemCatalog {
  return {
    pocketNames: hgssItemPocketLabels,
    items: Array.from({ length: 537 }, (_, itemId) => {
      const payload = new Uint8Array(hgssItemDataSize)
      new DataView(payload.buffer).setUint16(8, (pockets.get(itemId) ?? 0) << 7, true)
      return decodeHgssItemData(payload, itemId, `OBJET ${itemId}`, 'Description')
    }),
  }
}

describe('HGSS bag inventory', () => {
  it('applique les piles 999 et 99 des CT/CS', () => {
    const catalog = createCatalog(new Map([[328, 3]]))
    const inventory = new Map([[17, 998], [328, 99]])

    expect(addBagItem(inventory, catalog, 17, 1)).toBe(true)
    expect(addBagItem(inventory, catalog, 17, 1)).toBe(false)
    expect(canAddBagItem(inventory, catalog, 328, 1)).toBe(false)
    expect(inventory.get(328)).toBe(99)
  })

  it('refuse un nouvel identifiant lorsque sa poche n’a plus de slot', () => {
    const catalog = createCatalog(new Map())
    const capacity = hgssBagPocketCapacities[0]
    const inventory = new Map(Array.from({ length: capacity }, (_, index) => [index + 1, 1]))

    expect(canAddBagItem(inventory, catalog, capacity + 1, 1)).toBe(false)
    expect(addBagItem(inventory, catalog, capacity + 1, 1)).toBe(false)
  })

  it('retire atomiquement et ne considère pas une quantité zéro comme un objet possédé', () => {
    const inventory = new Map([[17, 2]])
    expect(getBagItemQuantity(inventory, 17)).toBe(2)
    expect(getBagItemQuantity(inventory, 18)).toBe(0)
    expect(hasBagItem(inventory, 18, 0)).toBe(false)
    expect(takeBagItem(inventory, 17, 3)).toBe(false)
    expect(inventory.get(17)).toBe(2)
    expect(takeBagItem(inventory, 17, 2)).toBe(true)
    expect(inventory.has(17)).toBe(false)
  })

  it('rejette les snapshots impossibles avant de reconstruire la Map', () => {
    const catalog = createCatalog(new Map([[328, 3]]))
    expect(() => validateBagInventoryEntries([[328, 100]], catalog, 'field.inventory')).toThrow('field.inventory[0][1]')
    expect(() => validateBagInventoryEntries([[17, 1], [17, 1]], catalog, 'field.inventory')).toThrow('en double')
    expect(() => validateBagInventoryEntries([[0, 1]], catalog, 'field.inventory')).toThrow('ITEM_NONE')
  })
})
