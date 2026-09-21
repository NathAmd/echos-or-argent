import type { GameDigitalEvent } from '../../gameInput'
import type { GameTextEntryRequest } from '../ui/gameTextEntryOverlay'
import { createModalFocusBoundary } from '../ui/modalFocusBoundary'
import {
  createTitleAccountGateCoordinator,
  type TitleAccountGateCoordinatorOptions,
  type TitleAccountGateState,
  type TitleAccountMode,
} from './titleAccountGateCoordinator'

export { createTitleAccountGateCoordinator } from './titleAccountGateCoordinator'
export type {
  TitleAccountGateCoordinator,
  TitleAccountGateCoordinatorOptions,
  TitleAccountGateSession,
  TitleAccountGateState,
  TitleAccountMode,
  TitleSaveCatalogAccess,
  TitleSaveCatalogConflictResolution,
  TitleSaveCatalogConflictResolutions,
  TitleSaveCatalogConflictChoice,
  TitleSaveCatalogConflictKind,
  TitleSaveCatalogLocalConflictVersion,
  TitleSaveCatalogLocalImportChoice,
  TitleSaveCatalogLocalImportDecision,
} from './titleAccountGateCoordinator'

export type TitleAccountGateHostOptions = TitleAccountGateCoordinatorOptions & Readonly<{
  host: HTMLElement
  /** Ouvre l'unique saisie de texte partagée par le jeu. */
  requestTextEntry: (request: GameTextEntryRequest) => void
  /** Ferme la saisie partagée et en efface la présentation. */
  closeTextEntry?: () => void
  onCancel?: () => void
}>

export type TitleAccountGateHost = Readonly<{
  open: () => Promise<void>
  openNotice: (message: string) => Promise<void>
  close: () => void
  isOpen: () => boolean
  getState: () => TitleAccountGateState
  handleDigitalEvent: (event: GameDigitalEvent) => boolean
  destroy: () => void
}>

type AccountControl = HTMLButtonElement | HTMLInputElement
type AccountField = 'username' | 'password'

const usernamePattern = /^[A-Za-z0-9._-]{3,32}$/

