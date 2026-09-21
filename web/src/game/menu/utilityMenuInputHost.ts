import type { GameDigitalAction, GameDigitalEvent } from '../../gameInput'
import type { HgssItemPocket } from '../../rom/items/itemData'
import { moveBagMenuCursor, type BagMenuDirection } from '../ui/bagMenuPresentation'
import {
  getPokedexGridColumnCount,
  movePokedexGridCursor,
  type PokedexGridDirection,
} from '../ui/pokedexMenuPresentation'
import {
  movePokemonSummaryPage,
  type PokemonSummaryPage,
} from '../ui/pokemonSummaryPresentation'
import { moveTeamMenuCursor, type TeamMenuDirection } from '../ui/teamMenuPresentation'
import {
  isPokegearAppScreen,
  type MainMenuController,
  type MainMenuResult,
  type MainMenuState,
} from './mainMenuController'

type UtilityMenuNavigationAction = BagMenuDirection & PokedexGridDirection & TeamMenuDirection

const navigationActions = new Set<GameDigitalAction>([
  'up',
  'down',
  'left',
  'right',
  'page-previous',
  'page-next',
])

export const hgssUtilityMenuSoundEffects = {
  select: 1500,
  cursor: 1509,
} as const

function isNavigationAction(action: GameDigitalAction): action is UtilityMenuNavigationAction {
  return navigationActions.has(action)
}

export type UtilityMenuInputSelection = Readonly<{
  teamSummaryOpen: boolean
  teamSummaryPage: PokemonSummaryPage
  teamSlot: number
  pokedexSpeciesId?: number
  bagActionPopupOpen: boolean
  bagPocket?: HgssItemPocket
  bagItemId?: number
}>

export type UtilityMenuInputHostPorts = Readonly<{
  menu: Pick<MainMenuController, 'getState' | 'handle' | 'focus' | 'refresh'>
  menuElement: HTMLElement
  readViewportWidth: () => number
  readPartySize: () => number
  selection: Readonly<{
    read: () => UtilityMenuInputSelection
    update: (update: Partial<UtilityMenuInputSelection>) => void
  }>
  presentation: Readonly<{
    render: (state: MainMenuState) => void
    syncCursor: (state: MainMenuState) => void
    syncPokedex: (state: MainMenuState) => void
    syncTeam: (state: MainMenuState) => void
    syncTeamSummaryPage: () => void
    syncTeamSummaryPokemon: () => void
  }>
  pokedex: Readonly<{
    cycleForm: (direction: -1 | 1, state: MainMenuState) => boolean
  }>
  bag: Readonly<{
    closeActionPopup: () => void
    clearPendingMachineTeaching: () => void
    syncPocket: (state: MainMenuState) => void
    syncItemDetail: (state: MainMenuState) => void
  }>
  pokegear: Readonly<{
    handle: (event: GameDigitalEvent) => boolean
  }>
  applyResult: (result: MainMenuResult) => void
  playSoundEffect?: (sequenceId: number) => void
}>

export type UtilityMenuInputHost = Readonly<{
  handle: (event: GameDigitalEvent) => boolean
}>

function readVisiblePokedexRows(menuElement: HTMLElement): number {
  const grid = menuElement.querySelector<HTMLElement>('.pokedex-grid')
  const firstCell = grid?.querySelector<HTMLElement>('.pokedex-grid-cell')
  return grid && firstCell
    ? Math.max(1, Math.floor(grid.clientHeight / Math.max(1, firstCell.offsetHeight + 8)))
    : 3
}

/**
 * Owns digital navigation while the utility menu is open. The model and
 * presentations stay behind ports so this host never needs ROM/UI resources.
 */
