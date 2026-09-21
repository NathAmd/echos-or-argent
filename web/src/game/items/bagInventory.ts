import { getHgssItem, type HgssItemCatalog, type HgssItemData, type HgssItemPocket } from '../../rom/items/itemData'

export const hgssBagPocketCapacities: Readonly<Record<HgssItemPocket, number>> = {
  0: 165,
  1: 40,
  2: 24,
  3: 101,
  4: 64,
  5: 12,
  6: 30,
  7: 50,
}

export function getHgssBagQuantityLimit(item: HgssItemData): number {
  return item.fieldPocket === 3 ? 99 : 999
}

function validateQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 0xffff) {
    throw new Error(`La quantité d’objet HGSS ${quantity} est invalide.`)
  }
}

export function hasBagItem(inventory: ReadonlyMap<number, number>, itemId: number, quantity: number): boolean {
  validateQuantity(quantity)
  const current = inventory.get(itemId) ?? 0
  return current > 0 && current >= quantity
}

export function getBagItemQuantity(inventory: ReadonlyMap<number, number>, itemId: number): number {
  if (!Number.isInteger(itemId) || itemId < 0) throw new Error(`L’identifiant d’objet HGSS ${itemId} est invalide.`)
  return inventory.get(itemId) ?? 0
}

export function canAddBagItem(
  inventory: ReadonlyMap<number, number>,
  catalog: HgssItemCatalog,
  itemId: number,
  quantity: number,
): boolean {
  validateQuantity(quantity)
  if (itemId === 0) return false
  const item = getHgssItem(catalog, itemId)
  const current = inventory.get(itemId) ?? 0
  if (current > 0) return current + quantity <= getHgssBagQuantityLimit(item)
  const occupiedSlots = [...inventory].filter(([storedItemId, storedQuantity]) => (
    storedQuantity > 0 && getHgssItem(catalog, storedItemId).fieldPocket === item.fieldPocket
  )).length
  return occupiedSlots < hgssBagPocketCapacities[item.fieldPocket]
}

export function addBagItem(
  inventory: Map<number, number>,
  catalog: HgssItemCatalog,
  itemId: number,
  quantity: number,
): boolean {
  if (!canAddBagItem(inventory, catalog, itemId, quantity)) return false
  if (quantity > 0) inventory.set(itemId, (inventory.get(itemId) ?? 0) + quantity)
  return true
}

export function takeBagItem(inventory: Map<number, number>, itemId: number, quantity: number): boolean {
  if (!hasBagItem(inventory, itemId, quantity)) return false
  const remaining = inventory.get(itemId)! - quantity
  if (remaining === 0) inventory.delete(itemId)
  else inventory.set(itemId, remaining)
  return true
}

export function validateBagInventoryEntries(
  entries: readonly (readonly [number, number])[],
  catalog: HgssItemCatalog,
  path = 'inventory',
): void {
  const seen = new Set<number>()
  const pocketCounts = new Map<HgssItemPocket, number>()
  entries.forEach(([itemId, quantity], index) => {
    if (itemId === 0) throw new Error(`L’inventaire HGSS contient ITEM_NONE à ${path}[${index}][0].`)
    if (seen.has(itemId)) throw new Error(`L’inventaire HGSS contient l’objet ${itemId} en double à ${path}[${index}][0].`)
    seen.add(itemId)
    const item = getHgssItem(catalog, itemId)
    const maximum = getHgssBagQuantityLimit(item)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
      throw new Error(`L’inventaire HGSS contient une quantité invalide à ${path}[${index}][1] (${quantity}, maximum ${maximum}).`)
    }
    pocketCounts.set(item.fieldPocket, (pocketCounts.get(item.fieldPocket) ?? 0) + 1)
  })
  for (const [pocket, count] of pocketCounts) {
    if (count > hgssBagPocketCapacities[pocket]) {
      throw new Error(`L’inventaire HGSS dépasse la capacité de la poche ${pocket} à ${path} (${count}/${hgssBagPocketCapacities[pocket]}).`)
    }
  }
}
