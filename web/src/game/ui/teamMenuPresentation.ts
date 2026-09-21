import type { MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonSummaryModel } from './pokemonSummaryPresentation'
import { createPokemonTeamDetailPresentation } from './pokemonSummaryPresentation'

export type TeamMenuDirection = 'up' | 'down' | 'left' | 'right' | 'page-previous' | 'page-next'

export function isTeamMemberItem(item: MainMenuItem): boolean {
  return item.id.startsWith('team-member:')
}

export function isTeamActionItem(item: MainMenuItem): boolean {
  return item.id.startsWith('team-') && !isTeamMemberItem(item)
}

function indexedItems(state: MainMenuState, includes: (item: MainMenuItem) => boolean) {
  return state.items.map((item, index) => ({ item, index })).filter(({ item }) => includes(item))
}

function cycle(entries: readonly { index: number }[], cursor: number, delta: number): number {
  if (entries.length === 0) return cursor
  const position = entries.findIndex(({ index }) => index === cursor)
  return entries[((position >= 0 ? position : 0) + delta + entries.length) % entries.length]!.index
}

export function moveTeamMenuCursor(
  state: MainMenuState,
  direction: TeamMenuDirection,
  selectedPartySlot: number,
): number {
  const members = indexedItems(state, isTeamMemberItem)
  const actions = indexedItems(state, isTeamActionItem)
  const inActions = actions.some(({ index }) => index === state.cursor)
  if (direction === 'left') return inActions ? members[selectedPartySlot]?.index ?? members[0]?.index ?? state.cursor : state.cursor
  if (direction === 'right') return inActions ? state.cursor : actions[0]?.index ?? state.cursor
  if (direction === 'page-previous' || direction === 'page-next') {
    return cycle(members, members[selectedPartySlot]?.index ?? state.cursor, direction === 'page-previous' ? -1 : 1)
  }
  return cycle(inActions ? actions : members, state.cursor, direction === 'up' ? -1 : 1)
}

export type TeamMenuPresentationOptions = {
  state: MainMenuState
  party: readonly CanonicalPokemon[]
  selectedPartySlot: number
  selectedModel: PokemonSummaryModel
  statusLabel?: string
  uiMessages?: Record<number, string>
  createButton: (item: MainMenuItem, index: number, selected: boolean, withAsset?: boolean) => HTMLButtonElement
  createPokemonIcon: () => HTMLElement
  createHeldItemIcon: (itemId: number) => HTMLElement | undefined
}

export type TeamMenuSelectionPresentationOptions = Pick<TeamMenuPresentationOptions,
  'state' | 'party' | 'selectedPartySlot' | 'selectedModel' | 'statusLabel' | 'createButton' | 'createPokemonIcon' | 'createHeldItemIcon'
>

function createSection(title: string, className: string): HTMLElement {
  const section = document.createElement('section')
  section.className = `team-menu-section ${className}`
  if (title) {
    const heading = document.createElement('h3')
    heading.textContent = title
    section.append(heading)
  }
  return section
}

export function createTeamMenuPresentation(options: TeamMenuPresentationOptions): HTMLElement {
  const members = indexedItems(options.state, isTeamMemberItem)
  const actions = indexedItems(options.state, isTeamActionItem)
  const layout = document.createElement('div')
  layout.className = 'team-menu-layout'

  const roster = createSection(options.uiMessages?.[60] ?? '', 'team-menu-roster')
  const rosterList = document.createElement('div')
  rosterList.className = 'team-menu-roster-list'
  rosterList.setAttribute('role', 'navigation')
  rosterList.append(...members.map(({ item, index }, slot) => {
    const button = options.createButton(item, index, index === options.state.cursor)
    const pokemon = options.party[slot]
    if (pokemon) {
      button.dataset.partyState = pokemon.currentHp <= 0 ? 'fainted' : pokemon.isEgg ? 'egg' : 'ready'
      button.dataset.shiny = String(pokemon.shiny)
      if (pokemon.heldItemId) { const held = options.createHeldItemIcon(pokemon.heldItemId); if (held) { held.classList.add('team-roster-held-item'); held.setAttribute('aria-hidden', 'true'); button.append(held) } }
    }
    return button
  }))
  roster.append(rosterList)

  const detail = createSection(options.uiMessages?.[65] ?? '', 'team-menu-detail')
  const detailBody = document.createElement('div')
  detailBody.className = 'team-menu-detail-body'
  detailBody.setAttribute('aria-live', 'polite')
  detailBody.append(createPokemonTeamDetailPresentation(
    options.selectedModel,
    options.selectedPartySlot,
    options.party.length,
    options.statusLabel,
    options.createPokemonIcon,
    options.selectedModel.pokemon.heldItemId ? () => options.createHeldItemIcon(options.selectedModel.pokemon.heldItemId)! : undefined,
  ))
  detail.append(detailBody)

  const commandPanel = createSection('', 'team-menu-actions')
  const commandList = document.createElement('div')
  commandList.className = 'team-menu-action-list'
  commandList.setAttribute('role', 'navigation')
  commandList.append(...actions.map(({ item, index }) => options.createButton(item, index, index === options.state.cursor, false)))
  commandPanel.append(commandList)

  layout.append(roster, detail, commandPanel)
  return layout
}

export function syncTeamMenuSelectionPresentation(
  host: ParentNode,
  options: TeamMenuSelectionPresentationOptions,
): boolean {
  const detailBody = host.querySelector<HTMLElement>('.team-menu-detail-body')
  const commandList = host.querySelector<HTMLElement>('.team-menu-action-list')
  if (!detailBody || !commandList) return false
  detailBody.replaceChildren(createPokemonTeamDetailPresentation(
    options.selectedModel,
    options.selectedPartySlot,
    options.party.length,
    options.statusLabel,
    options.createPokemonIcon,
    options.selectedModel.pokemon.heldItemId ? () => options.createHeldItemIcon(options.selectedModel.pokemon.heldItemId)! : undefined,
  ))
  commandList.replaceChildren(...indexedItems(options.state, isTeamActionItem).map(({ item, index }) => (
    options.createButton(item, index, index === options.state.cursor, false)
  )))
  return true
}
