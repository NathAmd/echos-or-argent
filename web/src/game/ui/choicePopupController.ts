import type { GameDigitalAction } from '../../gameInput'
import { createModalPresentation } from './modalLifecycle'
import { createUiButton, syncRovingSelection } from './uiPrimitives'

export type ChoicePopupOption<T> = { value: T, label: string }
export type ChoicePopupRequest<T> = {
  title: string
  message: string
  options: readonly ChoicePopupOption<T>[]
  initialIndex?: number
  cancelIndex?: number
  onSelect: (value: T) => void
}

export type ChoicePopupController = {
  isOpen: () => boolean
  open: <T>(request: ChoicePopupRequest<T>) => void
  close: () => void
  handle: (action: GameDigitalAction) => boolean
}

export function createChoicePopupController(root: HTMLElement): ChoicePopupController {
  const title = root.querySelector<HTMLElement>('h2')
  const message = root.querySelector<HTMLElement>('p')
  const nav = root.querySelector<HTMLElement>('nav')
  if (!title || !message || !nav) throw new Error('La modale de choix globale est incomplète.')
  let cursor = 0
  let cancelIndex = 0
  let values: unknown[] = []
  let resolve: ((value: unknown) => void) | undefined
  const presentation = createModalPresentation(root, [title, message, nav])

  const render = (): void => {
    const buttons = [...nav.querySelectorAll<HTMLButtonElement>('button[data-choice-popup-index]')]
    syncRovingSelection(buttons, cursor)
  }
  const close = (): void => {
    if (!presentation.isActive()) return
    resolve = undefined
    values = []
    root.hidden = true
    presentation.restore()
  }
  const select = (index: number): void => {
    const callback = resolve
    if (!callback || index < 0 || index >= values.length) return
    const value = values[index]
    close()
    callback(value)
  }
  const open = <T>(request: ChoicePopupRequest<T>): void => {
    if (request.options.length === 0) throw new Error('Une modale de choix doit proposer au moins une option.')
    if (presentation.isActive()) {
      resolve = undefined
      values = []
      root.hidden = true
      presentation.restore(false)
    }
    presentation.begin()
    values = request.options.map(({ value }) => value)
    cursor = Math.max(0, Math.min(request.options.length - 1, request.initialIndex ?? 0))
    cancelIndex = Math.max(0, Math.min(request.options.length - 1, request.cancelIndex ?? request.options.length - 1))
    resolve = request.onSelect as (value: unknown) => void
    title.textContent = request.title
    message.textContent = request.message
    nav.replaceChildren(...request.options.map(({ label }, index) => createUiButton(
      root.ownerDocument,
      label,
      { choicePopupIndex: String(index) },
    )))
    root.hidden = false
    render()
  }
  const handle = (action: GameDigitalAction): boolean => {
    if (!resolve) return false
    if (action === 'left' || action === 'up') cursor = (cursor - 1 + values.length) % values.length
    else if (action === 'right' || action === 'down') cursor = (cursor + 1) % values.length
    else if (action === 'confirm') { select(cursor); return true }
    else if (action === 'cancel' || action === 'menu') { select(cancelIndex); return true }
    else return false
    render()
    return true
  }
  root.addEventListener('click', (event) => {
    const origin = event.target
    if (!(origin instanceof Element)) return
    const button = origin.closest<HTMLButtonElement>('button[data-choice-popup-index]')
    if (!button || !root.contains(button)) return
    select(Number.parseInt(button.dataset.choicePopupIndex ?? '-1', 10))
  })
  return { isOpen: presentation.isActive, open, close, handle }
}
