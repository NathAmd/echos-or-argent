function createBattleTypeBadge(typeId: number, typeName: string): HTMLElement {
  const badge = document.createElement('strong')
  badge.className = 'battle-type-badge'
  badge.dataset.type = String(typeId)
  badge.textContent = typeName
  return badge
}

export function createBattleTypeBadges(
  types: readonly number[],
  typeNames: readonly string[],
  className = 'battle-types',
): HTMLElement {
  const container = document.createElement('span')
  container.className = className
  const uniqueTypes = [...new Set(types)]
  container.replaceChildren(...uniqueTypes.map((typeId) => createBattleTypeBadge(typeId, typeNames[typeId] ?? '')))
  return container
}

export function createBattleMoveDetail(
  typeId: number,
  typeName: string,
  pp: number | string,
  maxPp?: number,
  move?: PokemonMoveData,
  ppLabel = '',
): HTMLElement {
  const detail = document.createElement('span')
  detail.className = 'battle-move-detail'
  if (move) {
    detail.dataset.moveCategory = String(move.category)
    detail.dataset.movePower = String(move.power)
    detail.dataset.moveAccuracy = String(move.accuracy)
  }
  const types = document.createElement('span')
  types.className = 'battle-move-types'
  types.append(createBattleTypeBadge(typeId, typeName))
  detail.append(types)
  const points = document.createElement('small')
  points.textContent = `${ppLabel} ${pp}${maxPp === undefined ? '' : ` / ${maxPp}`}`.trim()
  detail.append(points)
  return detail
}

export type BattleMoveChoiceOptions = {
  moveNames: readonly string[]
  typeNames: readonly string[]
  ppLabel?: string
  struggleMove?: PokemonMoveData
}

/** Construit la même grille de capacités pour les combats simples et doubles. */
export function createBattleMoveChoices(
  moves: readonly CanonicalPokemon['moves'][number][],
  selectableIndexes: ReadonlySet<number>,
  options: BattleMoveChoiceOptions,
): HTMLButtonElement[] {
  const buttons = moves.map((move, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.battleMove = String(index)
    button.dataset.moveType = String(move.data.type)
    button.disabled = !selectableIndexes.has(index)
    button.dataset.ppState = move.pp === 0 ? 'empty' : move.pp * 4 <= move.maxPp ? 'low' : 'ready'
    button.append(options.moveNames[move.moveId] ?? `Capacité ${move.moveId}`)
    button.append(createBattleMoveDetail(move.data.type, options.typeNames[move.data.type] ?? '', move.pp, move.maxPp, move.data, options.ppLabel))
    return button
  })
  if (selectableIndexes.size === 0 && options.struggleMove) {
    const struggle = document.createElement('button')
    struggle.type = 'button'
    struggle.dataset.battleMove = '-1'
    struggle.dataset.moveType = '0'
    struggle.append(options.moveNames[165] ?? 'Lutte')
    struggle.append(createBattleMoveDetail(0, options.typeNames[0] ?? '', '—', undefined, options.struggleMove, options.ppLabel))
    buttons.push(struggle)
  }
  return buttons
}

export function renderBattleTypeBadges(
  container: HTMLElement | null,
  types: readonly number[],
  typeNames: readonly string[],
): void {
  if (!container) return
  container.replaceChildren(...createBattleTypeBadges(types, typeNames).children)
}

export function createBattlePartyChoices(
  party: readonly CanonicalPokemon[],
  selectableIndexes: ReadonlySet<number>,
  typeNames: readonly string[],
  resolveTypes: (pokemon: CanonicalPokemon) => readonly number[],
  createIcon: (pokemon: CanonicalPokemon) => HTMLElement | undefined,
  labels: { level?: string, hp?: string } = {},
): HTMLButtonElement[] {
  return party.map((pokemon, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.battlePartySlot = String(index)
    button.dataset.shiny = String(pokemon.shiny)
    button.disabled = !selectableIndexes.has(index)
    const icon = createIcon(pokemon)
    const name = document.createElement('span')
    name.className = 'battle-party-name'
    name.textContent = pokemon.nickname ?? pokemon.speciesName
    const detail = document.createElement('span')
    detail.className = 'battle-party-detail'
    const status = formatPokemonStatus(pokemon.status)
    detail.textContent = `${labels.level ?? ''}${pokemon.level}  ${labels.hp ?? ''} ${pokemon.currentHp}/${pokemon.stats.hp}${status ? `  ${status}` : ''}`.trim()
    button.append(...(icon ? [icon] : []), name, detail, createBattleTypeBadges(resolveTypes(pokemon), typeNames, 'battle-menu-types'))
    return button
  })
}

