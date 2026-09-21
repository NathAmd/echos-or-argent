import type { GameDigitalAction } from '../../gameInput'

export type NewGamePlusUnlockNotice = {
  isOpen: () => boolean
  show: () => void
  close: () => void
  handle: (action: GameDigitalAction) => boolean
}

export function createNewGamePlusUnlockNotice(host: HTMLElement, onAcknowledge: () => void): NewGamePlusUnlockNotice {
  const root = document.createElement('section')
  root.className = 'new-game-plus-overlay new-game-plus-unlock'
  root.hidden = true
  const panel = document.createElement('article')
  panel.className = 'new-game-plus-panel new-game-plus-unlock-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'new-game-plus-unlock-title')
  const kicker = document.createElement('span')
  kicker.textContent = 'FÉLICITATIONS !'
  const title = document.createElement('h2')
  title.id = 'new-game-plus-unlock-title'
  title.textContent = 'NOUVELLE PARTIE+ DÉBLOQUÉE'
  const copy = document.createElement('p')
  copy.textContent = 'Vous pouvez maintenant créer une nouvelle sauvegarde depuis le menu principal. Votre partie actuelle ne sera ni remplacée ni effacée.'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Compris'
  panel.append(kicker, title, copy, button)
  root.append(panel)
  host.append(root)
  let acknowledged = false

  const close = (): void => {
    if (root.hidden) return
    root.hidden = true
    if (!acknowledged) {
      acknowledged = true
      onAcknowledge()
    }
  }
  button.addEventListener('click', close)
  return {
    isOpen: () => !root.hidden,
    show: () => {
      acknowledged = false
      root.hidden = false
      button.focus({ preventScroll: true })
    },
    close,
    handle: (action) => {
      if (root.hidden) return false
      if (action === 'confirm' || action === 'cancel' || action === 'menu') close()
      return true
    },
  }
}
