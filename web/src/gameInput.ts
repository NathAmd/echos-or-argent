export type GameDigitalAction = 'confirm' | 'cancel' | 'up' | 'down' | 'left' | 'right' | 'secondary' | 'tertiary' | 'menu' | 'page-previous' | 'page-next'

export type GameInputSource = 'keyboard' | 'gamepad' | 'pointer' | 'automation'

export type GameDigitalEvent = {
  action: GameDigitalAction
  pressed: boolean
  source: GameInputSource
  inputId?: string
  deviceId?: string
}

export type GameInputRouter = {
  dispatch: (action: GameDigitalAction, pressed: boolean, source: GameInputSource, inputId?: string, deviceId?: string) => void
  keyboard: (event: KeyboardEvent, pressed: boolean) => boolean
  pointer: (action: GameDigitalAction) => void
}

export const gameKeyboardBindings = [
  ['Enter', 'confirm'],
  [' ', 'confirm'],
  ['Shift', 'cancel'],
  ['Escape', 'cancel'],
  ['Backspace', 'cancel'],
  ['ArrowUp', 'up'],
  ['w', 'up'],
  ['W', 'up'],
  ['ArrowDown', 'down'],
  ['s', 'down'],
  ['S', 'down'],
  ['ArrowLeft', 'left'],
  ['a', 'left'],
  ['A', 'left'],
  ['ArrowRight', 'right'],
  ['d', 'right'],
  ['D', 'right'],
  ['x', 'secondary'],
  ['X', 'secondary'],
  ['m', 'menu'],
  ['M', 'menu'],
  ['PageUp', 'page-previous'],
  ['PageDown', 'page-next'],
] as const satisfies readonly (readonly [string, GameDigitalAction])[]
export const gameKeyboardBackPrompt = 'Esc / ⇧'

const keyboardActions = new Map<string, GameDigitalAction>(gameKeyboardBindings)
const keyboardBackKeys = new Set(['Escape', 'Shift'])

