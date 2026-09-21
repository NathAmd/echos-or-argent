import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog, HgssItemPocket } from '../../rom/items/itemData'
import { getHgssPokemonMachine, inspectPokemonMachineCompatibility } from '../items/usePokemonMachine'
import { getPokemonMachineDisplayName } from '../items/pokemonMachineDisplayName'

export type BagMenuDirection = 'up' | 'down' | 'left' | 'right' | 'page-previous' | 'page-next'

export function isBagPocketItem(item: MainMenuItem): boolean {
  return item.id.startsWith('bag-pocket:')
}

export function isBagInventoryItem(item: MainMenuItem): boolean {
  return item.id.startsWith('bag-item:')
}

export function isBagActionItem(item: MainMenuItem): boolean {
  return item.id.startsWith('bag-') && !isBagPocketItem(item) && !isBagInventoryItem(item)
}

function indexedItems(state: MainMenuState, includes: (item: MainMenuItem) => boolean) {
  return state.items.map((item, index) => ({ item, index })).filter(({ item }) => includes(item))
}

function cycleIndex(entries: readonly { index: number }[], cursor: number, delta: number): number {
  if (entries.length === 0) return cursor
  const position = entries.findIndex(({ index }) => index === cursor)
  const nextPosition = ((position >= 0 ? position : 0) + delta + entries.length) % entries.length
  return entries[nextPosition]!.index
}

export function moveBagMenuCursor(state: MainMenuState, direction: BagMenuDirection, actionPopupOpen: boolean, selectedPocket?: number): number {
  const pockets = indexedItems(state, isBagPocketItem)
  const items = indexedItems(state, isBagInventoryItem)
  const actions = indexedItems(state, isBagActionItem)
  if (actionPopupOpen) {
    const delta = direction === 'up' || direction === 'left' || direction === 'page-previous' ? -1 : 1
    return cycleIndex(actions, state.cursor, delta)
  }

  const inPockets = pockets.some(({ index }) => index === state.cursor)
  const activeEntries = inPockets ? pockets : items
  if (direction === 'left') return inPockets ? state.cursor : pockets.find(({ item }) => item.id === `bag-pocket:${selectedPocket}`)?.index ?? pockets[0]?.index ?? state.cursor
  if (direction === 'right') return inPockets ? items[0]?.index ?? state.cursor : state.cursor
  const delta = direction === 'up' || direction === 'page-previous' ? -1 : 1
  return cycleIndex(activeEntries, state.cursor, delta)
}

export function getFirstBagActionIndex(state: MainMenuState): number | undefined {
  return indexedItems(state, isBagActionItem)[0]?.index
}

export type BagMenuDetailOptions = {
  inventory: ReadonlyMap<number, number>
  itemCatalog: HgssItemCatalog
  pokemonCatalog: PokemonCatalog
  party: readonly CanonicalPokemon[]
  selectedItemId?: number
  bagMessages?: Record<number, string>
  partyMessages?: Record<number, string>
  storageMessages?: Record<number, string>
  promptMessages?: Record<number, string>
  summaryMessages?: Record<number, string>
  teamMenuMessages?: Record<number, string>
  battleMessages?: Record<number, string>
  uiMessages?: Record<number, string>
  createItemIcon: (itemId: number) => HTMLElement
}

export type BagMenuPresentationOptions = BagMenuDetailOptions & {
  state: MainMenuState
  selectedPocket?: HgssItemPocket
  actionPopupOpen: boolean
  createButton: (item: MainMenuItem, index: number, selected: boolean, withAsset?: boolean) => HTMLButtonElement
}

function createColumn(title: string, className: string, entries: readonly { item: MainMenuItem, index: number }[], options: BagMenuPresentationOptions): HTMLElement {
  const section = document.createElement('section')
  section.className = `bag-menu-column ${className}`
  const heading = document.createElement('h3')
  heading.textContent = title
  const list = document.createElement('div')
  list.className = 'bag-menu-column-list'
  list.setAttribute('role', 'navigation')
  list.setAttribute('aria-label', title)
  list.append(...entries.map(({ item, index }) => options.createButton(item, index, index === options.state.cursor)))
  section.append(heading, list)
  return section
}

