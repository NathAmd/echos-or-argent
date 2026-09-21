import type { GameDigitalAction, GameInputRouter } from '../gameInput'

const touchControlsMediaQuery = '(any-pointer: coarse), (hover: none)'
const touchControlsUnavailableReason = 'Les commandes tactiles ne sont pas disponibles sur cet appareil.'

type TouchControlsMediaQuery = Readonly<{
  matches: boolean
  addEventListener?: MediaQueryList['addEventListener']
  removeEventListener?: MediaQueryList['removeEventListener']
  addListener?: MediaQueryList['addListener']
  removeListener?: MediaQueryList['removeListener']
}>

type GameTouchControlsDependencies = Readonly<{
  mediaQuery?: TouchControlsMediaQuery | null
  maximumTouchPoints?: number
}>

export type GameTouchControlsOptions = Readonly<{
  panel: HTMLElement
  dispatch: GameInputRouter['dispatch']
  isEnabled: () => boolean
  isBlocked: () => boolean
  dependencies?: GameTouchControlsDependencies
}>

export type GameTouchControlsState = Readonly<{
  available: boolean
  visible: boolean
  reason?: string
}>

export type GameTouchControls = Readonly<{
  getState: () => GameTouchControlsState
  sync: () => void
  reset: () => void
  dispose: () => void
}>

type TouchControlDefinition = Readonly<{
  action: GameDigitalAction
  label: string
  glyph: string
  className: string
}>

type ActiveTouch = Readonly<{
  action: GameDigitalAction
  inputId: string
  control: HTMLButtonElement
}>

const directions = Object.freeze([
  { action: 'up', label: 'Haut', glyph: '▲', className: 'game-touch-control-up' },
  { action: 'left', label: 'Gauche', glyph: '◀', className: 'game-touch-control-left' },
  { action: 'right', label: 'Droite', glyph: '▶', className: 'game-touch-control-right' },
  { action: 'down', label: 'Bas', glyph: '▼', className: 'game-touch-control-down' },
] as const satisfies readonly TouchControlDefinition[])

const actions = Object.freeze([
  { action: 'cancel', label: 'Retour', glyph: 'B', className: 'game-touch-control-b' },
  { action: 'confirm', label: 'Confirmer', glyph: 'A', className: 'game-touch-control-a' },
  { action: 'menu', label: 'Menu', glyph: '☰', className: 'game-touch-control-menu' },
] as const satisfies readonly TouchControlDefinition[])

function createControl(document: Document, definition: TouchControlDefinition): HTMLButtonElement {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = `game-touch-control ${definition.className}`
  control.dataset.gameTouchAction = definition.action
  control.setAttribute('aria-label', definition.label)
  control.textContent = definition.glyph
  return control
}

function resolveMediaQuery(
  panel: HTMLElement,
  dependencies: GameTouchControlsDependencies | undefined,
): TouchControlsMediaQuery | null {
  if (dependencies && 'mediaQuery' in dependencies) return dependencies.mediaQuery ?? null
  return panel.ownerDocument.defaultView?.matchMedia?.(touchControlsMediaQuery) ?? null
}

function resolveMaximumTouchPoints(
  panel: HTMLElement,
  dependencies: GameTouchControlsDependencies | undefined,
): number {
  if (dependencies?.maximumTouchPoints !== undefined) return dependencies.maximumTouchPoints
  return panel.ownerDocument.defaultView?.navigator.maxTouchPoints ?? 0
}

/**
 * Ajoute un seul pad tactile au panneau de jeu. Les appuis maintenus passent
 * par le même routeur numérique que clavier et manette; aucune logique de jeu
 * ni aucune saisie de texte parallèle ne vit dans cette couche navigateur.
 */
