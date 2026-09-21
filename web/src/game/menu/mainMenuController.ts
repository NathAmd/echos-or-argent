import type { GameDigitalAction } from '../../gameInput'

export type PokegearAppScreen = 'pokegear-phone' | 'pokegear-map' | 'pokegear-radio' | 'pokegear-configure'
export type MainMenuScreen = 'root' | 'pokedex' | 'team' | 'bag' | 'pokegear' | PokegearAppScreen | 'options'
export type MainMenuCommand =
  | 'save'
  | 'retire'
  | 'multiplayer'
  | 'new-game'
  | 'cycle-text-speed'
  | 'toggle-battle-animations'
  | 'toggle-local-weather'
  | 'toggle-fullscreen'
  | 'report-bug'
  | 'emergency-unstick'
  | `pokedex-species:${number}`
  | `team-member:${number}`
  | `team-summary:${number}`
  | `team-move-up:${number}`
  | `team-move-down:${number}`
  | `team-take-item:${number}`
  | `team-rename:${number}`
  | `team-field-move:${number}:${number}`
  | `bag-pocket:${number}`
  | `bag-item:${number}`
  | `bag-action-${'use' | 'give' | 'cancel'}:${number}`
  | `bag-use:${number}:${number}`
  | `bag-use-party:${number}`
  | `bag-use-move:${number}:${number}:${number}`
  | `bag-give:${number}:${number}`
  | `bag-bike:${number}`
  | `bag-repel:${number}`
  | `bag-fish:${number}`
  | `bag-sweet-scent:${number}`
  | `bag-machine-target:${number}:${number}`
  | `bag-machine-replace:${number}:${number}:${number}`
  | `bag-machine-cancel:${number}:${number}`
  | `pokegear-contact:${number}`
  | `pokegear-skin:${number}`
  | `pokegear-radio:${number}`

export type MainMenuItem = {
  id: MainMenuScreen | MainMenuCommand
  label: string
  kind: 'screen' | 'command'
}

export type MainMenuState = {
  open: boolean
  screen: MainMenuScreen
  cursor: number
  items: readonly MainMenuItem[]
}

export type MainMenuResult =
  | { kind: 'ignored' }
  | { kind: 'state'; state: MainMenuState }
  | { kind: 'command'; command: MainMenuCommand; state: MainMenuState; optionDirection?: -1 | 1 }

export type MainMenuController = {
  getState: () => MainMenuState
  open: () => MainMenuState
  close: () => MainMenuState
  refresh: () => MainMenuState
  openScreen: (screen: MainMenuScreen) => MainMenuState
  focus: (index: number) => MainMenuState
  select: (index: number) => MainMenuResult
  handle: (action: GameDigitalAction) => MainMenuResult
}

export type MainMenuAvailability = Partial<Record<MainMenuScreen | MainMenuCommand, boolean>>

const allRootItems: readonly MainMenuItem[] = [
  { id: 'pokedex', label: 'Pokédex', kind: 'screen' },
  { id: 'team', label: 'Pokémon', kind: 'screen' },
  { id: 'bag', label: 'Sac', kind: 'screen' },
  { id: 'pokegear', label: 'Pokématos', kind: 'screen' },
  { id: 'multiplayer', label: 'Multijoueur', kind: 'command' },
  { id: 'options', label: 'Options', kind: 'screen' },
  { id: 'retire', label: 'Quitter', kind: 'command' },
]

const backItem: MainMenuItem = { id: 'root', label: 'Retour', kind: 'screen' }
const adjustableOptionsCommands = new Set<MainMenuCommand>([
  'cycle-text-speed',
  'toggle-battle-animations',
  'toggle-local-weather',
  'toggle-fullscreen',
])

export function isAdjustableOptionsCommand(id: MainMenuItem['id']): id is MainMenuCommand {
  return adjustableOptionsCommands.has(id as MainMenuCommand)
}

const screenItems: Readonly<Record<Exclude<MainMenuScreen, 'root'>, readonly MainMenuItem[]>> = {
  pokedex: [],
  team: [],
  bag: [],
  pokegear: [],
  'pokegear-phone': [],
  'pokegear-map': [],
  'pokegear-radio': [],
  'pokegear-configure': [],
  options: [
    { id: 'cycle-text-speed', label: 'Vitesse du texte', kind: 'command' },
    { id: 'toggle-battle-animations', label: 'Animations de combat', kind: 'command' },
    { id: 'toggle-local-weather', label: 'Météo locale', kind: 'command' },
    { id: 'toggle-fullscreen', label: 'Plein écran', kind: 'command' },
    { id: 'save', label: 'Sauvegarder', kind: 'command' },
    { id: 'report-bug', label: 'Créer un rapport', kind: 'command' },
    { id: 'emergency-unstick', label: 'Se décoincer', kind: 'command' },
    { id: 'new-game', label: 'Nouvelle partie', kind: 'command' },
  ],
}

export const pokegearAppScreens = ['pokegear-phone', 'pokegear-map', 'pokegear-radio', 'pokegear-configure'] as const satisfies readonly PokegearAppScreen[]

export function getPokegearAppScreen(card: number): PokegearAppScreen | undefined {
  return pokegearAppScreens[card]
}

