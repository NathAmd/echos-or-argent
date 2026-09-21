export type BrowserInputBindings = Readonly<{
  dispose: () => void
}>

export type BrowserInputBindingsOptions = Readonly<{
  target: Window
  visualViewport?: VisualViewport | null
  shouldPreventKeyboardDefault: (event: KeyboardEvent) => boolean
  captureKeyboard: () => void | Promise<unknown>
  onKeyboardActivity: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onKeyUp: (event: KeyboardEvent) => void
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onGamepadConnected: (event: GamepadEvent) => void
  onGamepadDisconnected: (event: GamepadEvent) => void
  onBlur: () => void
  onResize: () => void
  onVisualViewportResize: (height: number) => void
}>

/**
 * Owns only browser-global input listeners. UI-specific controls keep their
 * listeners beside their respective hosts and feed the same game input router.
 */
export function createBrowserInputBindings(options: BrowserInputBindingsOptions): BrowserInputBindings {
  const capturedKeydowns = new WeakSet<KeyboardEvent>()
  const visualViewport = options.visualViewport === undefined
    ? options.target.visualViewport
    : options.visualViewport

  const captureKeyDown = (event: KeyboardEvent): void => {
    if (!options.shouldPreventKeyboardDefault(event)) return
    void options.captureKeyboard()
    capturedKeydowns.add(event)
    event.preventDefault()
  }
  const handleKeyDown = (event: KeyboardEvent): void => {
    options.onKeyboardActivity()
    if (event.defaultPrevented && !capturedKeydowns.has(event)) return
    options.onKeyDown(event)
  }
  const handleKeyUp = (event: KeyboardEvent): void => {
    options.onKeyUp(event)
  }
  const handlePointerDown = (event: PointerEvent): void => {
    options.onPointerDown(event)
  }
  const handlePointerMove = (event: PointerEvent): void => {
    options.onPointerMove(event)
  }
  const handleGamepadConnected = (event: GamepadEvent): void => {
    options.onGamepadConnected(event)
  }
  const handleGamepadDisconnected = (event: GamepadEvent): void => {
    options.onGamepadDisconnected(event)
  }
  const handleBlur = (): void => {
    options.onBlur()
  }
  const handleResize = (): void => {
    options.onResize()
  }
  const handleVisualViewportResize = (): void => {
    if (visualViewport) options.onVisualViewportResize(visualViewport.height)
  }

  options.target.addEventListener('keydown', captureKeyDown, true)
  options.target.addEventListener('keydown', handleKeyDown)
  options.target.addEventListener('keyup', handleKeyUp)
  options.target.addEventListener('pointerdown', handlePointerDown, true)
  options.target.addEventListener('pointermove', handlePointerMove, true)
  options.target.addEventListener('gamepadconnected', handleGamepadConnected)
  options.target.addEventListener('gamepaddisconnected', handleGamepadDisconnected)
  options.target.addEventListener('blur', handleBlur)
  options.target.addEventListener('resize', handleResize)
  visualViewport?.addEventListener('resize', handleVisualViewportResize)

  let disposed = false
  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      options.target.removeEventListener('keydown', captureKeyDown, true)
      options.target.removeEventListener('keydown', handleKeyDown)
      options.target.removeEventListener('keyup', handleKeyUp)
      options.target.removeEventListener('pointerdown', handlePointerDown, true)
      options.target.removeEventListener('pointermove', handlePointerMove, true)
      options.target.removeEventListener('gamepadconnected', handleGamepadConnected)
      options.target.removeEventListener('gamepaddisconnected', handleGamepadDisconnected)
      options.target.removeEventListener('blur', handleBlur)
      options.target.removeEventListener('resize', handleResize)
      visualViewport?.removeEventListener('resize', handleVisualViewportResize)
    },
  })
}
