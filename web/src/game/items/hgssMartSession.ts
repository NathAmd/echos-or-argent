import type { HgssItemCatalog, HgssItemPocket } from '../../rom/items/itemData'
import { addBagItem, canAddBagItem, getBagItemQuantity, takeBagItem } from './bagInventory'

export const hgssMartExitChoice = 0xfffe
export const hgssMartConfirmNoChoice = 0xfffa
export const hgssMartConfirmYesChoice = 0xfffb

export type HgssMartMode = 'buy' | 'sell'
export type HgssMartPhase = 'browse' | 'quantity' | 'confirm'
export type HgssMartSession = { itemIds: number[], mode: HgssMartMode, phase: HgssMartPhase, selection?: { itemId: number, quantity: number } }
export type HgssMartChoiceOption = {
  label?: string
  value: number
  itemId?: number
  price?: number
  quantity?: number
  description?: string
  pocket?: HgssItemPocket
  pocketLabel?: string
}
export type HgssMartTransaction = {
  itemId: number
  itemName: string
  pocketLabel: string
  unitPrice: number
  quantity: number
  maxQuantity: number
  total: number
}
export type HgssMartView = { mode: HgssMartMode, phase: HgssMartPhase, balance: number, options: HgssMartChoiceOption[], transaction?: HgssMartTransaction }

export function createHgssMartSession(itemIds: readonly number[], mode: HgssMartMode): HgssMartSession {
  return { itemIds: [...itemIds], mode, phase: 'browse' }
}

/** La routine native vend les objets à la moitié de leur prix, tronquée à l'entier. */
export function getHgssMartSellPrice(price: number): number {
  return Math.max(0, Math.floor(price / 2))
}

function itemOption(itemCatalog: HgssItemCatalog, inventory: ReadonlyMap<number, number>, itemId: number, price: number): HgssMartChoiceOption {
  const item = itemCatalog.items[itemId]
  if (!item) throw new Error(`L'objet ROM ${itemId} de la boutique HGSS est absent.`)
  return {
    label: item.name, value: itemId, itemId, price, quantity: getBagItemQuantity(inventory, itemId), description: item.description,
    pocket: item.fieldPocket, pocketLabel: itemCatalog.pocketNames[item.fieldPocket],
  }
}

function clearSelection(session: HgssMartSession): void {
  session.phase = 'browse'
  session.selection = undefined
}

function getSelectedItem(session: HgssMartSession, itemCatalog: HgssItemCatalog) {
  const itemId = session.selection?.itemId
  const item = itemId === undefined ? undefined : itemCatalog.items[itemId]
  if (!item || itemId === undefined) throw new Error('La transaction HGSS active ne référence aucun objet ROM.')
  return item
}

export function getHgssMartMaximumQuantity(session: HgssMartSession, inventory: ReadonlyMap<number, number>, itemCatalog: HgssItemCatalog, balance: number): number {
  const item = getSelectedItem(session, itemCatalog)
  if (session.mode === 'sell') return getBagItemQuantity(inventory, item.itemId)
  let maximum = Math.min(99, item.price > 0 ? Math.floor(balance / item.price) : 99)
  while (maximum > 0 && !canAddBagItem(inventory, itemCatalog, item.itemId, maximum)) maximum -= 1
  return maximum
}

function createTransaction(session: HgssMartSession, inventory: ReadonlyMap<number, number>, itemCatalog: HgssItemCatalog, balance: number): HgssMartTransaction {
  const item = getSelectedItem(session, itemCatalog)
  const unitPrice = session.mode === 'buy' ? item.price : getHgssMartSellPrice(item.price)
  const quantity = session.selection!.quantity
  return {
    itemId: item.itemId, itemName: item.name, pocketLabel: itemCatalog.pocketNames[item.fieldPocket] ?? '', unitPrice, quantity,
    maxQuantity: getHgssMartMaximumQuantity(session, inventory, itemCatalog, balance), total: unitPrice * quantity,
  }
}