function createBagDetail(options: BagMenuDetailOptions): HTMLElement {
  const detail = document.createElement('section')
  detail.className = 'bag-menu-detail'
  detail.setAttribute('aria-live', 'polite')
  const item = options.selectedItemId === undefined ? undefined : options.itemCatalog.items[options.selectedItemId]
  const quantity = item ? options.inventory.get(item.itemId) ?? 0 : 0
  if (!item || quantity <= 0) {
    const empty = document.createElement('p')
    empty.className = 'bag-menu-empty'
    empty.textContent = options.storageMessages?.[92] ?? ''
    detail.append(empty)
    return detail
  }

  const name = document.createElement('h3')
  name.textContent = getPokemonMachineDisplayName(item, options.pokemonCatalog.moveNames)
  const visual = document.createElement('div')
  visual.className = 'bag-menu-item-visual'
  const icon = options.createItemIcon(item.itemId)
  icon.classList.add('bag-menu-item-icon')
  icon.setAttribute('aria-hidden', 'true')
  const amount = document.createElement('span')
  amount.textContent = `× ${quantity}`
  visual.append(icon, amount)
  const rule = document.createElement('span')
  rule.className = 'bag-menu-detail-rule'
  rule.setAttribute('aria-hidden', 'true')
  const description = document.createElement('p')
  description.className = 'bag-menu-description'
  description.textContent = item.description
  detail.append(name, visual, rule, description)

  const machine = getHgssPokemonMachine(item.itemId)
  if (machine) {
    const move = options.pokemonCatalog.moves[machine.moveId]
    const machinePanel = document.createElement('section')
    machinePanel.className = 'bag-menu-machine'
    const stats = document.createElement('small')
    stats.textContent = move ? `${move.power > 0 ? `${options.summaryMessages?.[147] ?? ''} ${move.power}` : options.partyMessages?.[55] ?? ''} · ${options.summaryMessages?.[148] ?? ''} ${move.accuracy || '—'} · ${options.partyMessages?.[43] ?? ''} ${move.pp}` : ''
    const roster = document.createElement('div')
    roster.className = 'bag-menu-machine-roster'
    for (const pokemon of options.party) {
      const compatibility = inspectPokemonMachineCompatibility(pokemon, machine.itemId, options.pokemonCatalog)
      const badge = document.createElement('span')
      badge.dataset.compatible = String(compatibility.kind === 'compatible')
      badge.textContent = pokemon.nickname ?? pokemon.speciesName
      roster.append(badge)
    }
    machinePanel.append(stats, roster)
    detail.append(machinePanel)
  }
  return detail
}

function createActionPopup(entries: readonly { item: MainMenuItem, index: number }[], options: BagMenuPresentationOptions): HTMLElement | undefined {
  if (!options.actionPopupOpen || entries.length === 0) return undefined
  const item = options.selectedItemId === undefined ? undefined : options.itemCatalog.items[options.selectedItemId]
  const replacingMove = entries.some(({ item }) => item.id.startsWith('bag-machine-replace:'))
  const choosingMove = entries.some(({ item }) => item.id.startsWith('bag-use-move:'))
  const choosingTarget = entries.some(({ item }) => item.id.startsWith('bag-use:') || item.id.startsWith('bag-give:') || item.id.startsWith('bag-machine-target:'))
  const choosingAction = entries.some(({ item }) => item.id.startsWith('bag-action-'))
  const shade = document.createElement('div')
  shade.className = 'bag-menu-popup-shade'
  const popup = document.createElement('section')
  popup.className = 'bag-menu-action-popup'
  popup.classList.toggle('bag-menu-move-learning', replacingMove)
  popup.setAttribute('role', 'dialog')
  popup.setAttribute('aria-modal', 'true')
  popup.setAttribute('aria-labelledby', 'bag-action-title')
  const kicker = document.createElement('span')
  kicker.textContent = item
    ? getPokemonMachineDisplayName(item, options.pokemonCatalog.moveNames)
    : options.storageMessages?.[89] ?? ''
  const heading = document.createElement('h3')
  heading.id = 'bag-action-title'
  heading.textContent = replacingMove ? options.teamMenuMessages?.[60] ?? options.battleMessages?.[939] ?? '' : choosingMove ? options.partyMessages?.[94] ?? '' : choosingTarget ? options.partyMessages?.[6] ?? '' : choosingAction ? options.promptMessages?.[7] ?? '' : options.uiMessages?.[19] ?? ''
  const list = document.createElement('div')
  list.className = 'bag-menu-action-list'
  list.append(...entries.map(({ item: action, index }) => options.createButton(action, index, index === options.state.cursor)))
  popup.append(kicker, heading, list)
  shade.append(popup)
  return shade
}

export function createBagMenuPresentation(options: BagMenuPresentationOptions): HTMLElement {
  const pockets = indexedItems(options.state, isBagPocketItem)
  const items = indexedItems(options.state, isBagInventoryItem)
  const actions = indexedItems(options.state, isBagActionItem)
  const layout = document.createElement('div')
  layout.className = 'bag-menu-layout'
  const pocketColumn = createColumn(options.uiMessages?.[2] ?? '', 'bag-menu-pockets', pockets, options)
  const itemColumn = createColumn(options.selectedPocket === undefined ? options.storageMessages?.[89] ?? '' : options.itemCatalog.pocketNames[options.selectedPocket] ?? '', 'bag-menu-items', items, options)
  const detail = createBagDetail(options)
  pocketColumn.inert = options.actionPopupOpen
  itemColumn.inert = options.actionPopupOpen
  detail.inert = options.actionPopupOpen
  layout.append(pocketColumn, itemColumn, detail)
  const popup = createActionPopup(actions, options)
  if (popup) layout.append(popup)
  return layout
}

export function syncBagMenuItemDetail(host: HTMLElement, options: BagMenuDetailOptions): void {
  host.querySelector<HTMLElement>('.bag-menu-detail')?.replaceWith(createBagDetail(options))
}

export function syncBagMenuPocketPresentation(host: HTMLElement, options: BagMenuPresentationOptions): void {
  const items = indexedItems(options.state, isBagInventoryItem)
  const title = options.selectedPocket === undefined ? options.storageMessages?.[89] ?? '' : options.itemCatalog.pocketNames[options.selectedPocket] ?? ''
  host.querySelector<HTMLElement>('.bag-menu-items')?.replaceWith(createColumn(title, 'bag-menu-items', items, options))
  syncBagMenuItemDetail(host, options)
}
