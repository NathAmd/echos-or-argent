import { describe, expect, it, vi } from 'vitest'
import {
  createMultiplayerUiShell,
  type MultiplayerHubState,
  type MultiplayerUiPorts,
  type MultiplayerUiSnapshot,
} from './multiplayerUiShell'
import type { MultiplayerRomLabels } from './multiplayerRomLabels'

class TestText {
  parentElement: TestElement | null = null
  readonly value: string

  constructor(value: string) {
    this.value = value
  }
}

type TestChild = TestElement | TestText

class TestClassList {
  private readonly element: TestElement

  constructor(element: TestElement) {
    this.element = element
  }

  add(...tokens: string[]): void {
    const names = new Set(this.element.className.split(/\s+/).filter(Boolean))
    tokens.forEach((token) => names.add(token))
    this.element.className = [...names].join(' ')
  }

  remove(...tokens: string[]): void {
    const removed = new Set(tokens)
    this.element.className = this.element.className
      .split(/\s+/)
      .filter((token) => token && !removed.has(token))
      .join(' ')
  }

  contains(token: string): boolean {
    return this.element.className.split(/\s+/).includes(token)
  }
}

class TestDocument {
  activeElement: TestElement | null = null

  createElement(tagName: string): TestElement {
    return new TestElement(this, tagName)
  }

  createTextNode(value: string): TestText {
    return new TestText(value)
  }
}

class TestStyle {
  readonly values = new Map<string, string>()

  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }
}

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly classList = new TestClassList(this)
  readonly dataset: Record<string, string> = {}
  readonly ownerDocument: TestDocument
  readonly style = new TestStyle()
  readonly tagName: string
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  childNodes: TestChild[] = []
  parentElement: TestElement | null = null
  className = ''
  hidden = false
  disabled = false
  type = ''
  value = ''
  placeholder = ''
  maxLength = -1
  autocomplete = ''
  autocapitalize = ''
  inputMode = ''
  spellcheck = true
  readOnly = false
  scrollIntoViewCalls = 0

  constructor(ownerDocument: TestDocument, tagName: string) {
    this.ownerDocument = ownerDocument
    this.tagName = tagName.toLowerCase()
  }

  get children(): TestElement[] {
    return this.childNodes.filter((child): child is TestElement => child instanceof TestElement)
  }

  get textContent(): string {
    return this.childNodes.map((child) => child instanceof TestText ? child.value : child.textContent).join('')
  }

  set textContent(value: string) {
    this.replaceChildren(...(value === '' ? [] : [this.ownerDocument.createTextNode(value)]))
  }

  append(...children: TestChild[]): void {
    this.replaceChildren(...this.childNodes, ...children)
  }

  replaceChildren(...children: TestChild[]): void {
    this.childNodes.forEach((child) => { child.parentElement = null })
    this.childNodes = children
    children.forEach((child) => { child.parentElement = this })
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  focus(): void {
    this.ownerDocument.activeElement = this
  }

  scrollIntoView(): void {
    this.scrollIntoViewCalls += 1
  }

  addEventListener(name: string, callback: EventListener): void {
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(callback)
    this.listeners.set(name, listeners)
  }

  removeEventListener(name: string, callback: EventListener): void {
    this.listeners.get(name)?.delete(callback)
  }

  dispatchClick(target: TestElement): void {
    for (const callback of this.listeners.get('click') ?? []) {
      callback({ target } as unknown as Event)
    }
  }

  dispatchKeyDown(target: TestElement, key: string): boolean {
    let prevented = false
    for (const callback of this.listeners.get('keydown') ?? []) {
      callback({ target, key, preventDefault: () => { prevented = true } } as unknown as Event)
    }
    return prevented
  }

  contains(node: TestElement): boolean {
    for (let cursor: TestElement | null = node; cursor; cursor = cursor.parentElement) {
      if (cursor === this) return true
    }
    return false
  }

  closest(selector: string): TestElement | null {
    if (this.matches(selector)) return this
    for (let cursor = this.parentElement; cursor; cursor = cursor.parentElement) {
      if (cursor.matches(selector)) return cursor
    }
    return null
  }

  querySelector<T = TestElement>(selector: string): T | null {
    return (this.querySelectorAll(selector)[0] ?? null) as T | null
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
    return result as unknown as T[]
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
    if (!selector.startsWith('[')) return this.tagName === selector.toLowerCase()
    const match = /^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/.exec(selector)
    if (!match) return false
    const key = match[1]!.replace(/-([a-z])/g, (_segment, letter: string) => letter.toUpperCase())
    const value = this.dataset[key]
    return value !== undefined && (match[2] === undefined || value === match[2])
  }
}

