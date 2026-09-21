import type { GameDigitalAction } from '../../gameInput'

export type YesNoConfirmationElements = {
  root: HTMLElement
  message: HTMLElement
}

export type YesNoConfirmationController = {
  request: (
    message: string,
    onResolve: (confirmed: boolean) => void,
    defaultConfirmed?: boolean,
  ) => void
  handle: (action: GameDigitalAction) => boolean
  isOpen: () => boolean
}

/**
 * Contrôleur fermé de la modale Oui/Non globale. Il conserve les boutons ROM
 * existants afin que le popup de choix téléphonique puisse toujours emprunter
 * puis restaurer cette même racine DOM.
 */
export function createYesNoConfirmationController(
  elements: YesNoConfirmationElements,
): YesNoConfirmationController {
  let pendingResolve: ((confirmed: boolean) => void) | undefined
  let cursor = 0

  const getButtons = (): HTMLButtonElement[] => [
    ...elements.root.querySelectorAll<HTMLButtonElement>('button[data-confirm-value]'),
  ]

  const renderCursor = (): void => {
    const buttons = getButtons()
    buttons.forEach((button, index) => button.setAttribute('aria-current', String(index === cursor)))
    buttons[cursor]?.focus({ preventScroll: true })
  }

  const resolve = (confirmed: boolean): void => {
    const callback = pendingResolve
    pendingResolve = undefined
    elements.root.hidden = true
    callback?.(confirmed)
  }

  const request: YesNoConfirmationController['request'] = (
    message,
    onResolve,
    defaultConfirmed = false,
  ) => {
    pendingResolve = onResolve
    const buttons = getButtons().sort((left, right) => (
      Number(right.dataset.confirmValue === String(defaultConfirmed))
      - Number(left.dataset.confirmValue === String(defaultConfirmed))
    ))
    buttons[0]?.parentElement?.append(...buttons)
    cursor = 0
    elements.message.textContent = message
    elements.root.hidden = false
    renderCursor()
  }

  const handle = (action: GameDigitalAction): boolean => {
    if (!pendingResolve) return false
    if (action === 'left' || action === 'up') cursor = 0
    else if (action === 'right' || action === 'down') cursor = 1
    else if (action === 'confirm') {
      resolve(getButtons()[cursor]?.dataset.confirmValue === 'true')
      return true
    } else if (action === 'cancel' || action === 'menu') {
      resolve(false)
      return true
    }
    renderCursor()
    return true
  }

  elements.root.addEventListener('click', (event) => {
    if (!pendingResolve) return
    const origin = event.target
    if (!(origin instanceof Element)) return
    const button = origin.closest<HTMLButtonElement>('button[data-confirm-value]')
    if (!button || !elements.root.contains(button)) return
    resolve(button.dataset.confirmValue === 'true')
  })

  return { request, handle, isOpen: () => pendingResolve !== undefined }
}
