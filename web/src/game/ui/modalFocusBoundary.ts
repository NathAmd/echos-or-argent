type AccessibilitySnapshot = Readonly<{
  element: HTMLElement
  inert: boolean
  ariaHidden: string | null
}>

export type ModalFocusBoundary = Readonly<{
  activate: () => void
  restore: () => void
  handleTab: (event: KeyboardEvent) => boolean
  isActive: () => boolean
}>

export type ModalFocusBoundaryOptions = Readonly<{
  host: HTMLElement
  root: HTMLElement
  getFocusableElements: () => readonly HTMLElement[]
}>

function canFocus(element: HTMLElement, boundary: HTMLElement): boolean {
  const candidate = element as HTMLElement & { disabled?: boolean, type?: string }
  if (candidate.disabled || candidate.hidden || candidate.inert || candidate.type === 'hidden') return false
  for (let ancestor = element.parentElement; ancestor && ancestor !== boundary; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.inert || ancestor.getAttribute('aria-hidden') === 'true') return false
  }
  return true
}

function restoreAccessibility(snapshot: AccessibilitySnapshot): void {
  snapshot.element.inert = snapshot.inert
  if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden')
  else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden)
}

function hasFocusMethod(value: Element | null): value is HTMLElement {
  return value !== null && typeof (value as HTMLElement).focus === 'function'
}

/**
 * Owns the browser modality shared by full-screen game dialogs: sibling
 * isolation, deterministic Tab wrapping, and trigger-focus restoration.
 */
export function createModalFocusBoundary(options: ModalFocusBoundaryOptions): ModalFocusBoundary {
  const { host, root } = options
  const document = host.ownerDocument
  let active = false
  let returnFocus: HTMLElement | undefined
  let siblingSnapshots: AccessibilitySnapshot[] = []
  let rootSnapshot: AccessibilitySnapshot | undefined

  const activate = (): void => {
    if (active) return
    active = true
    const previous = document.activeElement
    returnFocus = hasFocusMethod(previous) && !root.contains(previous) ? previous : undefined
    siblingSnapshots = []
    for (const sibling of host.children) {
      if (sibling === root) continue
      const element = sibling as HTMLElement
      siblingSnapshots.push({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute('aria-hidden'),
      })
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    rootSnapshot = {
      element: root,
      inert: root.inert,
      ariaHidden: root.getAttribute('aria-hidden'),
    }
    root.inert = false
    root.removeAttribute('aria-hidden')
  }

  const restore = (): void => {
    if (!active) return
    active = false
    const snapshots = siblingSnapshots
    siblingSnapshots = []
    snapshots.forEach(restoreAccessibility)
    if (rootSnapshot) restoreAccessibility(rootSnapshot)
    rootSnapshot = undefined
    const target = returnFocus
    returnFocus = undefined
    if (
      target
      && (target.isConnected || host.contains(target))
      && canFocus(target, host)
    ) target.focus({ preventScroll: true })
  }

  const handleTab = (event: KeyboardEvent): boolean => {
    if (!active || event.key !== 'Tab') return false
    event.preventDefault()
    event.stopPropagation()
    const focusable = options.getFocusableElements().filter((element) => canFocus(element, root))
    if (focusable.length === 0) {
      root.focus({ preventScroll: true })
      return true
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const delta = event.shiftKey ? -1 : 1
    const next = current < 0
      ? event.shiftKey ? focusable.length - 1 : 0
      : (current + delta + focusable.length) % focusable.length
    focusable[next]?.focus({ preventScroll: true })
    return true
  }

  return Object.freeze({
    activate,
    restore,
    handleTab,
    isActive: () => active,
  })
}
