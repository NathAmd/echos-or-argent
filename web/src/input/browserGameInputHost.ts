import {
  createGamepadPoller,
  mapKeyboardAction,
  readBrowserGamepadAvailability,
  shouldFocusGameSurfaceForGamepad,
  shouldPreventGameplayBrowserDefault,
  type BrowserGamepadAvailability,
  type GameInputRouter,
} from '../gameInput'
import type { GameTextEntryOverlay } from '../game/ui/gameTextEntryOverlay'
import type { InputPromptController } from '../game/ui/inputPromptController'
import {
  createBrowserInputBindings,
  type BrowserInputBindingsOptions,
} from './browserInputBindings'
import {
  createGameTouchControls,
  type GameTouchControlsOptions,
  type GameTouchControlsState,
} from './gameTouchControls'

type BrowserGameInputDependencies = Readonly<{
  createGamepadPoller: typeof createGamepadPoller
  createBrowserInputBindings: typeof createBrowserInputBindings
  createGameTouchControls: typeof createGameTouchControls
}>

export type BrowserGameInputHostCapabilities = Readonly<{
  gamepad: BrowserGamepadAvailability
  touch?: GameTouchControlsState
}>

export type BrowserGameInputHostOptions = Readonly<{
  target?: Window
  visualViewport?: VisualViewport | null
  router: Pick<GameInputRouter, 'dispatch' | 'keyboard'>
  fullscreen: Readonly<{
    captureKeyboard: () => void | Promise<unknown>
    focus: (force?: boolean) => void
  }>
  prompts: Pick<InputPromptController,
    | 'activateFocusedControl'
    | 'useGamepad'
    | 'useKeyboard'
    | 'usePointer'
    | 'usePointerMovement'
  >
  textEntry: Pick<GameTextEntryOverlay, 'handleKeyboard' | 'isOpen'>
  bugReport: Readonly<{
    isOpen: () => boolean
    close: () => void
  }>
  bot: Readonly<{
    isRunning: () => boolean
    stop: (message: string) => void
  }>
  isGamepadFocusBlocked: () => boolean
  touchControls?: Readonly<{
    panel: HTMLElement
    isAvailable: () => boolean
  }>
  resetPhysicalInput: () => void
  onResize: () => void
  onVisualViewportResize: (height: number) => void
  dependencies?: Partial<BrowserGameInputDependencies>
}>

export type BrowserGameInputHost = Readonly<{
  poll: () => void
  reset: () => void
  getCapabilities: () => BrowserGameInputHostCapabilities
  dispose: () => void
}>

/**
 * Browser adapter shared by keyboard, pointer-modality and gamepad input.
 * Semantic gameplay routing remains owned by the supplied GameInputRouter.
 */
export function createBrowserGameInputHost(options: BrowserGameInputHostOptions): BrowserGameInputHost {
  const target = options.target ?? window
  const createPoller = options.dependencies?.createGamepadPoller ?? createGamepadPoller
  const createBindings = options.dependencies?.createBrowserInputBindings ?? createBrowserInputBindings
  const createTouchControls = options.dependencies?.createGameTouchControls ?? createGameTouchControls
  const gamepad = createPoller((event) => {
    if (event.pressed) void options.fullscreen.captureKeyboard()
    const modalOpen = options.isGamepadFocusBlocked() || options.textEntry.isOpen() || options.bugReport.isOpen()
    if (shouldFocusGameSurfaceForGamepad(event, modalOpen)) options.fullscreen.focus(true)
    options.router.dispatch(event.action, event.pressed, event.source, event.inputId, event.deviceId)
  })
  const touchOptions: GameTouchControlsOptions | undefined = options.touchControls
    ? {
      panel: options.touchControls.panel,
      dispatch: options.router.dispatch,
      isEnabled: options.touchControls.isAvailable,
      isBlocked: () => options.isGamepadFocusBlocked() || options.textEntry.isOpen() || options.bugReport.isOpen(),
    }
    : undefined
  const touch = touchOptions ? createTouchControls(touchOptions) : undefined

  const bindingOptions: BrowserInputBindingsOptions = {
    target,
    visualViewport: options.visualViewport === undefined ? target.visualViewport : options.visualViewport,
    shouldPreventKeyboardDefault: shouldPreventGameplayBrowserDefault,
    captureKeyboard: options.fullscreen.captureKeyboard,
    onKeyboardActivity: options.prompts.useKeyboard,
    onKeyDown: (event) => {
      if (options.textEntry.handleKeyboard(event, true)) {
        event.preventDefault()
        return
      }
      if (options.bugReport.isOpen()) {
        if (event.key === 'Escape') {
          event.preventDefault()
          options.bugReport.close()
        }
        return
      }
      if (options.bot.isRunning()) options.bot.stop('Bot arrêté : clavier détecté.')
      const action = mapKeyboardAction(event)
      if (options.prompts.activateFocusedControl(event, true) || !action) return
      event.preventDefault()
      if (event.repeat && (action === 'confirm' || action === 'cancel' || action === 'menu')) return
      options.router.keyboard(event, true)
    },
    onKeyUp: (event) => {
      if (options.textEntry.handleKeyboard(event, false)) {
        event.preventDefault()
        return
      }
      if (options.prompts.activateFocusedControl(event, false)) return
      if (!mapKeyboardAction(event)) return
      event.preventDefault()
      options.router.keyboard(event, false)
    },
    onPointerDown: (event) => options.prompts.usePointer(
      event.pointerType,
      event.clientX,
      event.clientY,
    ),
    onPointerMove: (event) => options.prompts.usePointerMovement(
      event.pointerType,
      event.clientX,
      event.clientY,
    ),
    onGamepadConnected: (event) => {
      options.prompts.useGamepad(event.gamepad.id)
      gamepad.reset()
      options.fullscreen.focus(true)
    },
    onGamepadDisconnected: () => {
      gamepad.reset()
      options.resetPhysicalInput()
    },
    onBlur: () => {
      gamepad.reset()
      options.resetPhysicalInput()
    },
    onResize: options.onResize,
    onVisualViewportResize: options.onVisualViewportResize,
  }
  const bindings = createBindings(bindingOptions)

  return Object.freeze({
    poll() {
      touch?.sync()
      gamepad.poll()
    },
    reset() {
      touch?.reset()
      gamepad.reset()
    },
    getCapabilities: () => Object.freeze({
      gamepad: readBrowserGamepadAvailability(),
      ...(touch ? { touch: touch.getState() } : {}),
    }),
    dispose() {
      touch?.dispose()
      bindings.dispose()
    },
  })
}