function createPorts(): MultiplayerUiPorts {
  return {
    login: vi.fn(),
    register: vi.fn(),
    retryConnection: vi.fn(),
    logout: vi.fn(),
    refreshSocial: vi.fn(),
    sendFriendRequest: vi.fn(),
    acceptFriendRequest: vi.fn(),
    declineFriendRequest: vi.fn(),
    cancelFriendRequest: vi.fn(),
    removeFriend: vi.fn(),
    inviteFriend: vi.fn(),
    joinInvitation: vi.fn(),
    declineInvitation: vi.fn(),
    leaveSession: vi.fn(),
    openTrade: vi.fn(),
    chooseTradeOffer: vi.fn(),
    changeTradeOffer: vi.fn(),
    cancelTrade: vi.fn(),
    acceptTrade: vi.fn(),
  }
}

function signedOutSnapshot(): MultiplayerUiSnapshot {
  return {
    connection: { status: 'signed-out' },
    social: { friends: [], incoming: [], outgoing: [] },
    invitations: [],
    session: { status: 'idle' },
    trade: { status: 'closed' },
  }
}

function connectedSnapshot(overrides: Partial<MultiplayerUiSnapshot> = {}): MultiplayerUiSnapshot {
  return {
    connection: {
      status: 'connected',
      userId: 'local-user',
      account: { id: 'local-user', username: 'local-user', role: 'user', entitlements: ['online'] },
    },
    social: { friends: [], incoming: [], outgoing: [] },
    invitations: [],
    session: { status: 'idle' },
    trade: { status: 'closed' },
    ...overrides,
  }
}

function hubState(overrides: Partial<MultiplayerHubState> = {}): MultiplayerHubState {
  return {
    leaderboard: { status: 'unavailable', reason: 'Aucun résultat serveur attesté.' },
    activities: {
      pvp: { random: false, friends: false, reason: 'PvP non raccordé.' },
      coop: { random: false, friends: false, reason: 'Coop non raccordée.' },
      trade: { random: false, friends: false, reason: 'Échange non raccordé.' },
    },
    ...overrides,
  }
}

function fixture(
  portOverrides: Partial<MultiplayerUiPorts> = {},
  present?: Parameters<typeof createMultiplayerUiShell>[0]['present'],
  accountManagement?: boolean,
  labels?: MultiplayerRomLabels,
) {
  const document = new TestDocument()
  const root = document.createElement('main')
  root.hidden = true
  const ports = { ...createPorts(), ...portOverrides }
  const shell = createMultiplayerUiShell({
    root: root as unknown as HTMLElement,
    ports,
    ...(present ? { present } : {}),
    ...(accountManagement === undefined ? {} : { accountManagement }),
    ...(labels ? { labels } : {}),
  })
  const action = (name: string, target?: string, intent?: string): TestElement => {
    const candidates = root.querySelectorAll<TestElement>(`[data-multiplayer-action="${name}"]`)
    const found = candidates.find((candidate) => (
      (target === undefined || candidate.dataset.multiplayerTarget === target)
      && (intent === undefined || candidate.dataset.multiplayerIntent === intent)
    ))
    if (!found) throw new Error(`Action ${name}/${target ?? ''}/${intent ?? ''} absente.`)
    return found
  }
  const input = (name: string): TestElement => {
    const found = root.querySelector<TestElement>(`[data-multiplayer-input="${name}"]`)
    if (!found) throw new Error(`Input ${name} absent.`)
    return found
  }
  const click = (element: TestElement): void => root.dispatchClick(element)
  const keyboardActivate = (element: TestElement, key: 'Enter' | ' '): boolean => {
    if (element.tagName !== 'button' || element.disabled || key !== 'Enter' && key !== ' ') return false
    root.dispatchClick(element)
    return true
  }
  return { root, ports, shell, action, input, click, keyboardActivate }
}

