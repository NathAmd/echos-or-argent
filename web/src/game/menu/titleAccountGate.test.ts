import { describe, expect, it, vi } from 'vitest'
import type { GameDigitalAction, GameDigitalEvent } from '../../gameInput'
import type { OnlineAccount, OnlineAccountAuthentication } from '../../online/onlineAccountSession'
import type { GameTextEntryRequest } from '../ui/gameTextEntryOverlay'
import {
  createTitleAccountGateHost,
  type TitleAccountGateHostOptions,
  type TitleAccountGateSession,
} from './titleAccountGate'

class TestDocument {
  activeElement: TestElement | null = null

  createElement(tagName: string): TestElement {
    return new TestElement(this, tagName)
  }
}

type TestListener = (event: TestEvent) => void

class TestEvent {
  defaultPrevented = false
  propagationStopped = false
  readonly target: TestElement
  readonly key: string
  readonly shiftKey: boolean

  constructor(target: TestElement, key = '', shiftKey = false) {
    this.target = target
    this.key = key
    this.shiftKey = shiftKey
  }

  preventDefault(): void {
    this.defaultPrevented = true
  }

  stopPropagation(): void {
    this.propagationStopped = true
  }
}

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly dataset: Record<string, string> = {}
  readonly ownerDocument: TestDocument
  readonly tagName: string
  private readonly listeners = new Map<string, Set<TestListener>>()
  children: TestElement[] = []
  parentElement: TestElement | null = null
  className = ''
  textContent = ''
  id = ''
  hidden = false
  disabled = false
  inert = false
  type = ''
  value = ''
  maxLength = -1
  autocomplete = ''
  autocapitalize = ''
  inputMode = ''
  spellcheck = true
  readOnly = false
  tabIndex = 0

  constructor(ownerDocument: TestDocument, tagName: string) {
    this.ownerDocument = ownerDocument
    this.tagName = tagName.toUpperCase()
  }

  append(...children: TestElement[]): void {
    for (const child of children) {
      child.parentElement?.detach(child)
      child.parentElement = this
      this.children.push(child)
    }
  }

  replaceChildren(...children: TestElement[]): void {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...children)
  }

  private detach(child: TestElement): void {
    this.children = this.children.filter((candidate) => candidate !== child)
    child.parentElement = null
  }

  remove(): void {
    this.parentElement?.detach(this)
  }

  contains(node: TestElement | null): boolean {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true
    }
    return false
  }

  querySelector<T = TestElement>(selector: string): T | null {
    return (this.querySelectorAll<TestElement>(selector)[0] ?? null) as T | null
  }

  querySelectorAll<T = TestElement>(selector: string): T[] {
    const result: TestElement[] = []
    const visit = (element: TestElement): void => {
      for (const child of element.children) {
        if (child.matches(selector)) result.push(child)
        visit(child)
      }
    }
    visit(this)
    return result as T[]
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1))
    }
    const data = /^\[data-([a-z0-9-]+)="([^"]*)"\]$/.exec(selector)
    if (data) {
      const key = data[1]!.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      return this.dataset[key] === data[2]
    }
    return this.tagName === selector.toUpperCase()
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(name: string, listener: TestListener): void {
    const listeners = this.listeners.get(name) ?? new Set<TestListener>()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  }

  removeEventListener(name: string, listener: TestListener): void {
    this.listeners.get(name)?.delete(listener)
  }

  focus(): void {
    this.ownerDocument.activeElement = this
    this.emitBubbling('focusin', new TestEvent(this))
  }

  private emitBubbling(name: string, event: TestEvent): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event)
    this.parentElement?.emitBubbling(name, event)
  }

  private emit(name: string): TestEvent {
    const event = new TestEvent(this)
    for (const listener of this.listeners.get(name) ?? []) listener(event)
    return event
  }

  click(): void {
    this.focus()
    const event = this.emit('click')
    if (this.tagName !== 'BUTTON' || this.type !== 'submit' || event.defaultPrevented) return
    let ancestor = this.parentElement
    while (ancestor && ancestor.tagName !== 'FORM') ancestor = ancestor.parentElement
    ancestor?.emit('submit')
  }

  keydown(target: TestElement, key: string, shiftKey = false): TestEvent {
    const event = new TestEvent(target, key, shiftKey)
    for (const listener of this.listeners.get('keydown') ?? []) listener(event)
    return event
  }
}