export function createHgssMartView(session: HgssMartSession, inventory: ReadonlyMap<number, number>, itemCatalog: HgssItemCatalog, balance: number): HgssMartView {
  if (session.phase !== 'browse') {
    const transaction = createTransaction(session, inventory, itemCatalog, balance)
    const options = session.phase === 'confirm'
      ? [{ value: hgssMartConfirmNoChoice }, { value: hgssMartConfirmYesChoice }]
      : []
    return { mode: session.mode, phase: session.phase, balance, options, transaction }
  }
  const itemIds = session.mode === 'buy'
    ? [...session.itemIds]
    : [...inventory].flatMap(([itemId, quantity]) => {
      const item = itemCatalog.items[itemId]
      return quantity > 0 && item && getHgssMartSellPrice(item.price) > 0 ? [itemId] : []
    })
  itemIds.sort((left, right) => {
    const leftItem = itemCatalog.items[left]
    const rightItem = itemCatalog.items[right]
    if (!leftItem || !rightItem) throw new Error(`Un objet ROM de la boutique HGSS est absent (${left}, ${right}).`)
    const pocketOrder = leftItem.fieldPocket - rightItem.fieldPocket
    return pocketOrder || left - right
  })
  const options = itemIds.map((itemId) => {
    const item = itemCatalog.items[itemId]
    if (!item) throw new Error(`L'objet ROM ${itemId} de la boutique HGSS est absent.`)
    return itemOption(itemCatalog, inventory, itemId, session.mode === 'buy' ? item.price : getHgssMartSellPrice(item.price))
  })
  options.push({ value: hgssMartExitChoice })
  return { mode: session.mode, phase: session.phase, balance, options }
}

export function enterHgssMartQuantity(session: HgssMartSession, value: number | undefined, inventory: ReadonlyMap<number, number>, itemCatalog: HgssItemCatalog, balance: number): void {
  if (session.phase !== 'quantity') throw new Error("La boutique HGSS n'attend aucune quantité.")
  if (value === undefined) { clearSelection(session); return }
  const quantity = Math.trunc(value)
  const maximum = getHgssMartMaximumQuantity(session, inventory, itemCatalog, balance)
  if (quantity < 1 || quantity > maximum) throw new Error(`La quantité de boutique HGSS ${quantity} est hors limites (1-${maximum}).`)
  session.selection!.quantity = quantity
  session.phase = 'confirm'
}

export function chooseHgssMartOption(
  session: HgssMartSession,
  value: number,
  inventory: Map<number, number>,
  itemCatalog: HgssItemCatalog,
  balance: number,
): { balance: number, closed: boolean } {
  if (session.phase === 'browse' && value === hgssMartExitChoice) return { balance, closed: true }
  if (session.phase === 'confirm' && (value === hgssMartConfirmNoChoice || value === hgssMartExitChoice)) {
    clearSelection(session)
    return { balance, closed: false }
  }
  if (session.phase === 'quantity') throw new Error("La boutique HGSS attend une quantité, pas un choix.")
  if (session.phase === 'confirm' && value !== hgssMartConfirmYesChoice) throw new Error(`La confirmation de boutique HGSS ${value} est invalide.`)
  if (session.phase === 'browse') {
    const item = itemCatalog.items[value]
    if (!item) throw new Error(`L'objet ROM ${value} de la boutique HGSS est absent.`)
    if (session.mode === 'buy' && !session.itemIds.includes(value)) throw new Error(`L'objet ${value} n'est pas vendu dans cette boutique HGSS.`)
    session.selection = { itemId: value, quantity: 1 }
    if (getHgssMartMaximumQuantity(session, inventory, itemCatalog, balance) > 0) session.phase = 'quantity'
    else session.selection = undefined
    return { balance, closed: false }
  }
  const selection = session.selection!
  const valueItemId = selection.itemId
  const quantity = selection.quantity
  const item = itemCatalog.items[valueItemId]
  if (!item) throw new Error(`L'objet ROM ${valueItemId} de la boutique HGSS est absent.`)
  if (session.mode === 'buy') {
    if (balance < item.price * quantity || !addBagItem(inventory, itemCatalog, valueItemId, quantity)) throw new Error(`L'achat HGSS de ${quantity} objet(s) ${valueItemId} est impossible.`)
    balance -= item.price * quantity
  } else {
    const price = getHgssMartSellPrice(item.price)
    if (price <= 0 || !takeBagItem(inventory, valueItemId, quantity)) throw new Error(`L'objet ${valueItemId} ne peut pas être vendu dans cette boutique HGSS.`)
    balance = Math.min(999_999, balance + price * quantity)
  }
  clearSelection(session)
  return { balance, closed: false }
}