export function createGameTouchControls(options: GameTouchControlsOptions): GameTouchControls {
  const document = options.panel.ownerDocument
  const mediaQuery = resolveMediaQuery(options.panel, options.dependencies)
  const maximumTouchPoints = resolveMaximumTouchPoints(options.panel, options.dependencies)
  const isAvailable = (): boolean => Boolean(mediaQuery?.matches || maximumTouchPoints > 0)
  const root = document.createElement('section')
  root.className = 'game-touch-controls'
  root.hidden = true
  root.inert = true
  root.setAttribute('aria-label', 'Commandes tactiles')
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('data-bug-report-exclude', '')

  const directionPad = document.createElement('div')
  directionPad.className = 'game-touch-dpad'
  directionPad.setAttribute('aria-label', 'Directions')
  const actionPad = document.createElement('div')
  actionPad.className = 'game-touch-actions'
  actionPad.setAttribute('aria-label', 'Actions')
  const activeTouches = new Map<number, ActiveTouch>()
  const activeActionCounts = new Map<GameDigitalAction, number>()
  const listeners: (() => void)[] = []
  let disposed = false
  let state: GameTouchControlsState = Object.freeze({
    available: isAvailable(),
    visible: false,
    ...(isAvailable() ? {} : { reason: touchControlsUnavailableReason }),
  })

  const preventNativeGesture = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const releaseTouch = (pointerId: number): void => {
    const active = activeTouches.get(pointerId)
    if (!active) return
    activeTouches.delete(pointerId)
    const remaining = Math.max(0, (activeActionCounts.get(active.action) ?? 1) - 1)
    if (remaining > 0) activeActionCounts.set(active.action, remaining)
    else {
      activeActionCounts.delete(active.action)
      delete active.control.dataset.pressed
      options.dispatch(active.action, false, 'pointer', active.inputId)
    }
  }

  const releaseAll = (): void => {
    for (const pointerId of [...activeTouches.keys()]) releaseTouch(pointerId)
  }

  const bindControl = (definition: TouchControlDefinition, parent: HTMLElement): void => {
    const control = createControl(document, definition)
    const press = (event: PointerEvent): void => {
      preventNativeGesture(event)
      if (disposed || root.hidden || !options.isEnabled() || options.isBlocked() || activeTouches.has(event.pointerId)) return
      const inputId = `touch:${definition.action}:${event.pointerId}`
      const count = activeActionCounts.get(definition.action) ?? 0
      activeTouches.set(event.pointerId, { action: definition.action, inputId, control })
      activeActionCounts.set(definition.action, count + 1)
      if (count === 0) {
        control.dataset.pressed = 'true'
        options.dispatch(definition.action, true, 'pointer', inputId)
      }
      try { control.setPointerCapture?.(event.pointerId) } catch { /* Le pointeur peut déjà être relâché. */ }
    }
    const release = (event: PointerEvent): void => {
      preventNativeGesture(event)
      releaseTouch(event.pointerId)
    }
    const contextMenu = (event: Event): void => { preventNativeGesture(event) }
    control.addEventListener('pointerdown', press)
    control.addEventListener('pointerup', release)
    control.addEventListener('pointercancel', release)
    control.addEventListener('lostpointercapture', release)
    control.addEventListener('contextmenu', contextMenu)
    listeners.push(() => {
      control.removeEventListener('pointerdown', press)
      control.removeEventListener('pointerup', release)
      control.removeEventListener('pointercancel', release)
      control.removeEventListener('lostpointercapture', release)
      control.removeEventListener('contextmenu', contextMenu)
    })
    parent.append(control)
  }

  directions.forEach((definition) => { bindControl(definition, directionPad) })
  actions.forEach((definition) => { bindControl(definition, actionPad) })
  root.append(directionPad, actionPad)
  options.panel.append(root)

  const sync = (): void => {
    if (disposed) return
    const available = isAvailable()
    const visible = available && options.isEnabled() && !options.isBlocked()
    if (!visible) releaseAll()
    root.hidden = !visible
    root.inert = !visible
    root.setAttribute('aria-hidden', String(!visible))
    state = Object.freeze({
      available,
      visible,
      ...(available ? {} : { reason: touchControlsUnavailableReason }),
    })
  }

  const handleCapabilityChange = (): void => { sync() }
  if (typeof mediaQuery?.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleCapabilityChange)
  } else {
    mediaQuery?.addListener?.(handleCapabilityChange)
  }
  sync()

  return Object.freeze({
    getState: () => state,
    sync,
    reset: releaseAll,
    dispose() {
      if (disposed) return
      disposed = true
      releaseAll()
      if (typeof mediaQuery?.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleCapabilityChange)
      } else {
        mediaQuery?.removeListener?.(handleCapabilityChange)
      }
      listeners.splice(0).forEach((detach) => { detach() })
      root.remove()
    },
  })
}
