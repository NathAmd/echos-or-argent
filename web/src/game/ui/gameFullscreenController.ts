export type FullscreenRuntimePanel = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

export type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

export type KeyboardLockNavigator = Navigator & {
  keyboard?: {
    lock: (keyCodes?: string[]) => Promise<void>
    unlock: () => void
  }
}

export type GameFullscreenTransition = Readonly<{
  previouslyActive: boolean
  active: boolean
  exitRequested: boolean
}>

export type GameFullscreenControllerOptions = {
  document: FullscreenDocument
  window: Pick<Window, 'matchMedia'>
  navigator: KeyboardLockNavigator
  panel: FullscreenRuntimePanel
  button: HTMLElement
  keyboardCodes: readonly string[]
  onChange?: (transition: GameFullscreenTransition) => void
  onRequestResult?: (enabled: boolean) => void
}

export type GameFullscreenController = {
  isActive: () => boolean
  isInstalled: () => boolean
  isSupported: () => boolean
  captureKeyboard: () => Promise<boolean>
  focus: (force?: boolean) => void
  setEnabled: (enabled: boolean) => Promise<boolean>
  updatePresentation: () => void
  dispose: () => void
}

const fullscreenEvents = ['fullscreenchange', 'webkitfullscreenchange'] as const

function isTextEntry(element: Element | null): boolean {
  if (!element) return false
  return element.tagName === 'INPUT'
    || element.tagName === 'TEXTAREA'
    || element.tagName === 'SELECT'
    || 'isContentEditable' in element && element.isContentEditable === true
}

/** Isole les variantes navigateur et l'état transitoire de sortie plein écran. */
export function createGameFullscreenController(
  options: GameFullscreenControllerOptions,
): GameFullscreenController {
  const { document, window, navigator, panel, button } = options
  let exitRequested = false
  let keyboardLocked = false
  let keyboardLockAttempt: Promise<boolean> | undefined

  const getFullscreenElement = (): Element | null => (
    document.fullscreenElement ?? document.webkitFullscreenElement ?? null
  )
  const isInstalled = (): boolean => window.matchMedia('(display-mode: fullscreen)').matches
  const isActive = (): boolean => Boolean(getFullscreenElement()) || isInstalled()
  const isSupported = (): boolean => (
    document.fullscreenEnabled || typeof panel.webkitRequestFullscreen === 'function'
  )

  const captureKeyboard = (): Promise<boolean> => {
    if (!isActive() || !navigator.keyboard?.lock) return Promise.resolve(false)
    if (keyboardLocked) return Promise.resolve(true)
    if (keyboardLockAttempt) return keyboardLockAttempt
    keyboardLockAttempt = navigator.keyboard.lock([...options.keyboardCodes])
      .then(() => {
        keyboardLocked = isActive()
        if (!keyboardLocked) navigator.keyboard?.unlock()
        return keyboardLocked
      })
      .catch(() => false)
      .finally(() => { keyboardLockAttempt = undefined })
    return keyboardLockAttempt
  }

  const focus = (force = false): void => {
    const active = document.activeElement
    if (isTextEntry(active)) return
    if (!force && active && active !== document.body && active !== document.documentElement) return
    panel.focus({ preventScroll: true })
    // Chromium peut refuser le premier Keyboard Lock selon le contexte de la
    // requête. Chaque vraie reprise de contrôle offre une tentative sûre :
    // Escape émulé par B reste alors dans le jeu au lieu de quitter l'écran.
    void captureKeyboard()
  }

  const setEnabled = async (enabled: boolean): Promise<boolean> => {
    try {
      if (enabled && !isActive()) {
        if (typeof panel.requestFullscreen === 'function') {
          await panel.requestFullscreen({ navigationUI: 'hide' })
        } else if (panel.webkitRequestFullscreen) {
          await panel.webkitRequestFullscreen()
        } else return false
        await captureKeyboard()
      } else if (!enabled && getFullscreenElement()) {
        exitRequested = true
        try {
          navigator.keyboard?.unlock()
          keyboardLocked = false
          if (typeof document.exitFullscreen === 'function') await document.exitFullscreen()
          else await document.webkitExitFullscreen?.()
        } finally {
          exitRequested = false
        }
      }
      focus(true)
      return isActive() === enabled
    } catch {
      return false
    }
  }

  const updatePresentation = (): void => {
    const fullscreen = isActive()
    button.hidden = fullscreen || !isSupported()
    const label = fullscreen ? 'Quitter le plein écran' : 'Passer en plein écran'
    button.setAttribute('aria-label', label)
    button.title = label
  }

  let previouslyActive = isActive()
  const handleFullscreenChange = (): void => {
    const active = isActive()
    if (active) void captureKeyboard()
    else if (keyboardLocked || keyboardLockAttempt) {
      navigator.keyboard?.unlock()
      keyboardLocked = false
    }
    updatePresentation()
    options.onChange?.({ previouslyActive, active, exitRequested })
    previouslyActive = active
  }
  const handleButtonClick = (): void => {
    void setEnabled(true).then((enabled) => {
      updatePresentation()
      options.onRequestResult?.(enabled)
    })
  }

  for (const eventName of fullscreenEvents) document.addEventListener(eventName, handleFullscreenChange)
  button.addEventListener('click', handleButtonClick)

  return {
    isActive,
    isInstalled,
    isSupported,
    captureKeyboard,
    focus,
    setEnabled,
    updatePresentation,
    dispose() {
      for (const eventName of fullscreenEvents) document.removeEventListener(eventName, handleFullscreenChange)
      button.removeEventListener('click', handleButtonClick)
      navigator.keyboard?.unlock()
      keyboardLocked = false
    },
  }
}