const gamepadButtonActions = new Map<number, GameDigitalAction>([
  [0, 'confirm'],
  [1, 'cancel'],
  [2, 'secondary'],
  // Y / Triangle / X Nintendo est le bouton Menu annoncé par les aides UI.
  // Select et Start restent deux accès de secours, utiles sur Steam Deck.
  [3, 'menu'],
  [4, 'page-previous'],
  [5, 'page-next'],
  [6, 'page-previous'],
  [7, 'page-next'],
  [8, 'menu'],
  [9, 'menu'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
])

const allActions: GameDigitalAction[] = ['confirm', 'cancel', 'up', 'down', 'left', 'right', 'secondary', 'tertiary', 'menu', 'page-previous', 'page-next']
const repeatedActions = new Set<GameDigitalAction>(['up', 'down', 'left', 'right', 'page-previous', 'page-next'])
const opposingDirectionPairs = [
  ['left', 'right'],
  ['up', 'down'],
] as const satisfies readonly (readonly [GameDigitalAction, GameDigitalAction])[]
const axisPressThreshold = 0.55
const axisReleaseThreshold = 0.35

type GamepadLike = Pick<Gamepad, 'axes' | 'buttons'> & Partial<Pick<Gamepad, 'id'>>

type BrowserGamepadNavigator = Readonly<{
  getGamepads?: () => readonly (GamepadLike | null)[]
}>

export type BrowserGamepadAvailability = Readonly<{
  available: boolean
  reason?: string
}>

export function readBrowserGamepadAvailability(
  browserNavigator: BrowserGamepadNavigator | undefined = globalThis.navigator,
): BrowserGamepadAvailability {
  return typeof browserNavigator?.getGamepads === 'function'
    ? Object.freeze({ available: true })
    : Object.freeze({
      available: false,
      reason: "Les manettes ne sont pas disponibles dans ce navigateur; les commandes tactiles restent utilisables.",
    })
}

function readBrowserGamepads(): readonly (GamepadLike | null)[] {
  const browserNavigator = globalThis.navigator as BrowserGamepadNavigator | undefined
  if (typeof browserNavigator?.getGamepads !== 'function') return []
  try { return browserNavigator.getGamepads() ?? [] }
  catch { return [] }
}

type GamepadPollerOptions = {
  now?: () => number
  readGamepads?: () => readonly (GamepadLike | null)[]
  initialRepeatDelayMs?: number
  repeatIntervalMs?: number
}

export function mapKeyboardAction(event: KeyboardEvent): GameDigitalAction | undefined {
  return keyboardActions.get(event.key)
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null
  const tagName = element?.tagName?.toUpperCase()
  return tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'
    || element?.isContentEditable === true
}

const textEntryNativeKeys = new Set([
  'Enter', ' ', 'Shift', 'Backspace',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

/**
 * Capture les commandes de jeu avant les contrôles et le défilement natifs.
 * Une vraie saisie conserve ses touches d'édition, mais Escape (le B émulé
 * par Steam Input) reste toujours propriété du jeu.
 */
export function shouldPreventGameplayBrowserDefault(
  event: Pick<KeyboardEvent, 'key' | 'target'>,
): boolean {
  if (!keyboardActions.has(event.key)) return false
  return !isTextEntryTarget(event.target)
    || !(event.key.length === 1 || textEntryNativeKeys.has(event.key))
}

/** Un dialogue garde son propre focus roving pendant la navigation manette. */
export function shouldFocusGameSurfaceForGamepad(
  event: Pick<GameDigitalEvent, 'pressed' | 'source'>,
  modalOpen: boolean,
): boolean {
  return event.pressed && event.source === 'gamepad' && !modalOpen
}

/** Escape et Shift sont deux entrées physiques de la même action Retour. */
export function isKeyboardBackInput(event: Pick<GameDigitalEvent, 'action' | 'pressed' | 'source' | 'inputId'>): boolean {
  return event.pressed && event.action === 'cancel' && event.source === 'keyboard' && keyboardBackKeys.has(event.inputId ?? '')
}

/** Backspace reste une commande d'édition uniquement lorsqu'un écran saisit du texte. */
export function isKeyboardTextDeletion(event: Pick<GameDigitalEvent, 'action' | 'pressed' | 'source' | 'inputId'>): boolean {
  return event.pressed && event.action === 'cancel' && event.source === 'keyboard' && event.inputId === 'Backspace'
}

/** Récupère Retour quand le navigateur consomme Escape pour quitter le plein écran. */
export function shouldDispatchFullscreenBack(previouslyActive: boolean, active: boolean, exitRequested: boolean): boolean {
  return previouslyActive && !active && !exitRequested
}

export function createGameInputRouter(onEvent: (event: GameDigitalEvent) => void): GameInputRouter {
  const dispatch = (action: GameDigitalAction, pressed: boolean, source: GameInputSource, inputId?: string, deviceId?: string): void => {
    onEvent({ action, pressed, source, inputId, ...(deviceId ? { deviceId } : {}) })
  }
  return {
    dispatch,
    keyboard(event, pressed) {
      const action = mapKeyboardAction(event)
      if (!action) return false
      dispatch(action, pressed, 'keyboard', event.key)
      return true
    },
    pointer(action) {
      dispatch(action, true, 'pointer')
      dispatch(action, false, 'pointer')
    },
  }
}

function addAxisActions(gamepad: GamepadLike, previous: Set<GameDigitalAction>, actions: Set<GameDigitalAction>): void {
  const horizontal = gamepad.axes[0] ?? 0
  const vertical = gamepad.axes[1] ?? 0
  if (horizontal <= -axisPressThreshold || (previous.has('left') && horizontal <= -axisReleaseThreshold)) actions.add('left')
  if (horizontal >= axisPressThreshold || (previous.has('right') && horizontal >= axisReleaseThreshold)) actions.add('right')
  if (vertical <= -axisPressThreshold || (previous.has('up') && vertical <= -axisReleaseThreshold)) actions.add('up')
  if (vertical >= axisPressThreshold || (previous.has('down') && vertical >= axisReleaseThreshold)) actions.add('down')
}

function exclusiveDirection(
  actions: Set<GameDigitalAction>,
  first: GameDigitalAction,
  second: GameDigitalAction,
): GameDigitalAction | undefined {
  const hasFirst = actions.has(first)
  const hasSecond = actions.has(second)
  if (hasFirst === hasSecond) return undefined
  return hasFirst ? first : second
}

function resolveOpposingDirections(
  actions: Set<GameDigitalAction>,
  dpadActions: Set<GameDigitalAction>,
  axisActions: Set<GameDigitalAction>,
  previous: Set<GameDigitalAction>,
): void {
  for (const [first, second] of opposingDirectionPairs) {
    if (!actions.has(first) || !actions.has(second)) continue

    // Prefer an unambiguous D-pad direction, then keep the held direction so
    // hysteresis and repeats remain stable. If neither decides, use a single
    // stick direction; fully ambiguous pairs are neutralized.
    const winner = exclusiveDirection(dpadActions, first, second)
      ?? exclusiveDirection(previous, first, second)
      ?? exclusiveDirection(axisActions, first, second)

    if (winner === first) actions.delete(second)
    else if (winner === second) actions.delete(first)
    else {
      actions.delete(first)
      actions.delete(second)
    }
  }
}

function readGamepadActions(gamepads: readonly (GamepadLike | null)[], previous: Set<GameDigitalAction>): {
  actions: Set<GameDigitalAction>
  deviceIds: Map<GameDigitalAction, string>
} {
  const actions = new Set<GameDigitalAction>()
  const dpadActions = new Set<GameDigitalAction>()
  const axisActions = new Set<GameDigitalAction>()
  const deviceIds = new Map<GameDigitalAction, string>()
  for (const gamepad of gamepads) {
    if (!gamepad) continue
    gamepad.buttons.forEach((button, index) => {
      const action = gamepadButtonActions.get(index)
      if (!action || !button.pressed) return
      actions.add(action)
      if (gamepad.id && !deviceIds.has(action)) deviceIds.set(action, gamepad.id)
      if (index >= 12 && index <= 15) dpadActions.add(action)
    })
    const currentAxisActions = new Set<GameDigitalAction>()
    addAxisActions(gamepad, previous, currentAxisActions)
    for (const action of currentAxisActions) {
      axisActions.add(action)
      if (gamepad.id && !deviceIds.has(action)) deviceIds.set(action, gamepad.id)
    }
  }
  for (const action of axisActions) actions.add(action)
  resolveOpposingDirections(actions, dpadActions, axisActions, previous)
  return { actions, deviceIds }
}

function createGamepadEvent(action: GameDigitalAction, pressed: boolean, deviceId?: string): GameDigitalEvent {
  return { action, pressed, source: 'gamepad', ...(deviceId ? { deviceId } : {}) }
}

export function createGamepadPoller(
  onEvent: (event: GameDigitalEvent) => void,
  options: GamepadPollerOptions = {},
): { poll: () => void; reset: () => void } {
  let previousActions = new Set<GameDigitalAction>()
  let previousDeviceIds = new Map<GameDigitalAction, string>()
  const repeatAt = new Map<GameDigitalAction, number>()
  const now = options.now ?? (() => performance.now())
  const readGamepads = options.readGamepads ?? readBrowserGamepads
  const initialRepeatDelayMs = options.initialRepeatDelayMs ?? 350
  const repeatIntervalMs = options.repeatIntervalMs ?? 90

  function poll(): void {
    const timestamp = now()
    const { actions: currentActions, deviceIds: currentDeviceIds } = readGamepadActions(readGamepads(), previousActions)
    for (const action of allActions) {
      const wasPressed = previousActions.has(action)
      const isPressed = currentActions.has(action)
      if (!wasPressed && isPressed) {
        onEvent(createGamepadEvent(action, true, currentDeviceIds.get(action)))
        if (repeatedActions.has(action)) repeatAt.set(action, timestamp + initialRepeatDelayMs)
      } else if (wasPressed && !isPressed) {
        onEvent(createGamepadEvent(action, false, previousDeviceIds.get(action)))
        repeatAt.delete(action)
      } else if (isPressed && repeatedActions.has(action) && timestamp >= (repeatAt.get(action) ?? Infinity)) {
        onEvent(createGamepadEvent(action, true, currentDeviceIds.get(action) ?? previousDeviceIds.get(action)))
        repeatAt.set(action, timestamp + repeatIntervalMs)
      }
    }
    previousActions = currentActions
    previousDeviceIds = currentDeviceIds
  }

  function reset(): void {
    for (const action of previousActions) onEvent(createGamepadEvent(action, false, previousDeviceIds.get(action)))
    previousActions.clear()
    previousDeviceIds.clear()
    repeatAt.clear()
  }

  return { poll, reset }
}