export function getPokegearAppCard(screen: MainMenuScreen): number | undefined {
  if (!isPokegearAppScreen(screen)) return undefined
  return pokegearAppScreens.indexOf(screen)
}

export function isPokegearAppScreen(screen: MainMenuScreen): screen is PokegearAppScreen {
  return (pokegearAppScreens as readonly MainMenuScreen[]).includes(screen)
}

export function getMainMenuParentScreen(screen: MainMenuScreen): MainMenuScreen | undefined {
  if (screen === 'root') return undefined
  return isPokegearAppScreen(screen) ? 'pokegear' : 'root'
}

export function createMainMenuController(
  getAvailability: () => MainMenuAvailability = () => ({}),
  getScreenItems: (screen: Exclude<MainMenuScreen, 'root'>) => readonly MainMenuItem[] | undefined = () => undefined,
): MainMenuController {
  const getRootItems = (): readonly MainMenuItem[] => {
    const availability = getAvailability()
    return allRootItems.filter((item) => item.id === 'retire' || item.id === 'multiplayer'
      ? availability[item.id] === true
      : availability[item.id] !== false)
  }
  const getItems = (screen: MainMenuScreen): readonly MainMenuItem[] => {
    if (screen === 'root') return getRootItems()
    const provided = getScreenItems(screen)
    const parent = getMainMenuParentScreen(screen)!
    const returnItem: MainMenuItem = parent === 'root' ? backItem : { id: parent, label: backItem.label, kind: 'screen' }
    const items = provided ? [...provided, returnItem] : [...screenItems[screen], returnItem]
    const availability = getAvailability()
    return items.filter((item) => item.id === parent || availability[item.id] !== false)
  }
  let state: MainMenuState = { open: false, screen: 'root', cursor: 0, items: getRootItems() }
  const screenCursors = new Map<MainMenuScreen, number>([['root', 0]])

  const setState = (next: MainMenuState): MainMenuState => {
    state = next
    return state
  }

  const open = (): MainMenuState => {
    const items = getRootItems()
    const cursor = Math.min(screenCursors.get('root') ?? 0, Math.max(0, items.length - 1))
    screenCursors.set('root', cursor)
    return setState({ open: items.length > 0, screen: 'root', cursor, items })
  }
  const close = (): MainMenuState => setState({ open: false, screen: 'root', cursor: 0, items: getRootItems() })
  const openScreen = (screen: MainMenuScreen): MainMenuState => {
    if (screen === 'root') return open()
    const items = getItems(screen)
    const cursor = Math.min(screenCursors.get(screen) ?? 0, Math.max(0, items.length - 1))
    screenCursors.set(screen, cursor)
    return setState({ open: true, screen, cursor, items })
  }

  const refresh = (): MainMenuState => {
    const focusedId = state.items[state.cursor]?.id
    const items = getItems(state.screen)
    const matchingCursor = focusedId === undefined ? -1 : items.findIndex(({ id }) => id === focusedId)
    const cursor = matchingCursor >= 0 ? matchingCursor : Math.min(state.cursor, Math.max(0, items.length - 1))
    screenCursors.set(state.screen, cursor)
    return setState({ ...state, cursor, items })
  }

  const focus = (index: number): MainMenuState => {
    if (!state.open || !Number.isInteger(index) || index < 0 || index >= state.items.length) return state
    screenCursors.set(state.screen, index)
    return setState({ ...state, cursor: index })
  }

  const select = (index: number): MainMenuResult => {
    if (!state.open) return { kind: 'ignored' }
    const item = state.items[index]
    if (!item) return { kind: 'ignored' }
    focus(index)
    if (item.kind === 'command') return { kind: 'command', command: item.id as MainMenuCommand, state }
    const screen = item.id as MainMenuScreen
    return { kind: 'state', state: openScreen(screen) }
  }

  const handle = (action: GameDigitalAction): MainMenuResult => {
    if (!state.open) {
      return action === 'menu' ? { kind: 'state', state: open() } : { kind: 'ignored' }
    }
    if (action === 'menu') return { kind: 'state', state: close() }
    if (action === 'cancel') {
      const parent = getMainMenuParentScreen(state.screen)
      return { kind: 'state', state: parent === undefined ? close() : openScreen(parent) }
    }
    if (state.screen === 'options' && (action === 'left' || action === 'right')) {
      const item = state.items[state.cursor]
      return item?.kind === 'command' && isAdjustableOptionsCommand(item.id)
        ? { kind: 'command', command: item.id as MainMenuCommand, state, optionDirection: action === 'left' ? -1 : 1 }
        : { kind: 'ignored' }
    }
    if ((action === 'up' || action === 'down' || action === 'left' || action === 'right' || action === 'page-previous' || action === 'page-next') && state.items.length > 0) {
      const listDirection = action === 'up' || action === 'left' || action === 'page-previous' ? -1 : 1
      const cursor = (state.cursor + listDirection % state.items.length + state.items.length) % state.items.length
      return { kind: 'state', state: focus(cursor) }
    }
    if (action === 'confirm') return select(state.cursor)
    return { kind: 'ignored' }
  }

  return { getState: () => state, open, close, refresh, openScreen, focus, select, handle }
}
