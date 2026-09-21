export type GameMenuButtonOptions = {
  id: string
  index: number
  label: string
  ownerDocument?: Document
  detail?: string
  selected?: boolean
  tone?: 'danger'
  asset?: HTMLElement
  state?: GameMenuButtonState
}

export type GameMenuButtonState = {
  value: string
  token: string
  pressed?: boolean
  position?: number
  size?: number
}

export function getMenuArcOffset(index: number, total: number, maximum = 32): number {
  if (total <= 1) return 0
  const center = (total - 1) / 2
  const normalizedDistance = Math.abs(index - center) / (total / 2)
  return Math.round(normalizedDistance ** 2 * maximum)
}

export function getRovingMenuTabIndex(selected: boolean, persistent = false): 0 | -1 {
  return selected || persistent ? 0 : -1
}

export function createGameMenuButton(options: GameMenuButtonOptions): HTMLButtonElement {
  const ownerDocument = options.ownerDocument ?? document
  const button = ownerDocument.createElement('button')
  button.type = 'button'
  button.className = 'ui-menu-button'
  button.dataset.menuIndex = String(options.index)
  button.dataset.menuId = options.id
  button.style.setProperty('--menu-order', String(options.index))
  button.setAttribute('aria-current', String(Boolean(options.selected)))
  button.tabIndex = getRovingMenuTabIndex(Boolean(options.selected))
  if (options.tone) button.dataset.menuTone = options.tone
  if (options.asset) button.classList.add('game-menu-button-with-asset')

  const copy = ownerDocument.createElement('span')
  copy.className = 'game-menu-button-copy'
  const label = ownerDocument.createElement('span')
  label.className = 'game-menu-button-label'
  label.textContent = options.label
  copy.append(label)
  if (options.detail || options.state) {
    const detail = ownerDocument.createElement('small')
    if (options.state) detail.dataset.menuStateValue = ''
    detail.textContent = options.state?.value ?? options.detail ?? ''
    copy.append(detail)
  }
  button.append(...(options.asset ? [options.asset] : []), copy)
  if (options.state) syncGameMenuButtonStatePresentation(button, options.state)
  return button
}

/** Met à jour la valeur visible et accessible d'un bouton sans remplacer son DOM. */
export function syncGameMenuButtonStatePresentation(button: HTMLButtonElement, state: GameMenuButtonState): boolean {
  const label = button.querySelector<HTMLElement>('.game-menu-button-label')
  const value = button.querySelector<HTMLElement>('[data-menu-state-value]')
  if (!label || !value) return false
  value.textContent = state.value
  value.setAttribute('aria-hidden', 'true')
  button.dataset.menuStateToken = state.token
  button.setAttribute('aria-label', [label.textContent, state.value].filter(Boolean).join(' '))
  if (state.pressed === undefined) button.removeAttribute('aria-pressed')
  else button.setAttribute('aria-pressed', String(state.pressed))
  if (state.position === undefined || state.size === undefined) {
    delete button.dataset.menuStatePosition
    delete button.dataset.menuStateSize
  } else {
    button.dataset.menuStatePosition = String(state.position)
    button.dataset.menuStateSize = String(state.size)
  }
  return true
}

export function syncGameMenuButtonStatesPresentation(
  root: ParentNode,
  resolve: (id: string) => GameMenuButtonState | undefined,
): number {
  let synced = 0
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-menu-id]')) {
    const state = resolve(button.dataset.menuId ?? '')
    if (state && syncGameMenuButtonStatePresentation(button, state)) synced += 1
  }
  return synced
}

/** Synchronise en une passe le curseur visuel, le tabstop et le focus réel. */
export function syncGameMenuCursorPresentation(
  root: ParentNode,
  cursor: number,
  activeElement: EventTarget | null = document.activeElement,
): HTMLButtonElement | undefined {
  let focused: HTMLButtonElement | undefined
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-menu-index]')) {
    const selected = Number(button.dataset.menuIndex) === cursor
    button.setAttribute('aria-current', String(selected))
    button.tabIndex = getRovingMenuTabIndex(selected, button.classList.contains('ui-menu-back'))
    if (selected) focused = button
  }
  if (!focused) return undefined
  if (activeElement !== focused) focused.focus({ preventScroll: true })
  focused.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return focused
}

export function createGameMenuNavigation(
  buttons: readonly HTMLButtonElement[],
  kind: 'root' | 'screen',
  ownerDocument: Document = buttons[0]?.ownerDocument ?? document,
): HTMLElement {
  const navigation = ownerDocument.createElement('div')
  navigation.className = `ui-menu-navigation ui-menu-navigation-${kind}`
  navigation.setAttribute('role', 'navigation')
  if (kind === 'root') buttons.forEach((button, index) => button.style.setProperty('--arc-offset', `${getMenuArcOffset(index, buttons.length)}px`))
  navigation.replaceChildren(...buttons)
  return navigation
}

export function createGameMenuHeader(
  title: string,
  close?: { index: number, selected: boolean, label?: string, targetId?: string },
): HTMLElement {
  const header = document.createElement('header')
  header.className = 'game-menu-header ui-menu-header'
  const heading = document.createElement('h2')
  heading.id = 'game-menu-title'
  heading.textContent = title
  const rule = document.createElement('span')
  rule.className = 'game-menu-header-rule'
  rule.setAttribute('aria-hidden', 'true')
  header.append(heading, rule)
  if (close) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'game-menu-close ui-menu-back'
    button.dataset.menuIndex = String(close.index)
    button.dataset.menuId = close.targetId ?? 'root'
    const key = document.createElement('kbd')
    key.dataset.inputKey = 'cancel'
    key.textContent = 'Esc'
    if (close.label) {
      button.setAttribute('aria-label', close.label)
      key.setAttribute('aria-hidden', 'true')
    }
    button.append(key)
    button.setAttribute('aria-current', String(close.selected))
    header.append(button)
  }
  return header
}