function createBattleBagDetail(quantity: number, description: string): HTMLElement {
  const detail = document.createElement('span')
  detail.className = 'battle-item-detail'

  const quantityLabel = document.createElement('span')
  quantityLabel.className = 'battle-item-quantity'
  quantityLabel.textContent = `×${quantity}`

  const descriptionViewport = document.createElement('span')
  descriptionViewport.className = 'battle-item-description-viewport'
  const descriptionTrack = document.createElement('span')
  descriptionTrack.className = 'battle-item-description-track'
  const descriptionLabel = document.createElement('small')
  descriptionLabel.className = 'battle-item-description'
  descriptionLabel.textContent = description
  descriptionTrack.append(descriptionLabel)
  descriptionViewport.append(descriptionTrack)

  detail.append(quantityLabel, descriptionViewport)
  return detail
}

export function createBattleBagChoices<T extends { itemId: number, name: string, description: string }>(
  entries: readonly { item: T, quantity: number }[],
  createIcon: (itemId: number) => HTMLElement,
  isDisabled: (item: T) => boolean,
): HTMLButtonElement[] {
  return entries.map(({ item, quantity }) => {
    const button = document.createElement('button')
    button.type = 'button'; button.dataset.battleItem = String(item.itemId); button.disabled = isDisabled(item)
    const icon = createIcon(item.itemId); icon.className = 'battle-menu-rom-asset'
    const name = document.createElement('span'); name.className = 'battle-item-name'; name.textContent = item.name
    button.append(icon, name, createBattleBagDetail(quantity, item.description))
    return button
  })
}

export function createBattleItemTargetChoices(party: readonly CanonicalPokemon[], createIcon: (pokemon: CanonicalPokemon) => HTMLElement | undefined, hpLabel = ''): HTMLButtonElement[] {
  return party.map((pokemon, index) => {
    const button = document.createElement('button')
    button.type = 'button'; button.dataset.battleItemTarget = String(index); button.disabled = pokemon.isEgg
    button.dataset.shiny = String(pokemon.shiny)
    const icon = createIcon(pokemon)
    const name = document.createElement('span'); name.className = 'battle-party-name'; name.textContent = pokemon.nickname ?? pokemon.speciesName
    const detail = document.createElement('span'); detail.className = 'battle-party-detail'; detail.textContent = `${hpLabel} ${pokemon.currentHp}/${pokemon.stats.hp}`.trim()
    button.append(...(icon ? [icon] : []), name, detail)
    return button
  })
}

export function createBattlePpItemChoices(pokemon: CanonicalPokemon, moveNames: readonly string[], restoreOnly: boolean, ppLabel = ''): HTMLButtonElement[] {
  return pokemon.moves.map((move, index) => {
    const button = document.createElement('button')
    button.type = 'button'; button.dataset.battleItemMove = String(index); button.disabled = restoreOnly && move.pp >= move.maxPp
    button.append(moveNames[move.moveId] ?? '')
    const detail = document.createElement('span'); detail.textContent = `${ppLabel} ${move.pp}/${move.maxPp}`.trim(); button.append(detail)
    return button
  })
}

export function syncBattleControlHints(root: HTMLElement, mode: string, canCancel: boolean, banks: Record<number, Record<number, string>> = {}): void {
  const confirm = root.querySelector<HTMLButtonElement>('[data-battle-control="confirm"]')
  const cancel = root.querySelector<HTMLButtonElement>('[data-battle-control="cancel"]')
  const main = banks[196] ?? {}, bag = banks[5] ?? {}, party = banks[6] ?? {}, summary = banks[302] ?? {}
  const confirmLabels: Record<string, string> = {
    message: main[23] ?? '', command: main[19] ?? '', moves: bag[31] ?? '', party: main[19] ?? '', bag: main[19] ?? '',
    bagTarget: bag[31] ?? '', bagMove: bag[31] ?? '', doubleTarget: main[19] ?? '', learnMove: party[58] ?? '',
  }
  if (confirm) confirm.textContent = confirmLabels[mode] ?? main[19] ?? ''
  if (cancel) {
    cancel.textContent = mode === 'learnMove' ? party[59] ?? '' : main[21] ?? ''
    cancel.hidden = !canCancel
  }
  root.querySelectorAll<HTMLElement>('.battle-hud label:not(.battle-exp)').forEach((label) => { if (label.firstChild) label.firstChild.nodeValue = `${party[28] ?? ''} ` })
  root.querySelectorAll<HTMLElement>('.battle-hud .battle-exp').forEach((label) => { if (label.firstChild) label.firstChild.nodeValue = `${summary[17] ?? ''} ` })
}
import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { formatPokemonStatus } from '../pokemon/pokemonStatus'