export function createUtilityMenuInputHost(ports: UtilityMenuInputHostPorts): UtilityMenuInputHost {
  const playCursorSound = (): void => ports.playSoundEffect?.(hgssUtilityMenuSoundEffects.cursor)
  const playSelectSound = (): void => ports.playSoundEffect?.(hgssUtilityMenuSoundEffects.select)

  const handleTeamSummary = (event: GameDigitalEvent, selection: UtilityMenuInputSelection): void => {
    if (event.action === 'cancel') {
      ports.selection.update({ teamSummaryOpen: false })
      ports.presentation.render(ports.menu.refresh())
      playSelectSound()
    } else if (event.action === 'menu') {
      ports.applyResult(ports.menu.handle(event.action))
      playSelectSound()
    } else if (event.action === 'left' || event.action === 'page-previous') {
      ports.selection.update({ teamSummaryPage: movePokemonSummaryPage(selection.teamSummaryPage, -1) })
      ports.presentation.syncTeamSummaryPage()
      playCursorSound()
    } else if (event.action === 'right' || event.action === 'page-next' || event.action === 'confirm') {
      ports.selection.update({ teamSummaryPage: movePokemonSummaryPage(selection.teamSummaryPage, 1) })
      ports.presentation.syncTeamSummaryPage()
      playCursorSound()
    } else if ((event.action === 'up' || event.action === 'down') && ports.readPartySize() > 1) {
      const partySize = ports.readPartySize()
      const teamSlot = (selection.teamSlot + (event.action === 'up' ? -1 : 1) + partySize) % partySize
      ports.selection.update({ teamSlot })
      ports.presentation.syncTeamSummaryPokemon()
      playCursorSound()
    }
  }

  const handlePokedex = (
    event: GameDigitalEvent,
    state: MainMenuState,
    selection: UtilityMenuInputSelection,
  ): void => {
    if ((event.action === 'page-previous' || event.action === 'page-next')
      && ports.pokedex.cycleForm(event.action === 'page-previous' ? -1 : 1, state)) {
      playCursorSound()
      return
    }
    const nextIndex = movePokedexGridCursor(
      state,
      event.action as PokedexGridDirection,
      getPokedexGridColumnCount(ports.readViewportWidth()),
      readVisiblePokedexRows(ports.menuElement),
    )
    const focused = ports.menu.focus(nextIndex)
    const item = focused.items[focused.cursor]
    const nextSpeciesId = item?.id.startsWith('pokedex-species:')
      ? Number.parseInt(item.id.slice('pokedex-species:'.length), 10)
      : selection.pokedexSpeciesId
    if (nextSpeciesId !== selection.pokedexSpeciesId) {
      ports.selection.update({ pokedexSpeciesId: nextSpeciesId })
      ports.presentation.syncPokedex(focused)
    } else {
      ports.presentation.syncCursor(focused)
    }
    playCursorSound()
  }

  const handleBag = (
    event: GameDigitalEvent,
    state: MainMenuState,
    selection: UtilityMenuInputSelection,
  ): boolean => {
    if (selection.bagActionPopupOpen && (event.action === 'cancel' || event.action === 'menu')) {
      ports.bag.closeActionPopup()
      playSelectSound()
      return true
    }
    if (!isNavigationAction(event.action)) return false
    const nextIndex = moveBagMenuCursor(state, event.action, selection.bagActionPopupOpen, selection.bagPocket)
    const focused = ports.menu.focus(nextIndex)
    if (selection.bagActionPopupOpen) {
      ports.presentation.syncCursor(focused)
      playCursorSound()
      return true
    }
    const item = focused.items[focused.cursor]
    if (item?.id.startsWith('bag-pocket:')) {
      ports.selection.update({
        bagPocket: Number.parseInt(item.id.slice('bag-pocket:'.length), 10) as HgssItemPocket,
        bagItemId: undefined,
      })
      ports.bag.clearPendingMachineTeaching()
      const refreshed = ports.menu.refresh()
      ports.bag.syncPocket(refreshed)
      ports.presentation.syncCursor(refreshed)
    } else if (item?.id.startsWith('bag-item:')) {
      ports.selection.update({ bagItemId: Number.parseInt(item.id.slice('bag-item:'.length), 10) })
      ports.bag.syncItemDetail(focused)
      ports.presentation.syncCursor(focused)
    }
    playCursorSound()
    return true
  }

  const handleTeam = (
    event: GameDigitalEvent,
    state: MainMenuState,
    selection: UtilityMenuInputSelection,
  ): void => {
    const nextIndex = moveTeamMenuCursor(state, event.action as TeamMenuDirection, selection.teamSlot)
    const focused = ports.menu.focus(nextIndex)
    const member = focused.items[focused.cursor]
    const teamSlot = member?.id.startsWith('team-member:')
      ? Number.parseInt(member.id.slice('team-member:'.length), 10)
      : selection.teamSlot
    if (teamSlot !== selection.teamSlot) {
      ports.selection.update({ teamSlot })
      ports.presentation.syncTeam(ports.menu.refresh())
    } else {
      ports.presentation.syncCursor(focused)
    }
    playCursorSound()
  }

  return Object.freeze({
    handle(event): boolean {
      const state = ports.menu.getState()
      if (!state.open) return false
      if (!event.pressed) {
        if (isPokegearAppScreen(state.screen)) ports.pokegear.handle(event)
        return true
      }

      const selection = ports.selection.read()
      if (state.screen === 'team' && selection.teamSummaryOpen) {
        handleTeamSummary(event, selection)
        return true
      }
      if (isPokegearAppScreen(state.screen) && ports.pokegear.handle(event)) return true
      if (state.screen === 'pokedex' && isNavigationAction(event.action)) {
        handlePokedex(event, state, selection)
        return true
      }
      if (state.screen === 'bag') {
        if (handleBag(event, state, selection)) return true
      }
      if (state.screen === 'team' && isNavigationAction(event.action)) {
        handleTeam(event, state, selection)
        return true
      }

      const result = ports.menu.handle(event.action)
      if (result.kind === 'state' && isNavigationAction(event.action)) {
        ports.presentation.syncCursor(result.state)
        playCursorSound()
      } else {
        ports.applyResult(result)
        if (result.kind !== 'ignored') playSelectSound()
      }
      return true
    },
  })
}
