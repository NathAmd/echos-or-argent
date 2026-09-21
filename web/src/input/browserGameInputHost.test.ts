import { describe, expect, it, vi } from 'vitest'
import type { GameDigitalEvent } from '../gameInput'
import { createBrowserGameInputHost } from './browserGameInputHost'
import type { BrowserInputBindingsOptions } from './browserInputBindings'
import type { GameTouchControlsOptions } from './gameTouchControls'

function keyboardEvent(key: string, repeat = false): KeyboardEvent {
  return {
    key,
    repeat,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent
}

function createFixture() {
  let onGamepadEvent: ((event: GameDigitalEvent) => void) | undefined
  let bindingOptions: BrowserInputBindingsOptions | undefined
  let textEntryConsumes = false
  let textEntryOpen = false
  let bugReportOpen = false
  let botRunning = false
  let gamepadFocusBlocked = false
  const gamepad = { poll: vi.fn(), reset: vi.fn() }
  const bindings = { dispose: vi.fn() }
  const router = { dispatch: vi.fn(), keyboard: vi.fn(() => true) }
  const fullscreen = { captureKeyboard: vi.fn(() => Promise.resolve(true)), focus: vi.fn() }
  const prompts = {
    activateFocusedControl: vi.fn(() => false),
    useGamepad: vi.fn(),
    useKeyboard: vi.fn(),
    usePointer: vi.fn(),
    usePointerMovement: vi.fn(),
  }
  const handleKeyboard = vi.fn(() => textEntryConsumes)
  const closeBugReport = vi.fn(() => { bugReportOpen = false })
  const stopBot = vi.fn(() => { botRunning = false })
  const resetPhysicalInput = vi.fn()
  const onResize = vi.fn()
  const onVisualViewportResize = vi.fn()
  const host = createBrowserGameInputHost({
    target: {} as Window,
    visualViewport: null,
    router,
    fullscreen,
    prompts,
    textEntry: {
      handleKeyboard,
      isOpen: () => textEntryOpen,
    },
    bugReport: {
      isOpen: () => bugReportOpen,
      close: closeBugReport,
    },
    bot: {
      isRunning: () => botRunning,
      stop: stopBot,
    },
    isGamepadFocusBlocked: () => gamepadFocusBlocked,
    resetPhysicalInput,
    onResize,
    onVisualViewportResize,
    dependencies: {
      createGamepadPoller: (onEvent) => {
        onGamepadEvent = onEvent
        return gamepad
      },
      createBrowserInputBindings: (options) => {
        bindingOptions = options
        return bindings
      },
    },
  })
  const readBindingOptions = (): BrowserInputBindingsOptions => {
    if (!bindingOptions) throw new Error('Les bindings navigateur ne sont pas installés.')
    return bindingOptions
  }
  const dispatchGamepad = (event: GameDigitalEvent): void => {
    if (!onGamepadEvent) throw new Error('Le poller manette n’est pas installé.')
    onGamepadEvent(event)
  }
  return {
    host,
    gamepad,
    bindings,
    router,
    fullscreen,
    prompts,
    handleKeyboard,
    closeBugReport,
    stopBot,
    resetPhysicalInput,
    onResize,
    onVisualViewportResize,
    readBindingOptions,
    dispatchGamepad,
    setTextEntryConsumes: (consumes: boolean) => { textEntryConsumes = consumes },
    setTextEntryOpen: (open: boolean) => { textEntryOpen = open },
    setBugReportOpen: (open: boolean) => { bugReportOpen = open },
    setBotRunning: (running: boolean) => { botRunning = running },
    setGamepadFocusBlocked: (blocked: boolean) => { gamepadFocusBlocked = blocked },
  }
}

describe('browser game input host', () => {
  it('donne la priorité à la saisie centralisée puis au rapport de bug', () => {
    const fixture = createFixture()
    const bindings = fixture.readBindingOptions()
    fixture.setTextEntryConsumes(true)
    const textEvent = keyboardEvent('ArrowDown')

    bindings.onKeyDown(textEvent)
    expect(textEvent.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.router.keyboard).not.toHaveBeenCalled()

    fixture.setTextEntryConsumes(false)
    fixture.setBugReportOpen(true)
    const escape = keyboardEvent('Escape')
    bindings.onKeyDown(escape)
    expect(escape.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.closeBugReport).toHaveBeenCalledOnce()
    expect(fixture.router.keyboard).not.toHaveBeenCalled()
  })

  it('arrête le bot, respecte le contrôle focalisé et filtre les répétitions modales', () => {
    const fixture = createFixture()
    const bindings = fixture.readBindingOptions()
    fixture.setBotRunning(true)
    const movement = keyboardEvent('ArrowUp')

    bindings.onKeyDown(movement)
    expect(fixture.stopBot).toHaveBeenCalledWith('Bot arrêté : clavier détecté.')
    expect(movement.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.router.keyboard).toHaveBeenCalledWith(movement, true)

    fixture.prompts.activateFocusedControl.mockReturnValueOnce(true)
    const focused = keyboardEvent('Enter')
    bindings.onKeyDown(focused)
    expect(fixture.router.keyboard).not.toHaveBeenCalledWith(focused, true)

    const repeated = keyboardEvent('Enter', true)
    bindings.onKeyDown(repeated)
    expect(repeated.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.router.keyboard).not.toHaveBeenCalledWith(repeated, true)
  })

  it('route les keyup mappés sans voler ceux consommés par une saisie ou un contrôle', () => {
    const fixture = createFixture()
    const bindings = fixture.readBindingOptions()
    fixture.setTextEntryConsumes(true)
    const textRelease = keyboardEvent('ArrowLeft')
    bindings.onKeyUp(textRelease)
    expect(textRelease.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.router.keyboard).not.toHaveBeenCalled()

    fixture.setTextEntryConsumes(false)
    fixture.prompts.activateFocusedControl.mockReturnValueOnce(true)
    const focusedRelease = keyboardEvent('Enter')
    bindings.onKeyUp(focusedRelease)
    expect(fixture.router.keyboard).not.toHaveBeenCalled()

    const release = keyboardEvent('ArrowLeft')
    bindings.onKeyUp(release)
    expect(release.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.router.keyboard).toHaveBeenCalledWith(release, false)

    bindings.onKeyUp(keyboardEvent('Tab'))
    expect(fixture.router.keyboard).toHaveBeenCalledTimes(1)
  })

  it('capture et focalise la manette uniquement hors couche modale, sans perdre son identité', () => {
    const fixture = createFixture()
    const pressed: GameDigitalEvent = {
      action: 'confirm',
      pressed: true,
      source: 'gamepad',
      inputId: 'button-0',
      deviceId: 'Steam Deck',
    }

    fixture.dispatchGamepad(pressed)
    expect(fixture.fullscreen.captureKeyboard).toHaveBeenCalledOnce()
    expect(fixture.fullscreen.focus).toHaveBeenCalledWith(true)
    expect(fixture.router.dispatch).toHaveBeenCalledWith(
      'confirm', true, 'gamepad', 'button-0', 'Steam Deck',
    )

    fixture.setGamepadFocusBlocked(true)
    fixture.setTextEntryOpen(true)
    fixture.setBugReportOpen(true)
    fixture.fullscreen.focus.mockClear()
    fixture.dispatchGamepad({ ...pressed, action: 'down' })
    expect(fixture.fullscreen.focus).not.toHaveBeenCalled()
    expect(fixture.router.dispatch).toHaveBeenLastCalledWith(
      'down', true, 'gamepad', 'button-0', 'Steam Deck',
    )

    fixture.fullscreen.captureKeyboard.mockClear()
    fixture.dispatchGamepad({ ...pressed, pressed: false })
    expect(fixture.fullscreen.captureKeyboard).not.toHaveBeenCalled()
  })

  it('centralise modalité pointeur, connexions, interruptions et redimensionnement', () => {
    const fixture = createFixture()
    const bindings = fixture.readBindingOptions()
    bindings.onPointerDown({ pointerType: 'touch', clientX: 12, clientY: 34 } as PointerEvent)
    bindings.onPointerMove({ pointerType: 'mouse', clientX: 56, clientY: 78 } as PointerEvent)
    expect(fixture.prompts.usePointer).toHaveBeenCalledWith('touch', 12, 34)
    expect(fixture.prompts.usePointerMovement).toHaveBeenCalledWith('mouse', 56, 78)

    bindings.onGamepadConnected({ gamepad: { id: 'Xbox' } } as GamepadEvent)
    expect(fixture.prompts.useGamepad).toHaveBeenCalledWith('Xbox')
    expect(fixture.gamepad.reset).toHaveBeenCalledOnce()
    expect(fixture.fullscreen.focus).toHaveBeenCalledWith(true)

    bindings.onGamepadDisconnected({} as GamepadEvent)
    bindings.onBlur()
    expect(fixture.gamepad.reset).toHaveBeenCalledTimes(3)
    expect(fixture.resetPhysicalInput).toHaveBeenCalledTimes(2)

    bindings.onResize()
    bindings.onVisualViewportResize(640)
    expect(fixture.onResize).toHaveBeenCalledOnce()
    expect(fixture.onVisualViewportResize).toHaveBeenCalledWith(640)
  })

  it('expose directement poll, reset et dispose des propriétaires sous-jacents', () => {
    const fixture = createFixture()

    fixture.host.poll()
    fixture.host.reset()
    fixture.host.dispose()

    expect(fixture.gamepad.poll).toHaveBeenCalledOnce()
    expect(fixture.gamepad.reset).toHaveBeenCalledOnce()
    expect(fixture.bindings.dispose).toHaveBeenCalledOnce()
  })

  it('branche le pad tactile au routeur central et le bloque derrière les couches modales', () => {
    let touchOptions: GameTouchControlsOptions | undefined
    let textEntryOpen = false
    let multiplayerOpen = false
    const touch = {
      getState: vi.fn(() => ({ available: true, visible: true })),
      sync: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    }
    const gamepad = { poll: vi.fn(), reset: vi.fn() }
    const bindings = { dispose: vi.fn() }
    const router = { dispatch: vi.fn(), keyboard: vi.fn(() => true) }
    const host = createBrowserGameInputHost({
      target: {} as Window,
      visualViewport: null,
      router,
      fullscreen: { captureKeyboard: vi.fn(), focus: vi.fn() },
      prompts: {
        activateFocusedControl: vi.fn(() => false),
        useGamepad: vi.fn(),
        useKeyboard: vi.fn(),
        usePointer: vi.fn(),
        usePointerMovement: vi.fn(),
      },
      textEntry: { handleKeyboard: vi.fn(() => false), isOpen: () => textEntryOpen },
      bugReport: { isOpen: () => false, close: vi.fn() },
      bot: { isRunning: () => false, stop: vi.fn() },
      isGamepadFocusBlocked: () => multiplayerOpen,
      touchControls: { panel: {} as HTMLElement, isAvailable: () => true },
      resetPhysicalInput: vi.fn(),
      onResize: vi.fn(),
      onVisualViewportResize: vi.fn(),
      dependencies: {
        createGamepadPoller: () => gamepad,
        createBrowserInputBindings: () => bindings,
        createGameTouchControls: (options) => {
          touchOptions = options
          return touch
        },
      },
    })

    if (!touchOptions) throw new Error("Le pad tactile n'a pas été installé.")
    touchOptions.dispatch('left', true, 'pointer', 'touch:left:4')
    expect(router.dispatch).toHaveBeenCalledWith('left', true, 'pointer', 'touch:left:4')
    expect(touchOptions.isBlocked()).toBe(false)
    textEntryOpen = true
    expect(touchOptions.isBlocked()).toBe(true)
    textEntryOpen = false
    multiplayerOpen = true
    expect(touchOptions.isBlocked()).toBe(true)

    host.poll()
    host.reset()
    expect(touch.sync).toHaveBeenCalledOnce()
    expect(touch.reset).toHaveBeenCalledOnce()
    expect(host.getCapabilities().touch).toEqual({ available: true, visible: true })
    host.dispose()
    expect(touch.dispose).toHaveBeenCalledOnce()
  })
})
