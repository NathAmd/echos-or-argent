import type { GameDigitalAction } from '../../gameInput'
import {
  createTitleSaveDeletionController,
  type TitleSaveDeletionDetails,
  type TitleSaveDeletionResult,
  type TitleSaveDeletionState,
} from './titleSaveDeletionController'

export type TitleSaveDeletionUi = {
  isOpen: () => boolean
  open: (details: TitleSaveDeletionDetails) => void
  close: () => void
  handle: (action: GameDigitalAction) => boolean
}

export function createTitleSaveDeletionUi(
  host: HTMLElement,
  callbacks: {
    onConfirm: (details: TitleSaveDeletionDetails) => void
    onCancel?: () => void
  },
): TitleSaveDeletionUi {
  const root = document.createElement('section')
  root.className = 'title-save-delete-overlay'
  root.hidden = true
  const panel = document.createElement('article')
  panel.className = 'title-save-delete-panel'
  panel.setAttribute('role', 'alertdialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'title-save-delete-title')
  panel.setAttribute('aria-describedby', 'title-save-delete-copy')
  const kicker = document.createElement('span')
  kicker.textContent = 'GESTION DE SAUVEGARDE'
  const title = document.createElement('h2')
  title.id = 'title-save-delete-title'
  title.textContent = 'SUPPRIMER CETTE PARTIE ?'
  const copy = document.createElement('p')
  copy.id = 'title-save-delete-copy'
  const warning = document.createElement('strong')
  warning.textContent = 'Cette action est définitive. Les autres emplacements seront conservés.'
  const actions = document.createElement('footer')
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.dataset.titleSaveDeleteIndex = '0'
  cancel.textContent = 'Annuler'
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.className = 'title-save-delete-confirm'
  confirm.dataset.titleSaveDeleteIndex = '1'
  confirm.textContent = 'Supprimer définitivement'
  actions.append(cancel, confirm)
  panel.append(kicker, title, copy, warning, actions)
  root.append(panel)
  host.append(root)

  const controller = createTitleSaveDeletionController()
  const buttons = [cancel, confirm]
  let previousFocus: HTMLElement | undefined

  const sync = (state: TitleSaveDeletionState): void => {
    root.hidden = !state.open
    title.textContent = state.details?.kind === 'corrupt' ? 'SUPPRIMER CES DONNÉES CORROMPUES ?' : 'SUPPRIMER CETTE PARTIE ?'
    copy.textContent = state.details
      ? `Emplacement ${state.details.slot} · ${state.details.playerName} · ${state.details.summary}`
      : ''
    warning.textContent = state.details?.kind === 'corrupt'
      ? 'Les octets illisibles sont conservés tant que vous ne confirmez pas explicitement cette suppression.'
      : 'Cette action est définitive. Les autres emplacements seront conservés.'
    buttons.forEach((button, index) => {
      button.setAttribute('aria-current', String(state.open && state.cursor === index))
      button.tabIndex = state.open && state.cursor === index ? 0 : -1
    })
    if (state.open) buttons[state.cursor].focus({ preventScroll: true })
  }
  const apply = (result: TitleSaveDeletionResult): boolean => {
    if (result.kind === 'ignored') return false
    sync(result.state)
    if (result.kind === 'confirmed') {
      previousFocus = undefined
      callbacks.onConfirm(result.details)
    } else if (result.kind === 'cancelled') {
      const target = previousFocus
      previousFocus = undefined
      callbacks.onCancel?.()
      target?.focus({ preventScroll: true })
    }
    return true
  }

  root.addEventListener('click', (event) => {
    const origin = event.target
    if (!(origin instanceof Element)) return
    const button = origin.closest<HTMLButtonElement>('button[data-title-save-delete-index]')
    if (!button || !root.contains(button)) return
    controller.focus(Number.parseInt(button.dataset.titleSaveDeleteIndex ?? '', 10))
    apply(controller.handle('confirm'))
  })

  return {
    isOpen: () => controller.getState().open,
    open: (details) => {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      sync(controller.open(details))
    },
    close: () => {
      previousFocus = undefined
      sync(controller.close())
    },
    handle: (action) => apply(controller.handle(action)),
  }
}
