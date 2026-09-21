import { classifyGamepadInput, getInputPromptLabels, type InputPromptProfile } from './inputPrompts'

export type InputPromptController = {
  getProfile: () => InputPromptProfile
  refresh: () => void
  activateFocusedControl: (event: KeyboardEvent, pressed: boolean) => boolean
  useGamepad: (id: string) => void
  useKeyboard: () => void
  usePointer: (pointerType: string, x?: number, y?: number) => void
  usePointerMovement: (pointerType: string, x: number, y: number) => void
}

type PointerPosition = { x: number; y: number }

export type PointerModalityArbiterOptions = {
  now?: () => number
  digitalLockMs?: number
  movementThresholdPx?: number
}

export type PointerModalityArbiter = {
  noteDigitalInput: () => void
  notePointerDown: (pointerType: string, x?: number, y?: number) => void
  shouldUsePointerForMovement: (pointerType: string, x: number, y: number) => boolean
}

const enterActivationSelector = 'button, a[href], input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
const spaceActivationSelector = 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'

type ClosestTarget = { closest: (selector: string) => unknown }
type ActivatableControl = {
  click: () => void
  disabled?: boolean
  isConnected?: boolean
  nodeType?: number
  dataset?: DOMStringMap
  closest?: (selector: string) => unknown
  getAttribute?: (name: string) => string | null
}

function getClosestTarget(target: EventTarget | null): ClosestTarget | undefined {
  const candidate = target as Partial<ClosestTarget> | null
  return candidate && typeof candidate.closest === 'function' ? candidate as ClosestTarget : undefined
}

function getActivatableControl(target: EventTarget | null, key: string): ActivatableControl | undefined {
  const closestTarget = getClosestTarget(target)
  if (!closestTarget) return undefined
  const selector = key === 'Enter' ? enterActivationSelector : key === ' ' ? spaceActivationSelector : undefined
  if (!selector) return undefined
  const control = closestTarget.closest(selector) as Partial<ActivatableControl> | null
  // `click()` bypasses the browser's native visibility check. A battle or
  // menu button can retain focus after its whole screen has been hidden.
  if (!control
    || typeof control.click !== 'function'
    || control.disabled === true
    || control.isConnected === false
    || control.dataset?.digitalInputDelegate === 'true'
    || control.getAttribute?.('aria-disabled') === 'true'
    || (control.nodeType === 1 && control.closest?.('[hidden], [inert], [aria-hidden="true"]'))) return undefined
  return control as ActivatableControl
}

/**
 * Owns a physical Enter/Space press until its release. Activating with click()
 * uses the exact focused DOM control and suppresses the browser's second,
 * implicit activation as well as the unrelated global gameplay action.
 */
export function createFocusedControlKeyboardActivation(
  getFocusedTarget: () => EventTarget | null = () => document.activeElement,
): (event: KeyboardEvent, pressed: boolean) => boolean {
  const activatedKeys = new Set<string>()
  return (event, pressed) => {
    if (event.key !== 'Enter' && event.key !== ' ') return false
    if (!pressed && activatedKeys.delete(event.key)) {
      event.preventDefault()
      return true
    }
    const control = getActivatableControl(getFocusedTarget(), event.key)
    if (!control) return false
    event.preventDefault()
    if (!pressed || event.repeat) return true
    activatedKeys.add(event.key)
    control.click()
    return true
  }
}

/** Keeps the menu model aligned when Tab or pointer focus changes the DOM. */
export function syncFocusedMenuControl(target: EventTarget | null, focus: (index: number) => void): boolean {
  const control = getClosestTarget(target)?.closest('button[data-menu-index]') as Partial<ActivatableControl> | null | undefined
  const rawIndex = control?.dataset?.menuIndex ?? control?.getAttribute?.('data-menu-index') ?? undefined
  const index = rawIndex === undefined ? Number.NaN : Number.parseInt(rawIndex, 10)
  if (!Number.isInteger(index) || index < 0) return false
  focus(index)
  return true
}

export function createPointerModalityArbiter(options: PointerModalityArbiterOptions = {}): PointerModalityArbiter {
  const now = options.now ?? (() => performance.now())
  const digitalLockMs = options.digitalLockMs ?? 650
  const movementThresholdPx = options.movementThresholdPx ?? 8
  const thresholdSquared = movementThresholdPx ** 2
  let lastMousePosition: PointerPosition | undefined
  let digitalAnchor: PointerPosition | undefined
  let blockedUntil = Number.NEGATIVE_INFINITY

  const readPosition = (x: number | undefined, y: number | undefined): PointerPosition | undefined => (
    typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y) ? { x, y } : undefined
  )

  return {
    noteDigitalInput() {
      digitalAnchor = lastMousePosition
      blockedUntil = now() + digitalLockMs
    },
    notePointerDown(pointerType, x, y) {
      if (pointerType === 'mouse') lastMousePosition = readPosition(x, y) ?? lastMousePosition
      digitalAnchor = undefined
      blockedUntil = Number.NEGATIVE_INFINITY
    },
    shouldUsePointerForMovement(pointerType, x, y) {
      if (pointerType !== 'mouse') return false
      const position = readPosition(x, y)
      if (!position) return false
      const anchor = digitalAnchor ?? lastMousePosition
      lastMousePosition = position
      if (!anchor) {
        digitalAnchor = position
        return false
      }
      digitalAnchor ??= anchor
      if (now() < blockedUntil) {
        digitalAnchor = position
        return false
      }
      const deltaX = position.x - digitalAnchor.x
      const deltaY = position.y - digitalAnchor.y
      if (deltaX ** 2 + deltaY ** 2 < thresholdSquared) return false
      digitalAnchor = undefined
      return true
    },
  }
}

export function createInputPromptController(
  root: HTMLElement,
  menuButton: HTMLButtonElement,
  menuButtonKey: HTMLElement,
): InputPromptController {
  let profile: InputPromptProfile = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard'
  const pointerModality = createPointerModalityArbiter()
  const activateFocusedControl = createFocusedControlKeyboardActivation()

  const refresh = (): void => {
    const labels = getInputPromptLabels(profile)
    root.dataset.inputProfile = profile
    root.dataset.inputModality = profile === 'mouse' || profile === 'touch' ? 'pointer' : 'digital'
    menuButtonKey.textContent = labels.menu
    menuButton.setAttribute('aria-label', `Ouvrir le menu du jeu · ${labels.menu}`)
    for (const element of root.querySelectorAll<HTMLElement>('[data-input-key]')) {
      const action = element.dataset.inputKey as keyof typeof labels
      element.textContent = labels[action]
    }
    for (const hint of root.querySelectorAll<HTMLElement>('.ui-menu-hint[data-input]')) {
      const action = hint.dataset.input as 'confirm' | 'cancel'
      hint.dataset.key = labels[action]
    }
  }

  const setProfile = (next: InputPromptProfile): void => {
    if (profile === next) return
    profile = next
    refresh()
  }

  refresh()
  return {
    getProfile: () => profile,
    refresh,
    activateFocusedControl,
    useGamepad: (id) => { pointerModality.noteDigitalInput(); setProfile(classifyGamepadInput(id)) },
    useKeyboard: () => { pointerModality.noteDigitalInput(); setProfile('keyboard') },
    usePointer: (pointerType, x, y) => { pointerModality.notePointerDown(pointerType, x, y); setProfile(pointerType === 'touch' || pointerType === 'pen' ? 'touch' : 'mouse') },
    usePointerMovement: (pointerType, x, y) => { if (pointerModality.shouldUsePointerForMovement(pointerType, x, y)) setProfile('mouse') },
  }
}