const alice: OnlineAccount = Object.freeze({
  id: 'alice',
  username: 'alice',
  role: 'user',
  entitlements: Object.freeze(['online']),
})

function authentication(): OnlineAccountAuthentication {
  return Object.freeze({
    account: alice,
    session: Object.freeze({ accessToken: 'secret-bearer', expiresAt: 2_000_000_000_000 }),
  })
}

function session(overrides: Partial<TitleAccountGateSession> = {}): TitleAccountGateSession {
  return {
    configured: true,
    getAccount: () => undefined,
    hasPersistedSession: () => false,
    restore: async () => undefined,
    login: async () => authentication(),
    register: async () => authentication(),
    logout: async () => undefined,
    ...overrides,
  }
}

function digital(action: GameDigitalAction, pressed = true): GameDigitalEvent {
  return { action, pressed, source: 'gamepad' }
}

function control(host: TestElement, key: string): TestElement {
  const element = host.querySelector<TestElement>(`[data-title-account-key="${key}"]`)
  if (!element) throw new Error(`Contrôle absent: ${key}`)
  return element
}

function fixture(overrides: {
  session?: TitleAccountGateSession
  requestTextEntry?: (request: GameTextEntryRequest) => void
  onCancel?: () => void
  onAuthenticated?: TitleAccountGateHostOptions['onAuthenticated']
  onAuthorizeCatalogAccess?: TitleAccountGateHostOptions['onAuthorizeCatalogAccess']
  allowLocalAccess?: boolean
  closeTextEntry?: () => void
} = {}) {
  const document = new TestDocument()
  const container = document.createElement('main')
  const background = document.createElement('button')
  container.append(background)
  const authorizeCatalog = vi.fn(overrides.onAuthorizeCatalogAccess ?? (() => undefined))
  const host = createTitleAccountGateHost({
    host: container as unknown as HTMLElement,
    session: overrides.session ?? session(),
    requestTextEntry: overrides.requestTextEntry ?? (() => undefined),
    ...(overrides.closeTextEntry ? { closeTextEntry: overrides.closeTextEntry } : {}),
    ...(overrides.allowLocalAccess !== undefined ? { allowLocalAccess: overrides.allowLocalAccess } : {}),
    onAuthorizeCatalogAccess: authorizeCatalog,
    ...(overrides.onCancel ? { onCancel: overrides.onCancel } : {}),
    ...(overrides.onAuthenticated ? { onAuthenticated: overrides.onAuthenticated } : {}),
  })
  const root = container.querySelector<TestElement>('.title-account-gate')
  if (!root) throw new Error('Sas de compte absent')
  return { document, container, background, root, host, authorizeCatalog }
}

async function openAndConfirmAccount(view: ReturnType<typeof fixture>): Promise<void> {
  await view.host.open()
  if (view.host.getState().stage === 'account-choice') {
    view.host.handleDigitalEvent(digital('confirm'))
    await vi.waitFor(() => { expect(view.host.getState().stage).not.toBe('authorizing') })
  }
}

function localImportRequired(proposalId = 3, transferCount = 1): Error {
  return Object.assign(new Error('Sauvegarde locale détectée.'), {
    name: 'TitleSaveLocalAccountImportRequiredError',
    proposalId,
    transferCount,
  })
}

