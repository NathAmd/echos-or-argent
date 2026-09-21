import { describe, expect, it, vi } from 'vitest'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { MultiplayerUiSnapshot } from '../ui/multiplayerUiShell'
import {
  normalizeGameTextEntryValue,
  type GameTextEntryOverlay,
  type GameTextEntryRequest,
} from '../ui/gameTextEntryOverlay'
import type { BrowserMultiplayerRuntimeOptions } from './browserMultiplayerRuntime'
import {
  createHgssBrowserMultiplayerHost,
  hgssMultiplayerUiSoundEffects,
} from './hgssBrowserMultiplayerHost'

class TestClassList {
  private readonly element: TestElement

  constructor(element: TestElement) {
    this.element = element
  }

  add(...tokens: string[]): void {
    const classes = new Set(this.element.className.split(/\s+/).filter(Boolean))
    tokens.forEach((token) => classes.add(token))
    this.element.className = [...classes].join(' ')
  }

  remove(...tokens: string[]): void {
    const removed = new Set(tokens)
    this.element.className = this.element.className.split(/\s+/).filter((token) => token && !removed.has(token)).join(' ')
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
}

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly classList = new TestClassList(this)
  readonly dataset: Record<string, string> = {}
  readonly ownerDocument: TestDocument
  readonly tagName: string
  private readonly listeners = new Map<string, Set<EventListener>>()
  children: TestElement[] = []
  parentElement: TestElement | null = null
  className = ''
  hidden = false
  tabIndex = 0
  type = ''
  id = ''
  textContent = ''
  placeholder = ''
  value = ''
  maxLength = 0
  disabled = false
  inert = false
  readOnly = false
  inputMode = ''

  constructor(ownerDocument: TestDocument, tagName: string) {
    this.ownerDocument = ownerDocument
    this.tagName = tagName.toLowerCase()
  }

  append(...children: TestElement[]): void {
    children.forEach((child) => {
      child.parentElement?.detach(child)
      child.parentElement = this
      this.children.push(child)
    })
  }

  replaceChildren(...children: TestElement[]): void {
    this.children.forEach((child) => { child.parentElement = null })
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

  contains(node: TestElement): boolean {
    for (let current: TestElement | null = node; current; current = current.parentElement) {
      if (current === this) return true
    }
    return false
  }

  querySelector<T = TestElement>(selector: string): T | null {
    const found = this.querySelectorAll<TestElement>(selector)[0]
    return (found ?? null) as T | null
  }

  querySelectorAll<T = TestElement>(selector: string): T[] {
    const result: TestElement[] = []
    const visit = (element: TestElement): void => {
      element.children.forEach((child) => {
        if (child.matches(selector)) result.push(child)
        visit(child)
      })
    }
    visit(this)
    return result as T[]
  }

  private matches(selector: string): boolean {
    if (selector.includes(',')) return selector.split(',').some((candidate) => this.matches(candidate.trim()))
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
    const dataPresence = /^\[data-([a-z0-9-]+)\]$/.exec(selector)
    if (dataPresence) {
      const key = dataPresence[1]!.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      return this.dataset[key] !== undefined
    }
    const data = /^\[data-([a-z0-9-]+)="([^"]*)"\]$/.exec(selector)
    if (!data) return this.tagName === selector.toLowerCase()
    const key = data[1]!.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
    return this.dataset[key] === data[2]
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

  addEventListener(name: string, listener: EventListener): void {
    const listeners = this.listeners.get(name) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  }

  removeEventListener(name: string, listener: EventListener): void {
    this.listeners.get(name)?.delete(listener)
  }

  focus(): void {
    this.ownerDocument.activeElement = this
  }

  closest(selector: string): TestElement | null {
    if (this.matches(selector)) return this
    return this.parentElement?.closest(selector) ?? null
  }

  emit(name: string, event: Event): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }

  dispatchEvent(): boolean {
    return true
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) {
      listener({ target: this } as unknown as Event)
    }
  }
}

const signedOut: MultiplayerUiSnapshot = Object.freeze({
  connection: Object.freeze({ status: 'signed-out' }),
  social: Object.freeze({ friends: Object.freeze([]), incoming: Object.freeze([]), outgoing: Object.freeze([]) }),
  invitations: Object.freeze([]),
  session: Object.freeze({ status: 'idle' }),
  trade: Object.freeze({ status: 'closed' }),
})