function isValidPassword(value: string): boolean {
  return value.length >= 10 && value.length <= 128 && new TextEncoder().encode(value).byteLength <= 256
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function markControl<T extends AccountControl>(control: T, key: string): T {
  control.dataset.titleAccountControl = 'true'
  control.dataset.titleAccountKey = key
  return control
}

function createButton(
  document: Document,
  key: string,
  label: string,
  className: string,
  activate: () => void,
): HTMLButtonElement {
  const button = markControl(createElement(document, 'button', className, label), key)
  button.type = 'button'
  button.addEventListener('click', () => { activate() })
  return button
}

function isAccountControl(element: Element | null): element is AccountControl {
  const tagName = element?.tagName.toUpperCase()
  return tagName === 'BUTTON' || tagName === 'INPUT'
}

function stageLabel(state: TitleAccountGateState): string {
  switch (state.stage) {
    case 'restoring': return 'Connexion…'
    case 'authenticating': return state.mode === 'login' ? 'Connexion…' : 'Création…'
    case 'authorizing': return 'Ouverture…'
    case 'account-choice': return state.account.username
    case 'unavailable': return state.message
    case 'catalog-error': return state.message
    case 'catalog-busy': return state.message
    case 'catalog-conflict': return state.message
    case 'local-import': return state.transferCount === 1
      ? '1 sauvegarde locale à importer.'
      : `${state.transferCount} sauvegardes locales à importer.`
    default: return ''
  }
}

export function createTitleAccountGateHost(options: TitleAccountGateHostOptions): TitleAccountGateHost {
  const document = options.host.ownerDocument
  const root = createElement(document, 'section', 'title-account-gate')
  root.hidden = true
  root.dataset.titleAccountStage = 'closed'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-labelledby', 'title-account-heading')
  options.host.append(root)

  const coordinator = createTitleAccountGateCoordinator(options)
  let usernameValue = ''
  let passwordValue = ''
  let destroyed = false

  const purgeCredentials = (): void => {
    usernameValue = ''
    passwordValue = ''
    options.closeTextEntry?.()
  }

  const controls = (): AccountControl[] => Array.from(
    root.querySelectorAll<AccountControl>('[data-title-account-control="true"]'),
  ).filter((control) => !control.disabled && !control.hidden)

  const updateCurrentControl = (active: Element | null = document.activeElement): void => {
    for (const control of controls()) {
      control.setAttribute('aria-current', String(control === active))
    }
  }

  const focusControl = (control: AccountControl | undefined): void => {
    control?.focus()
    updateCurrentControl(control ?? null)
  }

  const focusByKey = (key: string | undefined, fallback?: string): void => {
    const available = controls()
    focusControl(
      available.find((control) => control.dataset.titleAccountKey === key)
      ?? available.find((control) => control.dataset.titleAccountKey === fallback)
      ?? available[0],
    )
  }

  const focusBoundary = createModalFocusBoundary({
    host: options.host,
    root,
    getFocusableElements: () => controls(),
  })

  const appendVisual = (panel: HTMLElement, state: TitleAccountGateState): void => {
    const visual = createElement(document, 'div', 'title-account-visual')
    visual.setAttribute('aria-hidden', 'true')
    const orbit = createElement(document, 'i', 'title-account-orbit')
    orbit.append(
      createElement(document, 'i', 'title-account-orbit-ring'),
      createElement(document, 'i', 'title-account-orbit-core'),
    )
    const signal = createElement(document, 'span', 'title-account-signal')
    signal.dataset.accountSignal = state.stage
    visual.append(orbit, signal)
    panel.append(visual)
  }

  const appendHeading = (content: HTMLElement): void => {
    const heading = createElement(document, 'header', 'title-account-header')
    heading.append(
      createElement(document, 'span', 'title-account-kicker', 'DOSSIER DRESSEUR'),
      createElement(document, 'h2', 'title-account-heading', 'Connexion'),
    )
    const title = heading.querySelector('h2')
    if (title) title.id = 'title-account-heading'
    content.append(heading)
  }

  const appendStatus = (content: HTMLElement, state: TitleAccountGateState): void => {
    const message = stageLabel(state)
    if (!message) return
    const status = createElement(document, 'p', 'title-account-status', message)
    const isError = state.stage === 'unavailable'
      || state.stage === 'catalog-error'
      || state.stage === 'catalog-busy'
      || state.stage === 'catalog-conflict'
    status.setAttribute('role', isError ? 'alert' : 'status')
    status.setAttribute('aria-live', isError ? 'assertive' : 'polite')
    content.append(status)
  }

  const appendNotice = (content: HTMLElement, state: TitleAccountGateState): void => {
    if (!('notice' in state) || !state.notice) return
    const notice = createElement(document, 'p', 'title-account-status title-account-notice', state.notice)
    notice.setAttribute('role', 'status')
    content.append(notice)
  }

  const requestFieldEntry = (input: HTMLInputElement, field: AccountField): void => {
    const password = field === 'password'
    const write = (value: string): void => {
      input.value = value
      if (password) passwordValue = value
      else usernameValue = value
    }
    options.requestTextEntry({
      mode: password ? 'password' : 'account',
      title: password ? 'Mot de passe' : 'Identifiant',
      maxLength: password ? 128 : 32,
      cancellable: true,
      invalidMessage: password
        ? '10 caractères minimum.'
        : '3 à 32 caractères valides.',
      read: () => input.value,
      write,
      submit: (value) => { write(value); input.focus() },
      cancel: () => { input.focus() },
      validate: password
        ? isValidPassword
        : (value) => usernamePattern.test(value.normalize('NFKC').trim()),
    })
  }

  const appendAccountForm = (
    content: HTMLElement,
    state: Extract<TitleAccountGateState, { stage: 'signed-out' }>,
  ): void => {
    const modeNavigation = createElement(document, 'nav', 'title-account-modes')
    modeNavigation.setAttribute('aria-label', 'Compte en ligne')
    const addMode = (mode: TitleAccountMode, label: string): void => {
      const button = createButton(
        document,
        `mode-${mode}`,
        label,
        'title-account-mode',
        () => { coordinator.selectMode(mode) },
      )
      button.setAttribute('aria-pressed', String(state.mode === mode))
      modeNavigation.append(button)
    }
    addMode('login', 'Connexion')
    addMode('register', 'Créer')

    const form = createElement(document, 'form', 'title-account-form')
    const usernameLabel = createElement(document, 'label', 'title-account-field')
    usernameLabel.append(createElement(document, 'span', '', 'Identifiant'))
    const username = markControl(createElement(document, 'input', 'title-account-input'), 'username')
    username.dataset.titleAccountField = 'username'
    username.type = 'text'
    username.value = usernameValue
    username.maxLength = 32
    username.autocomplete = 'username'
    username.autocapitalize = 'none'
    username.spellcheck = false
    username.readOnly = true
    username.inputMode = 'none'
    username.setAttribute('aria-haspopup', 'dialog')
    username.addEventListener('input', () => { usernameValue = username.value })
    username.addEventListener('click', () => { requestFieldEntry(username, 'username') })
    usernameLabel.append(username)

    const passwordLabel = createElement(document, 'label', 'title-account-field')
    passwordLabel.append(createElement(document, 'span', '', 'Mot de passe'))
    const password = markControl(createElement(document, 'input', 'title-account-input'), 'password')
    password.dataset.titleAccountField = 'password'
    password.type = 'password'
    password.value = passwordValue
    password.maxLength = 128
    password.autocomplete = state.mode === 'login' ? 'current-password' : 'new-password'
    password.readOnly = true
    password.inputMode = 'none'
    password.setAttribute('aria-haspopup', 'dialog')
    password.addEventListener('input', () => { passwordValue = password.value })
    password.addEventListener('click', () => { requestFieldEntry(password, 'password') })
    passwordLabel.append(password)

    const submit = markControl(createElement(
      document,
      'button',
      'title-account-action title-account-action-primary',
      state.mode === 'login' ? 'Se connecter' : 'Créer le compte',
    ), 'submit')
    submit.type = 'submit'

    form.append(usernameLabel, passwordLabel, submit)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const credentials = Object.freeze({ username: usernameValue, password: passwordValue })
      purgeCredentials()
      void (state.mode === 'login'
        ? coordinator.login(credentials)
        : coordinator.register(credentials))
    })
    content.append(modeNavigation, form)
    if (state.message) {
      const error = createElement(document, 'p', 'title-account-status', state.message)
      error.setAttribute('role', 'alert')
      content.append(error)
    }
  }

  const appendActions = (content: HTMLElement, state: TitleAccountGateState): void => {
    const actions = createElement(document, 'footer', 'title-account-actions')
    if (state.stage === 'account-choice') {
      actions.append(
        createButton(
          document,
          'continue-account',
          'Continuer',
          'title-account-action title-account-action-primary',
          () => { purgeCredentials(); void coordinator.continueWithAccount() },
        ),
        createButton(
          document,
          'switch-account',
          'Changer de compte',
          'title-account-action',
          () => { purgeCredentials(); void coordinator.switchAccount() },
        ),
      )
    }
    if (state.stage === 'unavailable' && state.canRetry) {
      actions.append(createButton(
        document,
        'retry',
        'Réessayer',
        'title-account-action title-account-action-primary',
        () => { void coordinator.retry() },
      ))
    }
    if (state.stage === 'catalog-error') {
      if (state.access.kind === 'online') {
        const account = state.access.account
        actions.append(createButton(
          document,
          'reconnect',
          'Reconnecter',
          'title-account-action title-account-action-primary',
          () => {
            usernameValue = account.username
            passwordValue = ''
            coordinator.reconnect()
          },
        ))
      }
      actions.append(createButton(
        document,
        'retry-catalog',
        'Réessayer',
        `title-account-action${state.access.kind === 'local' ? ' title-account-action-primary' : ''}`,
        () => { void coordinator.retryCatalog() },
      ))
      if (state.access.kind === 'online') {
        actions.append(createButton(
          document,
          'account-cache',
          'Hors ligne',
          'title-account-action title-account-action-local',
          () => { void coordinator.useAccountCache() },
        ))
      }
    }
    if (state.stage === 'catalog-busy') {
      actions.append(createButton(
        document,
        'retry-catalog',
        'Réessayer',
        'title-account-action title-account-action-primary',
        () => { void coordinator.retryCatalog() },
      ))
    }
    if (state.stage === 'catalog-conflict') {
      actions.append(createButton(
        document,
        'account-cache',
        'Hors ligne',
        'title-account-action title-account-action-primary',
        () => { void coordinator.useAccountCache() },
      ))
      if (state.choices.includes('local')) {
        actions.append(createButton(
          document,
          'local-conflict',
          state.conflictKind === 'remote-corrupt' ? 'Réparer cloud' : 'Cette console',
          'title-account-action',
          () => { void coordinator.useLocalConflict() },
        ))
      }
      if (state.choices.includes('remote')) {
        actions.append(createButton(
          document,
          'cloud-conflict',
          'Version cloud',
          'title-account-action',
          () => { void coordinator.useCloudConflict() },
        ))
      }
    }
    if (state.stage === 'local-import') {
      actions.append(
        createButton(
          document,
          'import-local',
          'Importer',
          'title-account-action title-account-action-primary',
          () => { void coordinator.importLocalSaves() },
        ),
        createButton(
          document,
          'keep-local-separate',
          'Garder séparée',
          'title-account-action title-account-action-local',
          () => { void coordinator.keepLocalSavesSeparate() },
        ),
      )
    }
    const canChooseLocal = state.stage === 'restoring'
      || state.stage === 'account-choice'
      || state.stage === 'signed-out'
      || state.stage === 'unavailable'
      || state.stage === 'catalog-error' && state.access.kind === 'account-cache'
      || state.stage === 'catalog-busy'
    if (canChooseLocal && options.allowLocalAccess !== false) {
      actions.append(createButton(
        document,
        'local',
        'Mode local',
        'title-account-action title-account-action-local',
        () => { void coordinator.useLocal() },
      ))
    }
    if (actions.children.length > 0) content.append(actions)
  }

  const render = (state: TitleAccountGateState): void => {
    if (destroyed) return
    const previous = isAccountControl(document.activeElement)
      && root.contains(document.activeElement)
      ? document.activeElement.dataset.titleAccountKey
      : undefined
    root.dataset.titleAccountStage = state.stage
    root.hidden = state.stage === 'closed' || state.stage === 'authorized'
    if (root.hidden) {
      root.replaceChildren()
      focusBoundary.restore()
      return
    }
    focusBoundary.activate()

    const panel = createElement(document, 'article', 'title-account-panel')
    appendVisual(panel, state)
    const content = createElement(document, 'div', 'title-account-content')
    appendHeading(content)
    appendNotice(content, state)
    if (state.stage === 'signed-out') appendAccountForm(content, state)
    else appendStatus(content, state)
    appendActions(content, state)
    panel.append(content)
    root.replaceChildren(panel)

    const fallback = state.stage === 'signed-out'
      ? 'username'
      : state.stage === 'account-choice'
        ? 'continue-account'
      : state.stage === 'unavailable' && state.canRetry
        ? 'retry'
        : state.stage === 'catalog-error'
          ? state.access.kind === 'online' ? 'reconnect' : 'retry-catalog'
          : state.stage === 'catalog-busy'
            ? 'retry-catalog'
          : state.stage === 'local-import'
            ? 'import-local'
          : state.stage === 'catalog-conflict'
            ? 'account-cache'
          : 'local'
    if (controls().length > 0) focusByKey(previous, fallback)
    else {
      root.tabIndex = -1
      root.focus({ preventScroll: true })
    }
  }

  const unsubscribe = coordinator.subscribe(render)

  const activateFocused = (): void => {
    const active = isAccountControl(document.activeElement) && root.contains(document.activeElement)
      ? document.activeElement
      : undefined
    if (!active) {
      focusControl(controls()[0])
      return
    }
    if (active.tagName.toUpperCase() === 'INPUT') {
      const field = active.dataset.titleAccountField
      if (field === 'username' || field === 'password') {
        requestFieldEntry(active as HTMLInputElement, field)
      }
      return
    }
    active.click()
  }

  const moveFocus = (delta: -1 | 1): void => {
    const available = controls()
    if (available.length === 0) return
    const current = available.indexOf(document.activeElement as AccountControl)
    const next = current < 0
      ? delta > 0 ? 0 : available.length - 1
      : (current + delta + available.length) % available.length
    focusControl(available[next])
  }

  const onFocusIn = (): void => { updateCurrentControl() }
  const onKeyDown = (event: KeyboardEvent): void => { focusBoundary.handleTab(event) }
  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('keydown', onKeyDown, true)

  return Object.freeze({
    open() {
      if (destroyed) return Promise.resolve()
      focusBoundary.activate()
      root.hidden = false
      return coordinator.open()
    },
    async openNotice(message) {
      if (destroyed) return
      focusBoundary.activate()
      root.hidden = false
      await coordinator.open()
      coordinator.showNotice(message)
    },
    close() {
      if (destroyed) return
      purgeCredentials()
      coordinator.close()
    },
    isOpen: () => !destroyed && !root.hidden,
    getState: coordinator.getState,
    handleDigitalEvent(event) {
      if (destroyed || root.hidden) return false
      if (!event.pressed) return true
      if (event.action === 'cancel' || event.action === 'menu') {
        purgeCredentials()
        coordinator.close()
        options.onCancel?.()
        return true
      }
      if (event.action === 'up' || event.action === 'left' || event.action === 'page-previous') {
        moveFocus(-1)
        return true
      }
      if (event.action === 'down' || event.action === 'right' || event.action === 'page-next') {
        moveFocus(1)
        return true
      }
      if (event.action === 'confirm') {
        activateFocused()
        return true
      }
      return true
    },
    destroy() {
      if (destroyed) return
      purgeCredentials()
      destroyed = true
      unsubscribe()
      coordinator.destroy()
      root.hidden = true
      focusBoundary.restore()
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('keydown', onKeyDown, true)
      root.remove()
    },
  })
}