describe('hôte titre du compte avant sauvegarde', () => {
  it('affiche le compte courant puis laisse continuer ou changer à la manette', async () => {
    const logout = vi.fn(async () => undefined)
    const view = fixture({ session: session({ getAccount: () => alice, logout }) })

    await view.host.open()
    expect(view.root.querySelector<TestElement>('.title-account-status')?.textContent).toBe('alice')
    expect(view.document.activeElement).toBe(control(view.root, 'continue-account'))
    expect(control(view.root, 'local').textContent).toBe('Mode local')
    expect(view.authorizeCatalog).not.toHaveBeenCalled()

    view.host.handleDigitalEvent(digital('down'))
    expect(view.document.activeElement).toBe(control(view.root, 'switch-account'))
    view.host.handleDigitalEvent(digital('confirm'))
    await vi.waitFor(() => { expect(view.host.getState().stage).toBe('signed-out') })
    expect(logout).toHaveBeenCalledOnce()
    expect(view.authorizeCatalog).not.toHaveBeenCalled()
  })

  it('purge les champs et ferme le clavier partagé au Retour, puis à la destruction', async () => {
    const requests: GameTextEntryRequest[] = []
    const closeTextEntry = vi.fn()
    const view = fixture({
      requestTextEntry: (request) => { requests.push(request) },
      closeTextEntry,
    })
    await view.host.open()
    view.host.handleDigitalEvent(digital('confirm'))
    requests.at(-1)?.write('alice-secret')
    requests.at(-1)?.submit('alice-secret')
    view.host.handleDigitalEvent(digital('down'))
    view.host.handleDigitalEvent(digital('confirm'))
    requests.at(-1)?.write('mot-de-passe-secret')

    view.host.handleDigitalEvent(digital('cancel'))
    expect(closeTextEntry).toHaveBeenCalledOnce()
    await view.host.open()
    expect(control(view.root, 'username').value).toBe('')
    expect(control(view.root, 'password').value).toBe('')
    view.host.destroy()
    expect(closeTextEntry).toHaveBeenCalledTimes(2)
  })

  it('ouvre une notification bornée sans lire le catalogue et garde le focus manette', async () => {
    const view = fixture()
    await view.host.openNotice(`  ${'A'.repeat(260)}  `)

    expect(view.host.getState().stage).toBe('signed-out')
    expect(view.root.querySelector<TestElement>('.title-account-notice')?.textContent).toHaveLength(240)
    expect(view.document.activeElement).toBe(control(view.root, 'username'))
    expect(view.authorizeCatalog).not.toHaveBeenCalled()
  })

  it('délègue les deux champs au clavier central et valide le compte à la manette', async () => {
    const requests: GameTextEntryRequest[] = []
    const login = vi.fn(async () => authentication())
    const view = fixture({
      session: session({ login }),
      requestTextEntry: (request) => { requests.push(request) },
    })
    await view.host.open()

    const username = control(view.root, 'username')
    const password = control(view.root, 'password')
    expect(view.document.activeElement).toBe(username)
    expect(username).toMatchObject({ readOnly: true, inputMode: 'none' })
    expect(password).toMatchObject({ readOnly: true, inputMode: 'none' })
    expect(username.getAttribute('aria-haspopup')).toBe('dialog')
    expect(password.getAttribute('aria-haspopup')).toBe('dialog')
    expect(view.root.getAttribute('aria-hidden')).toBeNull()
    expect(view.root.querySelector('.game-text-entry-overlay')).toBeNull()

    expect(view.host.handleDigitalEvent(digital('confirm'))).toBe(true)
    expect(requests.at(-1)?.mode).toBe('account')
    requests.at(-1)?.write('alice')
    requests.at(-1)?.submit('alice')

    expect(view.host.handleDigitalEvent(digital('down'))).toBe(true)
    expect(view.document.activeElement).toBe(control(view.root, 'password'))
    view.host.handleDigitalEvent(digital('confirm'))
    expect(requests.at(-1)?.mode).toBe('password')
    requests.at(-1)?.write('mot-de-passe-solide')
    requests.at(-1)?.submit('mot-de-passe-solide')

    view.host.handleDigitalEvent(digital('down'))
    expect(view.document.activeElement).toBe(control(view.root, 'submit'))
    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => { expect(view.authorizeCatalog).toHaveBeenCalledOnce() })
    expect(login).toHaveBeenCalledWith(
      { username: 'alice', password: 'mot-de-passe-solide' },
      expect.any(AbortSignal),
    )
    expect(view.authorizeCatalog.mock.calls[0]?.[0]).toEqual({ kind: 'online', account: alice })
    expect(view.host.getState().stage).toBe('authorized')
    expect(view.host.isOpen()).toBe(false)
  })

  it('n’ouvre le catalogue local qu’après activation explicite du bouton dédié', async () => {
    const view = fixture()
    await openAndConfirmAccount(view)

    expect(view.authorizeCatalog).not.toHaveBeenCalled()
    control(view.root, 'local').focus()
    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => { expect(view.host.getState().stage).toBe('authorized') })
    expect(view.authorizeCatalog).toHaveBeenCalledOnce()
    expect(view.authorizeCatalog.mock.calls[0]?.[0]).toEqual({ kind: 'local' })
    expect(view.host.getState()).toEqual({ stage: 'authorized', access: { kind: 'local' } })
  })

  it('importe une sauvegarde locale depuis le choix minimal recommandé à la manette', async () => {
    const authorize = vi.fn(async (
      _access: unknown,
      _signal: AbortSignal,
      _resolutions: ReadonlyMap<number, unknown>,
      decision?: { choice: string, proposalId: number },
    ) => {
      if (decision?.choice === 'import' && decision.proposalId === 3) return
      throw localImportRequired(3, 1)
    })
    const view = fixture({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorize,
    })

    await openAndConfirmAccount(view)

    expect(view.host.getState().stage).toBe('local-import')
    expect(view.document.activeElement).toBe(control(view.root, 'import-local'))
    expect(control(view.root, 'import-local').textContent).toBe('Importer')
    expect(control(view.root, 'keep-local-separate').textContent).toBe('Garder séparée')
    expect(view.root.querySelector<TestElement>('.title-account-status')?.textContent)
      .toBe('1 sauvegarde locale à importer.')

    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => { expect(view.host.getState().stage).toBe('authorized') })
    expect(authorize.mock.calls[1]?.[3]).toEqual({ choice: 'import', proposalId: 3 })
    expect(view.host.isOpen()).toBe(false)
  })

  it('garde les sauvegardes séparées avec le second bouton sans reboucler', async () => {
    const authorize = vi.fn(async (
      _access: unknown,
      _signal: AbortSignal,
      _resolutions: ReadonlyMap<number, unknown>,
      decision?: { choice: string, proposalId: number },
    ) => {
      if (decision?.choice === 'keep-separate') return
      throw localImportRequired(4, 2)
    })
    const view = fixture({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorize,
    })
    await openAndConfirmAccount(view)

    view.host.handleDigitalEvent(digital('down'))
    expect(view.document.activeElement).toBe(control(view.root, 'keep-local-separate'))
    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => { expect(view.host.getState().stage).toBe('authorized') })
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(authorize.mock.calls[1]?.[3]).toEqual({ choice: 'keep-separate', proposalId: 4 })
  })

  it('synchronise aria-current quand Tab déplace naturellement le focus', async () => {
    const view = fixture()
    await view.host.open()
    const username = control(view.root, 'username')
    const password = control(view.root, 'password')

    expect(username.getAttribute('aria-current')).toBe('true')
    password.focus()

    expect(username.getAttribute('aria-current')).toBe('false')
    expect(password.getAttribute('aria-current')).toBe('true')
  })

  it('confine Tab dans le dialogue puis restaure le fond et son focus', async () => {
    const view = fixture()
    view.background.focus()

    await view.host.open()

    expect(view.background.inert).toBe(true)
    expect(view.background.getAttribute('aria-hidden')).toBe('true')
    expect(view.root.inert).toBe(false)
    expect(view.root.getAttribute('aria-hidden')).toBeNull()

    const first = control(view.root, 'mode-login')
    const last = control(view.root, 'local')
    last.focus()
    const forward = view.root.keydown(last, 'Tab')
    expect(forward.defaultPrevented).toBe(true)
    expect(forward.propagationStopped).toBe(true)
    expect(view.document.activeElement).toBe(first)

    const backward = view.root.keydown(first, 'Tab', true)
    expect(backward.defaultPrevented).toBe(true)
    expect(view.document.activeElement).toBe(last)

    view.host.close()
    expect(view.background.inert).toBe(false)
    expect(view.background.getAttribute('aria-hidden')).toBeNull()
    expect(view.document.activeElement).toBe(view.background)
  })

  it('garde le focus dans le dialogue pendant une autorisation sans contrôle', async () => {
    let finishAuthorization: (() => void) | undefined
    const authorization = new Promise<void>((resolve) => { finishAuthorization = resolve })
    const view = fixture({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: () => authorization,
    })

    await view.host.open()
    const opening = (view.host.handleDigitalEvent(digital('confirm')), Promise.resolve())

    expect(view.host.getState().stage).toBe('authorizing')
    expect(view.document.activeElement).toBe(view.root)
    expect(view.root.tabIndex).toBe(-1)
    finishAuthorization?.()
    await opening
  })

  it('propose immédiatement le local quand aucun service n’est configuré', async () => {
    const view = fixture({ session: session({ configured: false }) })
    await openAndConfirmAccount(view)

    expect(view.host.getState()).toEqual({
      stage: 'unavailable',
      message: 'Service en ligne indisponible.',
      canRetry: false,
    })
    expect(view.document.activeElement).toBe(control(view.root, 'local'))
    expect(view.root.querySelector('[data-title-account-key="retry"]')).toBeNull()
  })

  it('consomme les relâchements et ferme proprement avec Retour', async () => {
    const onCancel = vi.fn()
    const view = fixture({ onCancel })
    await openAndConfirmAccount(view)

    expect(view.host.handleDigitalEvent(digital('down', false))).toBe(true)
    expect(view.host.isOpen()).toBe(true)
    expect(view.host.handleDigitalEvent(digital('cancel'))).toBe(true)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(view.host.getState()).toEqual({ stage: 'closed' })
    expect(view.host.isOpen()).toBe(false)
  })

  it('navigue jusqu’à la création de compte sans chemin clavier parallèle', async () => {
    const register = vi.fn(async () => authentication())
    const requests: GameTextEntryRequest[] = []
    const view = fixture({
      session: session({ register }),
      requestTextEntry: (request) => { requests.push(request) },
    })
    await openAndConfirmAccount(view)

    control(view.root, 'mode-register').focus()
    view.host.handleDigitalEvent(digital('confirm'))
    expect(view.host.getState()).toEqual({ stage: 'signed-out', mode: 'register' })

    control(view.root, 'username').focus()
    view.host.handleDigitalEvent(digital('confirm'))
    requests.at(-1)?.write('alice')
    control(view.root, 'password').focus()
    view.host.handleDigitalEvent(digital('confirm'))
    requests.at(-1)?.write('mot-de-passe-solide')
    control(view.root, 'submit').focus()
    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledOnce()
      expect(view.authorizeCatalog).toHaveBeenCalledOnce()
    })
    expect(view.authorizeCatalog.mock.calls[0]?.[0]).toEqual({ kind: 'online', account: alice })
  })

  it('reconnecte le compte prérempli à la manette après une erreur du coffre en ligne', async () => {
    const requests: GameTextEntryRequest[] = []
    const login = vi.fn(async () => authentication())
    const onAuthenticated = vi.fn()
    const authorize = vi.fn()
      .mockRejectedValueOnce(new Error('Clé du coffre absente.'))
      .mockResolvedValueOnce(undefined)
    const view = fixture({
      session: session({ getAccount: () => alice, login }),
      requestTextEntry: (request) => { requests.push(request) },
      onAuthenticated,
      onAuthorizeCatalogAccess: authorize,
    })

    await openAndConfirmAccount(view)

    expect(view.host.getState().stage).toBe('catalog-error')
    expect(view.document.activeElement).toBe(control(view.root, 'reconnect'))
    expect(control(view.root, 'reconnect').textContent).toBe('Reconnecter')

    view.host.handleDigitalEvent(digital('confirm'))

    expect(view.host.getState()).toEqual({ stage: 'signed-out', mode: 'login' })
    expect(control(view.root, 'username').value).toBe('alice')
    expect(control(view.root, 'password').value).toBe('')
    expect(view.document.activeElement).toBe(control(view.root, 'username'))

    control(view.root, 'password').focus()
    view.host.handleDigitalEvent(digital('confirm'))
    expect(requests.at(-1)?.mode).toBe('password')
    requests.at(-1)?.write('nouveau-mot-de-passe-secret')
    requests.at(-1)?.submit('nouveau-mot-de-passe-secret')
    control(view.root, 'submit').focus()
    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => { expect(view.host.getState().stage).toBe('authorized') })
    expect(login).toHaveBeenCalledWith(
      {
        username: 'alice',
        password: 'nouveau-mot-de-passe-secret',
      },
      expect.any(AbortSignal),
    )
    expect(onAuthenticated).toHaveBeenCalledOnce()
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(login.mock.invocationCallOrder[0]).toBeLessThan(onAuthenticated.mock.invocationCallOrder[0]!)
    expect(onAuthenticated.mock.invocationCallOrder[0]).toBeLessThan(authorize.mock.invocationCallOrder[1]!)
    expect(view.host.isOpen()).toBe(false)
  })

  it('résout un conflit par la version cloud à la manette', async () => {
    const etag = '"cloud-choice"'
    const localVersion = { storageToken: 'local-v1', tombstoneChangedAt: null }
    const authorize = vi.fn(async (
      _access: unknown,
      _signal: AbortSignal,
      resolutions: ReadonlyMap<number, {
        remoteEtag: string
        localVersion: { storageToken: string | null, tombstoneChangedAt: string | null }
      }>,
    ) => {
      if (resolutions.get(2)?.remoteEtag === etag) return
      const conflict = new Error('Emplacement 2 · deux versions.') as Error & {
        slot: number
        remoteEtag: string
        localVersion: typeof localVersion
        choices: readonly ('local' | 'remote')[]
        conflictKind: 'divergent'
      }
      conflict.name = 'TitleSaveCloudConflictError'
      conflict.slot = 2
      conflict.remoteEtag = etag
      conflict.localVersion = localVersion
      conflict.choices = ['local', 'remote']
      conflict.conflictKind = 'divergent'
      throw conflict
    })
    const view = fixture({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorize,
    })

    await openAndConfirmAccount(view)

    expect(view.host.getState().stage).toBe('catalog-conflict')
    expect(view.document.activeElement).toBe(control(view.root, 'account-cache'))
    expect(control(view.root, 'cloud-conflict').textContent).toBe('Version cloud')
    expect(control(view.root, 'account-cache').textContent).toBe('Hors ligne')
    expect(control(view.root, 'local-conflict').textContent).toBe('Cette console')
    control(view.root, 'cloud-conflict').focus()
    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => { expect(view.host.getState().stage).toBe('authorized') })
    expect(authorize.mock.calls[1]?.[2]).toEqual(new Map([[2, { choice: 'remote', remoteEtag: etag, localVersion }]]))
  })

  it('ouvre le cache du compte depuis un conflit sans basculer vers le local global', async () => {
    const conflict = new Error('Conflit.') as Error & {
      slot: number
      remoteEtag: string
      localVersion: { storageToken: string | null, tombstoneChangedAt: string | null }
      choices: readonly ('local' | 'remote')[]
      conflictKind: 'divergent'
    }
    conflict.name = 'TitleSaveCloudConflictError'
    conflict.slot = 1
    conflict.remoteEtag = '"cloud"'
    conflict.localVersion = { storageToken: 'local-v1', tombstoneChangedAt: null }
    conflict.choices = ['local', 'remote']
    conflict.conflictKind = 'divergent'
    const authorize = vi.fn(async (access: { kind: string }) => {
      if (access.kind === 'online') throw conflict
    })
    const view = fixture({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorize,
    })

    await openAndConfirmAccount(view)
    control(view.root, 'account-cache').focus()
    view.host.handleDigitalEvent(digital('confirm'))

    await vi.waitFor(() => { expect(view.host.getState().stage).toBe('authorized') })
    expect(authorize.mock.calls[1]?.[0]).toEqual({ kind: 'account-cache', account: alice })
  })
})