const aliceAccount = Object.freeze({
  id: 'alice',
  username: 'alice',
  role: 'user' as const,
  entitlements: Object.freeze(['online']),
})

function fixture(
  snapshot: MultiplayerUiSnapshot,
  uiMessageBanks?: Readonly<Record<number, Readonly<Record<number, string>>>>,
) {
  const document = new TestDocument()
  const panel = document.createElement('main')
  const background = document.createElement('button')
  panel.append(background)
  const runtimeDestroy = vi.fn(async () => undefined)
  const runtimePrepareForPageRelease = vi.fn(async () => undefined)
  const playSoundEffect = vi.fn()
  let textEntryRequest: GameTextEntryRequest | undefined
  const textEntry: GameTextEntryOverlay = {
    open: vi.fn((request) => { textEntryRequest = request }),
    close: vi.fn(() => { const request = textEntryRequest; textEntryRequest = undefined; request?.cancel() }),
    submitCurrent: vi.fn(() => false),
    refresh: vi.fn(),
    isOpen: () => textEntryRequest !== undefined,
    handle: vi.fn((event) => {
      if (!textEntryRequest) return false
      if (event.pressed && (event.action === 'cancel' || event.action === 'menu')) {
        const request = textEntryRequest
        textEntryRequest = undefined
        request.cancel()
      }
      return true
    }),
    handleKeyboard: vi.fn(() => false),
    destroy: vi.fn(),
  }
  const runtimeFactory = vi.fn((options: BrowserMultiplayerRuntimeOptions) => {
    const root = options.root as unknown as TestElement
    if (snapshot.connection.status === 'connected') {
      const quickPvp = document.createElement('button')
      quickPvp.dataset.multiplayerHubShortcut = 'pvp'
      quickPvp.dataset.multiplayerGlobalTarget = 'play'
      root.dataset.multiplayerCurrentScreen = 'home'
      const friendInput = document.createElement('input')
      friendInput.dataset.multiplayerInput = 'friend-id'
      const friends = document.createElement('section')
      friends.dataset.multiplayerSection = 'social'
      root.append(quickPvp, friendInput, friends)
    } else {
      const username = document.createElement('input')
      username.dataset.multiplayerInput = 'login-username'
      username.placeholder = 'Identifiant'
      username.maxLength = 32
      const password = document.createElement('input')
      password.dataset.multiplayerInput = 'login-password'
      password.type = 'password'
      password.placeholder = 'Mot de passe'
      password.maxLength = 128
      root.append(username, password)
    }
    return {
      getSnapshot: () => snapshot,
      getIntentSessionState: () => ({ status: 'idle' } as const),
      subscribeIntentSession: () => () => undefined,
      requestFriendSession: vi.fn(),
      acceptSessionInvitation: vi.fn(),
      getOnlineController: () => undefined as never,
      prepareForPageRelease: runtimePrepareForPageRelease,
      destroy: runtimeDestroy,
    }
  })
  const state = { pokemonRuntime: {}, party: { members: [] } } as unknown as FieldScriptState
  const host = createHgssBrowserMultiplayerHost({
    panel: panel as unknown as HTMLElement,
    showLauncher: false,
    readContext: () => ({
      state,
      pokemonCatalog: { speciesNames: [] } as never,
      ...(uiMessageBanks ? { uiMessageBanks } : {}),
      teamPolicy: {
        vetoBattleEligibility: () => undefined,
        vetoPartyMutation: () => undefined,
      },
    }),
    persistState: vi.fn(),
    publishState: vi.fn(),
    playSoundEffect,
    textEntry,
    runtimeFactory,
  })
  return { document, panel, background, host, runtimeFactory, runtimeDestroy, runtimePrepareForPageRelease, playSoundEffect, textEntry, readTextEntryRequest: () => textEntryRequest }
}