describe('multiplayer DOM shell', () => {
  it('propage les libellés de la ROM anglaise au burger et à ses pages', () => {
    const view = fixture({}, undefined, undefined, {
      multiplayer: 'Multi with a friend',
      play: 'START',
      friends: 'FRIEND',
      requests: 'REGISTER A FRIEND',
      session: 'CONNECT',
      trade: 'TRADE',
      account: 'TRAINER',
      back: 'BACK',
      close: 'CLOSE',
    })
    view.shell.update(connectedSnapshot())

    const playButton = view.root.querySelector<TestElement>('[data-multiplayer-global-target="play"]')!
    expect(playButton.textContent).toBe('START')
    view.click(playButton)
    const playPage = view.root.querySelector<TestElement>('[data-multiplayer-screen="play"]')!
    expect(playPage.querySelector<TestElement>('h2')?.textContent).toBe('START')
    expect(view.action('back-global-menu').getAttribute('aria-label')).toBe('BACK')
  })

  it('ouvre sur un burger global puis revient depuis chaque écran sans scroll', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot())

    const home = view.root.querySelector<TestElement>('[data-multiplayer-screen="home"]')
    const play = view.root.querySelector<TestElement>('[data-multiplayer-screen="play"]')
    const playButton = view.root.querySelector<TestElement>('[data-multiplayer-global-target="play"]')
    expect(view.root.dataset.multiplayerCurrentScreen).toBe('home')
    expect(view.root.classList.contains('game-menu')).toBe(true)
    expect(view.root.classList.contains('ui-menu')).toBe(true)
    expect(view.root.classList.contains('ui-menu-root')).toBe(true)
    expect(home?.classList.contains('ui-menu-navigation-root')).toBe(true)
    expect(playButton?.classList.contains('ui-menu-button')).toBe(true)
    expect(playButton?.style.values.get('--arc-offset')).toBe('20px')
    expect(home?.hidden).toBe(false)
    expect(play?.hidden).toBe(true)

    view.click(playButton!)
    expect(view.root.dataset.multiplayerCurrentScreen).toBe('play')
    expect(view.root.classList.contains('ui-menu-root')).toBe(false)
    expect(home?.hidden).toBe(true)
    expect(play?.hidden).toBe(false)
    view.click(view.action('back-global-menu'))
    expect(view.root.dataset.multiplayerCurrentScreen).toBe('home')
  })

  it('conserve le DOM animé lorsque le snapshot réseau est identique', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot())
    const home = view.root.querySelector<TestElement>('[data-multiplayer-screen="home"]')

    view.shell.update(connectedSnapshot())

    expect(view.root.dataset.multiplayerCurrentScreen).toBe('home')
    expect(view.root.querySelector<TestElement>('[data-multiplayer-screen="home"]')).toBe(home)
  })

  it('pagine les listes longues et garde une page complète navigable à la manette', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      social: {
        friends: ['a', 'b', 'c', 'd'].map((userId) => ({ userId, online: true })),
        incoming: [],
        outgoing: [],
      },
    }))

    const first = view.root.querySelector<TestElement>('[data-multiplayer-collection-page="0"]')
    const second = view.root.querySelector<TestElement>('[data-multiplayer-collection-page="1"]')
    expect(first?.hidden).toBe(false)
    expect(second?.hidden).toBe(true)
    view.click(view.action('navigate-collection', 'friends:next'))
    expect(first?.hidden).toBe(true)
    expect(second?.hidden).toBe(false)
    expect(view.action('navigate-collection', 'friends:next').disabled).toBe(true)
  })

  it('bascule connexion/création de compte sans monter deux formulaires visibles', () => {
    const view = fixture()
    view.shell.update(signedOutSnapshot())
    const login = view.root.querySelector<TestElement>('[data-multiplayer-account-form="login"]')
    const register = view.root.querySelector<TestElement>('[data-multiplayer-account-form="register"]')
    expect(login?.hidden).toBe(false)
    expect(register?.hidden).toBe(true)
    view.click(view.action('select-account-mode', 'register'))
    expect(login?.hidden).toBe(true)
    expect(register?.hidden).toBe(false)
    expect(view.root.ownerDocument.activeElement).toBe(view.input('register-username'))
  })

  it('bloque les fonctions sociales derrière le compte et valide la connexion avec Entrée', () => {
    const view = fixture()
    view.shell.update(signedOutSnapshot())
    const username = view.input('login-username')
    const password = view.input('login-password')
    username.value = ' Alice '
    password.value = 'long-password'

    expect(view.root.querySelector('[data-multiplayer-section="social"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-section="session"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-section="hub"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-input="token"]')).toBeNull()
    expect(view.root.textContent).not.toContain('Appareil A')
    expect(view.root.dispatchKeyDown(password, 'Enter')).toBe(true)
    expect(view.ports.login).toHaveBeenCalledWith({ username: 'Alice', password: 'long-password' })
    expect(username.value).toBe('')
    expect(password.value).toBe('')
  })

  it('ne remonte jamais les formulaires de compte dans la partie', () => {
    const view = fixture({}, undefined, false)
    view.shell.update(signedOutSnapshot())

    expect(view.root.querySelector('[data-multiplayer-input="login-username"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-action="login"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-action="register"]')).toBeNull()
    expect(view.root.textContent).toContain('écran titre')

    view.shell.update(connectedSnapshot())
    expect(view.root.querySelector('[data-multiplayer-action="logout"]')).toBeNull()
  })

  it('crée un compte sans conserver le mot de passe dans le DOM et configure l’autocomplétion', () => {
    const view = fixture()
    view.shell.update(signedOutSnapshot())
    const username = view.input('register-username')
    const password = view.input('register-password')
    username.value = 'new-player'
    password.value = 'new-password'

    expect(view.input('login-username').autocomplete).toBe('username')
    expect(view.input('login-password').autocomplete).toBe('current-password')
    expect(username.autocomplete).toBe('username')
    expect(password.autocomplete).toBe('new-password')
    for (const input of view.root.querySelectorAll<TestElement>('[data-multiplayer-input]')) {
      expect(input.readOnly).toBe(true)
      expect(input.inputMode).toBe('none')
      expect(input.getAttribute('aria-haspopup')).toBe('dialog')
    }
    const reveal = view.action('toggle-password', 'register-password')
    view.click(reveal)
    expect(password.type).toBe('text')
    expect(reveal.textContent).toBe('Masquer')
    view.click(view.action('register'))

    expect(view.ports.register).toHaveBeenCalledWith({ username: 'new-player', password: 'new-password' })
    expect(username.value).toBe('')
    expect(password.value).toBe('')
    expect(view.root.textContent).not.toContain("n'est jamais enregistré")
    expect(view.root.classList.contains('multiplayer-shell')).toBe(true)

    const oldRegisterButton = view.action('register')
    view.shell.destroy()
    view.root.dispatchClick(oldRegisterButton)
    expect(view.ports.register).toHaveBeenCalledOnce()
    expect(view.root.hidden).toBe(true)
    expect(view.root.classList.contains('multiplayer-shell')).toBe(false)
    expect(() => view.shell.update(signedOutSnapshot())).toThrow('détruite')
  })

  it('désactive les deux formulaires pendant une authentification', () => {
    const view = fixture()
    view.shell.update({
      ...signedOutSnapshot(),
      connection: { status: 'authenticating', operation: 'register' },
    })

    expect(view.action('login').disabled).toBe(true)
    expect(view.action('register').disabled).toBe(true)
    expect(view.root.textContent).toContain('Création du compte…')
  })

  it('n’affiche que le nom et l’état utile du compte sans aucun secret puis le déconnecte', () => {
    const secret = 'must-never-reach-the-dom-or-snapshot'
    const view = fixture()
    const snapshot = connectedSnapshot({
      connection: {
        status: 'connected',
        userId: 'admin',
        account: { id: 'admin', username: 'admin', role: 'admin', entitlements: [] },
      },
    })

    view.shell.update(snapshot)

    expect(view.root.textContent).toContain('admin')
    expect(view.root.textContent).toContain('ADMIN')
    expect(view.root.textContent).not.toContain('Accès administrateur')
    expect(view.root.textContent).not.toContain('Aucun droit actif')
    expect(view.root.textContent).not.toContain(secret)
    expect(JSON.stringify(snapshot)).not.toContain(secret)
    view.click(view.action('logout'))
    expect(view.ports.logout).toHaveBeenCalledOnce()
  })

  it('présente le refus de droit ou permet de réessayer une connexion serveur', () => {
    const view = fixture()
    view.shell.update({
      ...signedOutSnapshot(),
      connection: {
        status: 'error',
        message: 'Serveur inaccessible.',
        account: { id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] },
      },
    })

    expect(view.root.textContent).toContain('Serveur inaccessible.')
    view.click(view.action('retry-connection'))
    expect(view.ports.retryConnection).toHaveBeenCalledOnce()
  })

  it('expose la liste et toutes les commandes de demandes d’amis sans logique réseau', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      social: {
        friends: [
          { userId: 'alice', online: true },
          { userId: 'bob', online: false },
        ],
        incoming: ['carol'],
        outgoing: ['dave'],
      },
    }))

    const friendInput = view.input('friend-id')
    friendInput.value = '  Alice.New  '
    view.click(view.action('send-friend-request'))
    view.click(view.action('invite-friend', 'alice'))
    view.click(view.action('invite-friend', 'bob'))
    view.click(view.action('remove-friend', 'bob'))
    view.click(view.action('accept-friend-request', 'carol'))
    view.click(view.action('decline-friend-request', 'carol'))
    view.click(view.action('cancel-friend-request', 'dave'))
    expect(view.root.querySelectorAll('[data-multiplayer-action="refresh-social"]')).toHaveLength(1)
    view.click(view.action('refresh-social'))

    expect(view.ports.sendFriendRequest).toHaveBeenCalledWith('alice.new')
    expect(friendInput.value).toBe('')
    expect(view.ports.inviteFriend).toHaveBeenCalledTimes(1)
    expect(view.ports.inviteFriend).toHaveBeenCalledWith('alice')
    expect(view.ports.removeFriend).toHaveBeenCalledWith('bob')
    expect(view.ports.acceptFriendRequest).toHaveBeenCalledWith('carol')
    expect(view.ports.declineFriendRequest).toHaveBeenCalledWith('carol')
    expect(view.ports.cancelFriendRequest).toHaveBeenCalledWith('dave')
    expect(view.ports.refreshSocial).toHaveBeenCalledOnce()
    expect(view.root.textContent).toContain('Hors ligne')
  })

  it('retire du hub les activités non raccordées au lieu d’afficher de faux choix', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      social: { friends: [{ userId: 'alice', online: true }], incoming: [], outgoing: [] },
    }))

    const hub = view.root.querySelector<TestElement>('[data-multiplayer-section="hub"]')
    const shortcuts = view.root.querySelectorAll<TestElement>('[data-multiplayer-hub-shortcut]')
    const friendActivities = view.root.querySelectorAll<TestElement>('[data-multiplayer-action="request-friend-session"]')

    expect(hub).not.toBeNull()
    expect(shortcuts).toHaveLength(0)
    expect(view.root.querySelector('[data-multiplayer-action="open-leaderboard"]')).toBeNull()
    expect(view.root.textContent).toContain('résultat attesté')
    expect(view.root.textContent).toContain('Aucune activité disponible.')
    expect(friendActivities).toHaveLength(0)
  })

  it('distingue joueur aléatoire et ami, puis transmet une requête typée uniquement quand elle est disponible', () => {
    const requestSession = vi.fn()
    const view = fixture({ requestSession })
    view.shell.update(connectedSnapshot({
      social: {
        friends: [{ userId: 'alice', online: true }, { userId: 'bob', online: false }],
        incoming: [],
        outgoing: [],
      },
      hub: hubState({
        activities: {
          pvp: { random: true, friends: true },
          coop: { random: false, friends: true, reason: 'Matchmaking coop indisponible.' },
          trade: { random: false, friends: true, reason: 'Échange aléatoire indisponible.' },
        },
      }),
    }))

    view.click(view.action('select-session-intent', undefined, 'pvp'))
    const randomPvp = view.action('request-random-session', undefined, 'pvp')
    const choosePvpFriend = view.action('focus-friend-session', undefined, 'pvp')
    expect(randomPvp.disabled).toBe(false)
    expect(choosePvpFriend.disabled).toBe(false)

    view.click(randomPvp)
    expect(requestSession).toHaveBeenLastCalledWith({ intent: 'pvp', target: { kind: 'random' } })

    const alicePvp = view.action('request-friend-session', 'alice', 'pvp')
    view.click(choosePvpFriend)
    expect(view.root.ownerDocument.activeElement).toBe(alicePvp)
    expect(alicePvp.scrollIntoViewCalls).toBe(0)

    const aliceTrade = view.action('request-friend-session', 'alice', 'trade')
    view.click(aliceTrade)
    expect(requestSession).toHaveBeenLastCalledWith({
      intent: 'trade',
      target: { kind: 'friend', userId: 'alice' },
    })
    expect(view.action('request-friend-session', 'bob', 'pvp').disabled).toBe(true)
    expect(view.action('request-random-session', undefined, 'trade').disabled).toBe(true)
    expect(requestSession).toHaveBeenCalledTimes(2)
  })

  it('ouvre le classement seulement avec résultats attestés et port raccordé', () => {
    const openLeaderboard = vi.fn()
    const view = fixture({ openLeaderboard })
    view.shell.update(connectedSnapshot({
      hub: hubState({ leaderboard: { status: 'available' } }),
    }))

    const leaderboard = view.action('open-leaderboard')
    expect(leaderboard.disabled).toBe(false)
    view.click(leaderboard)
    expect(openLeaderboard).toHaveBeenCalledOnce()
  })

  it('affiche la recherche typée et permet de l’annuler au clavier avec leaveSession', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      session: { status: 'searching', intent: 'pvp' },
    }))

    const cancel = view.action('leave-session')
    expect(view.root.textContent).toContain('Recherche · PvP…')
    expect(cancel.textContent).toBe('Annuler la recherche')
    expect(cancel.tagName).toBe('button')
    expect(cancel.type).toBe('button')
    expect(view.keyboardActivate(cancel, 'Enter')).toBe(true)
    expect(view.ports.leaveSession).toHaveBeenCalledOnce()
  })

  it.each([
    ['trade', 'alice propose un échange.'],
    ['pvp', 'alice propose un duel PvP.'],
    ['coop', 'alice propose une session Coop.'],
  ] as const)('nomme explicitement la proposition %s avant tout gameplay', (intent, message) => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      session: { status: 'consent', peerUserId: 'alice', intent },
    }))

    expect(view.root.textContent).toContain(message)
    expect(view.action('decline-session-intent', 'alice', intent).disabled).toBe(true)
    expect(view.action('accept-session-intent', 'alice', intent).disabled).toBe(true)
    expect(view.root.textContent).toContain("n'est pas encore raccordée")
    expect(view.root.querySelector('[data-multiplayer-action="open-trade"]')).toBeNull()
    expect(view.root.textContent).not.toContain('Lancer')
  })

  it('transmet le consentement exact aux ports Refuser et Accepter sans démarrer le gameplay', () => {
    const declineSessionIntent = vi.fn()
    const acceptSessionIntent = vi.fn()
    const view = fixture({ declineSessionIntent, acceptSessionIntent })
    view.shell.update(connectedSnapshot({
      session: { status: 'consent', peerUserId: 'alice', intent: 'coop' },
    }))

    const decline = view.action('decline-session-intent', 'alice', 'coop')
    const accept = view.action('accept-session-intent', 'alice', 'coop')
    expect(decline.textContent).toBe('Refuser')
    expect(accept.textContent).toBe('Accepter')
    expect(decline.getAttribute('aria-label')).toContain('alice')
    expect(accept.getAttribute('aria-label')).toContain('alice')

    view.click(decline)
    expect(view.keyboardActivate(accept, 'Enter')).toBe(true)
    expect(declineSessionIntent).toHaveBeenCalledWith({ peerUserId: 'alice', intent: 'coop' })
    expect(acceptSessionIntent).toHaveBeenCalledWith({ peerUserId: 'alice', intent: 'coop' })
    expect(view.ports.openTrade).not.toHaveBeenCalled()
    expect(view.ports.inviteFriend).not.toHaveBeenCalled()
    expect(view.ports.requestSession).toBeUndefined()
  })

  it('annonce un échange réellement armé et conserve uniquement l’action d’échange existante', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      session: {
        status: 'connected',
        peerUserId: 'alice',
        role: 'host',
        intent: 'trade',
        gameplay: 'trade-armed',
      },
    }))

    expect(view.root.textContent).toContain('échange prêt')
    expect(view.root.textContent).not.toContain('gameplay Échange à raccorder')
    view.click(view.action('open-trade'))
    expect(view.ports.openTrade).toHaveBeenCalledOnce()
  })

  it.each([
    ['campaign-starting', 'connexion Coop…'],
    ['campaign-armed', 'Coop prête'],
  ] as const)('annonce sobrement une campagne %s sans action de gameplay factice', (gameplay, label) => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      session: {
        status: 'connected',
        peerUserId: 'alice',
        role: 'guest',
        intent: 'coop',
        gameplay,
      },
    }))

    expect(view.root.textContent).toContain(label)
    expect(view.root.querySelector('[data-multiplayer-action="open-trade"]')).toBeNull()
    expect(view.root.textContent).not.toContain('Lancer')
    view.click(view.action('leave-session'))
    expect(view.ports.leaveSession).toHaveBeenCalledOnce()
  })

  it.each([
    ['pvp', 'PvP'],
    ['coop', 'Coop'],
  ] as const)('annonce le canal %s sans prétendre lancer son gameplay', (intent, label) => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      session: {
        status: 'connected',
        peerUserId: 'alice',
        role: 'guest',
        intent,
        gameplay: 'not-wired',
      },
    }))

    expect(view.root.textContent).toContain(`${label} indisponible`)
    expect(view.root.querySelector('[data-multiplayer-action="open-trade"]')).toBeNull()
    expect(view.root.textContent).not.toContain('Lancer')
    view.click(view.action('leave-session'))
    expect(view.ports.leaveSession).toHaveBeenCalledOnce()
  })

  it('suit le seul parcours réel : inviter un ami ou accepter une invitation, puis négocier la session P2P', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      social: { friends: [{ userId: 'alice', online: true }], incoming: [], outgoing: [] },
      invitations: [{ invitationId: 'invite-1', fromUserId: 'bob', transport: 'peer' }],
    }))

    view.click(view.action('invite-friend', 'alice'))
    view.click(view.action('join-invitation', 'invite-1'))
    view.click(view.action('decline-invitation', 'invite-1'))

    expect(view.ports.inviteFriend).toHaveBeenCalledWith('alice')
    expect(view.ports.joinInvitation).toHaveBeenCalledWith('invite-1')
    expect(view.ports.declineInvitation).toHaveBeenCalledWith('invite-1')
    expect(view.root.textContent).not.toContain('Héberger')
    expect(view.root.textContent).not.toContain('Code de session')
    expect(view.root.querySelector('[data-multiplayer-action="host-session"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-action="join-session"]')).toBeNull()

    view.shell.update(connectedSnapshot({
      session: { status: 'inviting', peerUserId: 'alice' },
    }))
    expect(view.root.textContent).toContain('Invitation · alice')
    view.click(view.action('leave-session'))

    view.shell.update(connectedSnapshot({
      session: { status: 'negotiating', peerUserId: 'bob', role: 'guest' },
    }))
    expect(view.root.textContent).toContain('Connexion · bob')
    view.click(view.action('leave-session'))

    view.shell.update(connectedSnapshot({
      session: { status: 'connected', peerUserId: 'alice', role: 'host' },
    }))
    expect(view.root.textContent).toContain('alice')
    view.click(view.action('open-trade'))
    view.click(view.action('leave-session'))
    expect(view.ports.openTrade).toHaveBeenCalledOnce()
    expect(view.ports.leaveSession).toHaveBeenCalledTimes(3)
  })

  it('affiche les deux previews locales mais ne les transmet jamais aux commandes d’échange', () => {
    const view = fixture()
    const visual = new TestDocument().createElement('figure')
    view.shell.update(connectedSnapshot({
      session: { status: 'connected', peerUserId: 'alice', role: 'guest' },
      trade: {
        status: 'negotiating',
        localOffer: {
          primaryLabel: 'LOCAL_ROM_LABEL_CANARY',
          secondaryLabel: 'Niveau local 12',
          details: [{ label: 'Stat locale', value: '31' }],
          createVisual: () => visual as unknown as HTMLElement,
        },
        remoteOffer: {
          primaryLabel: 'REMOTE_ROM_LABEL_CANARY',
          secondaryLabel: 'Niveau local 18',
        },
        localAccepted: false,
        remoteAccepted: true,
      },
    }))

    expect(view.root.textContent).toContain('LOCAL_ROM_LABEL_CANARY')
    expect(view.root.textContent).toContain('REMOTE_ROM_LABEL_CANARY')
    expect(visual.classList.contains('multiplayer-shell-offer-visual')).toBe(true)
    expect(view.root.textContent).toContain('À VOUS DE CONFIRMER')
    view.click(view.action('change-trade-offer'))
    view.click(view.action('accept-trade'))
    view.click(view.action('cancel-trade'))

    expect(view.ports.changeTradeOffer).toHaveBeenCalledWith()
    expect(view.ports.acceptTrade).toHaveBeenCalledWith()
    expect(view.ports.cancelTrade).toHaveBeenCalledWith()
    expect(view.ports.acceptTrade).not.toHaveBeenCalledWith(expect.objectContaining({
      primaryLabel: 'LOCAL_ROM_LABEL_CANARY',
    }))

    view.shell.update(connectedSnapshot({
      session: { status: 'connected', peerUserId: 'alice', role: 'guest' },
      trade: { status: 'closed' },
    }))
    expect(view.root.textContent).not.toContain('LOCAL_ROM_LABEL_CANARY')
    expect(view.root.textContent).not.toContain('REMOTE_ROM_LABEL_CANARY')
  })

  it('bloque un commit prématuré et rend explicitement l’acceptation des deux côtés, le commit et l’erreur', () => {
    const view = fixture()
    const session = { status: 'connected', peerUserId: 'alice', role: 'host' } as const
    view.shell.update(connectedSnapshot({
      session,
      trade: {
        status: 'negotiating',
        localAccepted: false,
        remoteAccepted: false,
      },
    }))
    view.click(view.action('accept-trade'))
    expect(view.ports.acceptTrade).not.toHaveBeenCalled()
    view.click(view.action('choose-trade-offer'))
    expect(view.ports.chooseTradeOffer).toHaveBeenCalledOnce()

    const offers = {
      localOffer: { primaryLabel: 'Offre locale' },
      remoteOffer: { primaryLabel: 'Offre distante' },
    }
    view.shell.update(connectedSnapshot({
      session,
      trade: {
        status: 'negotiating',
        ...offers,
        localAccepted: true,
        remoteAccepted: false,
      },
    }))
    expect(view.root.textContent).toContain('ATTENTE DU PARTENAIRE')
    view.click(view.action('accept-trade'))
    expect(view.ports.acceptTrade).not.toHaveBeenCalled()

    view.shell.update(connectedSnapshot({
      session,
      trade: {
        status: 'committing',
        ...offers,
        localAccepted: true,
        remoteAccepted: true,
      },
    }))
    const acceptedOffers = view.root.querySelectorAll<TestElement>('[data-accepted="true"]')
      .filter((element) => element.dataset.offerOwner !== undefined)
    expect(acceptedOffers).toHaveLength(2)
    expect(view.root.textContent).toContain('ÉCHANGE EN COURS')
    expect(view.root.querySelector('[data-multiplayer-action="change-trade-offer"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-action="cancel-trade"]')).toBeNull()

    view.shell.update(connectedSnapshot({
      session,
      trade: {
        status: 'committed',
        ...offers,
        localAccepted: true,
        remoteAccepted: true,
      },
    }))
    expect(view.root.textContent).toContain('ÉCHANGE RÉUSSI')
    expect(view.root.querySelectorAll('[data-multiplayer-action="open-trade"]')).toHaveLength(2)

    view.shell.update(connectedSnapshot({
      session,
      trade: {
        status: 'error',
        ...offers,
        localAccepted: false,
        remoteAccepted: false,
        errorMessage: 'Commit P2P refusé sans mutation locale.',
      },
    }))
    expect(view.root.textContent).toContain('Commit P2P refusé sans mutation locale.')
  })

  it('permet d’ouvrir immédiatement un second échange après un commit réussi', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      session: { status: 'connected', peerUserId: 'alice', role: 'host' },
      trade: {
        status: 'committed',
        localOffer: { primaryLabel: 'Ancienne offre locale' },
        remoteOffer: { primaryLabel: 'Ancienne offre distante' },
        localAccepted: true,
        remoteAccepted: true,
      },
    }))

    const nextTrade = view.action('open-trade')
    expect(nextTrade.textContent).toBe('Nouvel échange')
    expect(nextTrade.disabled).toBe(false)
    view.click(nextTrade)

    expect(view.ports.openTrade).toHaveBeenCalledOnce()
    expect(view.ports.openTrade).toHaveBeenCalledWith()
  })

  it('interdit toute sortie ou mutation tant que la transaction durable est verrouillée', () => {
    const view = fixture()
    view.shell.update(connectedSnapshot({
      session: { status: 'connected', peerUserId: 'alice', role: 'host' },
      trade: {
        status: 'committing',
        locked: true,
        localOffer: { primaryLabel: 'Offre locale' },
        remoteOffer: { primaryLabel: 'Offre distante' },
        localAccepted: true,
        remoteAccepted: true,
      },
    }))

    for (const action of ['logout', 'leave-session'] as const) {
      const button = view.action(action)
      expect(button.disabled).toBe(true)
      view.click(button)
    }
    expect(view.root.querySelector('[data-multiplayer-action="change-trade-offer"]')).toBeNull()
    expect(view.root.querySelector('[data-multiplayer-action="cancel-trade"]')).toBeNull()

    expect(view.ports.logout).not.toHaveBeenCalled()
    expect(view.ports.leaveSession).not.toHaveBeenCalled()
    expect(view.ports.changeTradeOffer).not.toHaveBeenCalled()
    expect(view.ports.cancelTrade).not.toHaveBeenCalled()
  })

  it('déclenche la présentation HGSS uniquement lors des vraies transitions d’état', () => {
    const present = vi.fn()
    const view = fixture({}, present)
    view.shell.update(signedOutSnapshot())
    view.shell.update(connectedSnapshot())
    view.shell.update(connectedSnapshot({
      social: { friends: [], incoming: ['alice'], outgoing: [] },
    }))
    view.shell.update(connectedSnapshot({
      session: { status: 'consent', peerUserId: 'alice', intent: 'trade' },
    }))
    const session = { status: 'connected', peerUserId: 'alice', role: 'host' } as const
    view.shell.update(connectedSnapshot({ session }))
    const offers = {
      localOffer: { primaryLabel: 'Germignon' },
      remoteOffer: { primaryLabel: 'Héricendre' },
    }
    view.shell.update(connectedSnapshot({
      session,
      trade: { status: 'negotiating', ...offers, localAccepted: false, remoteAccepted: false },
    }))
    view.shell.update(connectedSnapshot({
      session,
      trade: { status: 'negotiating', ...offers, localAccepted: false, remoteAccepted: true },
    }))
    view.shell.update(connectedSnapshot({
      session,
      trade: { status: 'committing', ...offers, localAccepted: true, remoteAccepted: true },
    }))
    view.shell.update(connectedSnapshot({
      session,
      trade: { status: 'committed', ...offers, localAccepted: true, remoteAccepted: true },
    }))

    expect(present.mock.calls.map(([event]) => event.kind)).toEqual([
      'connected',
      'request-received',
      'session-consent',
      'session-ready',
      'trade-accepted',
      'trade-committing',
      'trade-committed',
    ])
    expect(view.root.dataset.multiplayerConnectionState).toBe('connected')
    expect(view.root.dataset.multiplayerSessionState).toBe('connected')
    expect(view.root.dataset.multiplayerTradeState).toBe('committed')
  })
})