describe('coque navigateur multijoueur dans le menu burger', () => {
  it('résout une seule fois les libellés de navigation depuis la ROM chargée', async () => {
    const view = fixture(signedOut, {
      19: { 45: 'Multi with a friend' },
      45: { 8: 'CLOSE' },
      191: { 23: 'TRADE', 156: 'REGISTER A FRIEND?', 282: 'FRIEND', 336: 'A: START' },
      196: { 21: 'BACK' },
      282: { 5: 'TRAINER' },
      442: { 3: 'CONNECT WITH A RANGER' },
    })

    view.host.open()

    expect(view.panel.querySelector<TestElement>('.multiplayer-overlay-close')?.textContent).toBe('CLOSE')
    expect(view.runtimeFactory.mock.calls[0]?.[0].uiLabels).toMatchObject({
      play: 'START',
      friends: 'FRIEND',
      session: 'CONNECT',
      account: 'TRAINER',
      back: 'BACK',
      close: 'CLOSE',
    })
    await view.host.destroy()
  })

  it('ne crée aucun runtime réseau et ne modifie pas le solo tant qu’elle n’est jamais ouverte', async () => {
    const view = fixture(signedOut)

    expect(view.runtimeFactory).not.toHaveBeenCalled()
    expect(view.panel.querySelector('.multiplayer-launcher')).toBeNull()
    expect(view.panel.querySelector<TestElement>('.multiplayer-overlay')?.hidden).toBe(true)

    await view.host.destroy()
    expect(view.runtimeDestroy).not.toHaveBeenCalled()
  })

  it('ouvre le dialogue déconnecté sur le champ identifiant et se ferme sans connexion implicite', async () => {
    const view = fixture(signedOut)

    view.host.open()

    const username = view.panel.querySelector<TestElement>('[data-multiplayer-input="login-username"]')
    expect(view.host.isOpen()).toBe(true)
    expect(view.runtimeFactory).toHaveBeenCalledOnce()
    expect(view.document.activeElement).toBe(username)
    expect(username?.readOnly).toBe(true)
    expect(username?.inputMode).toBe('none')
    expect(username?.getAttribute('aria-haspopup')).toBe('dialog')

    view.host.close()
    expect(view.host.isOpen()).toBe(false)
    expect(view.runtimeDestroy).not.toHaveBeenCalled()

    await view.host.destroy()
    expect(view.runtimeDestroy).toHaveBeenCalledOnce()
  })

  it('draine le runtime de page sans détruire la coque multijoueur', async () => {
    const view = fixture(signedOut)
    view.host.open()

    const first = view.host.prepareForPageRelease()
    const second = view.host.prepareForPageRelease()
    await Promise.all([first, second])

    expect(view.host.isOpen()).toBe(false)
    expect(view.runtimePrepareForPageRelease).toHaveBeenCalledOnce()
    expect(view.runtimeDestroy).not.toHaveBeenCalled()
    expect(view.panel.querySelector('.multiplayer-overlay')).not.toBeNull()

    await view.host.destroy()
  })

  it('donne directement accès aux actions rapides lorsqu’une identité est déjà connectée', async () => {
    const connected: MultiplayerUiSnapshot = Object.freeze({
      ...signedOut,
      connection: Object.freeze({ status: 'connected', userId: 'alice', account: aliceAccount }),
      social: Object.freeze({
        friends: Object.freeze([{ userId: 'bob', online: true }]),
        incoming: Object.freeze([]),
        outgoing: Object.freeze([]),
      }),
    })
    const view = fixture(connected)

    view.host.open()

    const quickPvp = view.panel.querySelector<TestElement>('[data-multiplayer-hub-shortcut="pvp"]')
    expect(view.document.activeElement).toBe(quickPvp)
    expect(view.panel.querySelector('[data-multiplayer-section="social"]')).not.toBeNull()
    expect(view.panel.querySelector('[data-multiplayer-input="login-username"]')).toBeNull()

    await view.host.destroy()
  })

  it('garde la navigation manette dans le dialogue et permet B ou Menu pour le fermer', async () => {
    const connected: MultiplayerUiSnapshot = Object.freeze({
      ...signedOut,
      connection: Object.freeze({ status: 'connected', userId: 'alice', account: aliceAccount }),
    })
    const view = fixture(connected)
    view.host.open()
    const quickPvp = view.panel.querySelector<TestElement>('[data-multiplayer-hub-shortcut="pvp"]')
    const friendInput = view.panel.querySelector<TestElement>('[data-multiplayer-input="friend-id"]')
    expect(view.document.activeElement).toBe(quickPvp)

    expect(view.host.handleDigitalEvent({ action: 'down', pressed: true, source: 'gamepad' })).toBe(true)
    expect(view.document.activeElement).toBe(friendInput)
    expect(view.host.handleDigitalEvent({ action: 'cancel', pressed: true, source: 'gamepad' })).toBe(true)
    expect(view.host.isOpen()).toBe(false)

    view.host.open()
    expect(view.host.handleDigitalEvent({ action: 'menu', pressed: true, source: 'gamepad' })).toBe(true)
    expect(view.host.isOpen()).toBe(false)
    expect(view.host.handleDigitalEvent({ action: 'menu', pressed: true, source: 'gamepad' })).toBe(false)

    await view.host.destroy()
  })

  it('confine Tab dans le dialogue puis restaure le fond et son focus', async () => {
    const connected: MultiplayerUiSnapshot = Object.freeze({
      ...signedOut,
      connection: Object.freeze({ status: 'connected', userId: 'alice', account: aliceAccount }),
    })
    const view = fixture(connected)
    view.background.focus()
    view.host.open()

    const overlay = view.panel.querySelector<TestElement>('.multiplayer-overlay')!
    const close = view.panel.querySelector<TestElement>('.multiplayer-overlay-close')!
    const friendInput = view.panel.querySelector<TestElement>('[data-multiplayer-input="friend-id"]')!
    expect(view.background.inert).toBe(true)
    expect(view.background.getAttribute('aria-hidden')).toBe('true')
    expect(overlay.inert).toBe(false)
    expect(overlay.getAttribute('aria-hidden')).toBeNull()

    friendInput.focus()
    const preventForward = vi.fn()
    const stopForward = vi.fn()
    overlay.emit('keydown', {
      key: 'Tab',
      shiftKey: false,
      preventDefault: preventForward,
      stopPropagation: stopForward,
    } as unknown as KeyboardEvent)
    expect(preventForward).toHaveBeenCalledOnce()
    expect(stopForward).toHaveBeenCalledOnce()
    expect(view.document.activeElement).toBe(close)

    overlay.emit('keydown', {
      key: 'Tab',
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent)
    expect(view.document.activeElement).toBe(friendInput)

    view.host.close()
    expect(view.background.inert).toBe(false)
    expect(view.background.getAttribute('aria-hidden')).toBeNull()
    expect(view.document.activeElement).toBe(view.background)
    await view.host.destroy()
  })

  it('délègue un champ au clavier central avec A et le referme avec B', async () => {
    const connected: MultiplayerUiSnapshot = Object.freeze({
      ...signedOut,
      connection: Object.freeze({ status: 'connected', userId: 'alice', account: aliceAccount }),
    })
    const view = fixture(connected)
    view.host.open()
    const friendInput = view.panel.querySelector<TestElement>('[data-multiplayer-input="friend-id"]')
    view.host.handleDigitalEvent({ action: 'down', pressed: true, source: 'gamepad' })
    expect(view.document.activeElement).toBe(friendInput)
    expect(friendInput?.readOnly).toBe(true)

    expect(view.host.handleDigitalEvent({ action: 'confirm', pressed: true, source: 'gamepad' })).toBe(true)
    expect(view.textEntry.open).toHaveBeenCalledOnce()
    expect(view.readTextEntryRequest()).toMatchObject({ mode: 'account', title: 'Saisie' })
    expect(view.panel.querySelector('.multiplayer-text-keyboard')).toBeNull()

    view.host.handleDigitalEvent({ action: 'cancel', pressed: true, source: 'gamepad' })
    expect(view.readTextEntryRequest()).toBeUndefined()
    expect(view.host.isOpen()).toBe(true)
    await view.host.destroy()
  })

  it('route flèche puis Entrée du clavier entre les champs readonly', async () => {
    const view = fixture(signedOut)
    view.host.open()
    const overlay = view.panel.querySelector<TestElement>('.multiplayer-overlay')!
    const username = view.panel.querySelector<TestElement>('[data-multiplayer-input="login-username"]')!
    const password = view.panel.querySelector<TestElement>('[data-multiplayer-input="login-password"]')!
    const preventDirection = vi.fn()

    overlay.emit('keydown', {
      target: username,
      key: 'ArrowDown',
      repeat: false,
      preventDefault: preventDirection,
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent)
    expect(preventDirection).toHaveBeenCalledOnce()
    expect(view.document.activeElement).toBe(password)

    const preventConfirm = vi.fn()
    const stopConfirm = vi.fn()
    overlay.emit('keydown', {
      target: password,
      key: 'Enter',
      repeat: false,
      preventDefault: preventConfirm,
      stopPropagation: stopConfirm,
    } as unknown as KeyboardEvent)

    expect(preventConfirm).toHaveBeenCalledOnce()
    expect(stopConfirm).toHaveBeenCalledOnce()
    expect(view.textEntry.open).toHaveBeenCalledOnce()
    expect(view.readTextEntryRequest()?.mode).toBe('password')
    await view.host.destroy()
  })

  it('délègue aussi les clics et pointeurs souris au clavier central partagé', async () => {
    const view = fixture(signedOut)
    view.host.open()
    const shell = view.panel.querySelector<TestElement>('.multiplayer-overlay-content')!
    const username = view.panel.querySelector<TestElement>('[data-multiplayer-input="login-username"]')!
    const pointerPreventDefault = vi.fn()

    shell.emit('pointerdown', {
      target: username,
      pointerType: 'mouse',
      preventDefault: pointerPreventDefault,
    } as unknown as PointerEvent)
    expect(pointerPreventDefault).toHaveBeenCalledOnce()
    expect(view.textEntry.open).toHaveBeenCalledOnce()
    expect(view.readTextEntryRequest()?.mode).toBe('account')
    view.readTextEntryRequest()?.write('alice')
    expect(username.value).toBe('alice')

    view.host.handleDigitalEvent({ action: 'cancel', pressed: true, source: 'gamepad' })
    const clickPreventDefault = vi.fn()
    shell.emit('click', {
      target: username,
      preventDefault: clickPreventDefault,
    } as unknown as MouseEvent)
    expect(clickPreventDefault).toHaveBeenCalledOnce()
    expect(view.textEntry.open).toHaveBeenCalledTimes(2)

    await view.host.destroy()
  })

  it('garde le clavier mot de passe après Afficher sans filtrer comme un identifiant', async () => {
    const view = fixture(signedOut)
    view.host.open()
    const shell = view.panel.querySelector<TestElement>('.multiplayer-overlay-content')!
    const password = view.panel.querySelector<TestElement>('[data-multiplayer-input="login-password"]')!

    // Simule le bouton Afficher de la coque, qui change seulement la présentation.
    password.type = 'text'
    shell.emit('pointerdown', {
      target: password,
      pointerType: 'touch',
      preventDefault: vi.fn(),
    } as unknown as PointerEvent)

    const request = view.readTextEntryRequest()
    expect(password.readOnly).toBe(true)
    expect(password.inputMode).toBe('none')
    expect(request).toMatchObject({ mode: 'password', maxLength: 128 })
    expect(normalizeGameTextEntryValue(request!.mode, 'clé !#')).toBe('clé !#')
    await view.host.destroy()
  })

  it('réutilise les sons ROM pour le curseur, les pages et la séquence d’échange', async () => {
    const connected: MultiplayerUiSnapshot = Object.freeze({
      ...signedOut,
      connection: Object.freeze({ status: 'connected', userId: 'alice', account: aliceAccount }),
    })
    const view = fixture(connected)
    view.host.open()
    view.host.handleDigitalEvent({ action: 'down', pressed: true, source: 'gamepad' })
    const runtimeOptions = view.runtimeFactory.mock.calls[0]?.[0]
    runtimeOptions?.uiPresentation?.({ kind: 'trade-committing' })
    runtimeOptions?.uiPresentation?.({ kind: 'trade-committed' })

    expect(view.playSoundEffect).toHaveBeenCalledWith(hgssMultiplayerUiSoundEffects.page)
    expect(view.playSoundEffect).toHaveBeenCalledWith(hgssMultiplayerUiSoundEffects.cursor)
    expect(view.playSoundEffect).toHaveBeenCalledWith(hgssMultiplayerUiSoundEffects.exchange)
    expect(view.playSoundEffect).toHaveBeenCalledWith(hgssMultiplayerUiSoundEffects.select)
    await view.host.destroy()
  })
})
