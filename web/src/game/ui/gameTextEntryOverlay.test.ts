import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  applyGameTextEntryKey,
  createGameTextEntryKeys,
  createGameTextEntryOverlay,
  finalizeGameTextEntryValue,
  moveGameTextEntryCursor,
  normalizeGameTextEntryValue,
  type GameTextEntryRequest,
} from './gameTextEntryOverlay'

const gameTextEntryCss = readFileSync(new URL('../../styles/game-text-entry.css', import.meta.url), 'utf8')

class TestDocument {
  activeElement: TestElement | null = null
  defaultView = null

  createElement(tagName: string): TestElement {
    return new TestElement(this, tagName)
  }
}

class TestElement {
  readonly ownerDocument: TestDocument
  readonly tagName: string
  parentElement: TestElement | null = null
  children: TestElement[] = []
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  className = ''
  id = ''
  textContent = ''
  value = ''
  type = ''
  name = ''
  placeholder = ''
  inputMode = ''
  enterKeyHint = ''
  autocomplete = ''
  autocapitalize = ''
  htmlFor = ''
  maxLength = 0
  tabIndex = 0
  clientWidth = 900
  hidden = false
  disabled = false
  inert = false
  spellcheck = false
  noValidate = false
  isConnected = true

  constructor(ownerDocument: TestDocument, tagName: string) {
    this.ownerDocument = ownerDocument
    this.tagName = tagName.toUpperCase()
  }

  append(...elements: TestElement[]): void {
    elements.forEach((element) => {
      element.parentElement = this
      this.children.push(element)
    })
  }

  prepend(...elements: TestElement[]): void {
    elements.slice().reverse().forEach((element) => {
      element.parentElement = this
      this.children.unshift(element)
    })
  }

  replaceChildren(...elements: TestElement[]): void {
    this.children.forEach((element) => { element.parentElement = null })
    this.children = []
    this.append(...elements)
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

  contains(element: TestElement | null): boolean {
    for (let current = element; current; current = current.parentElement) {
      if (current === this) return true
    }
    return false
  }

  focus(): void {
    this.ownerDocument.activeElement = this
  }

  addEventListener(): void { /* Les tests pilotent le port numérique public. */ }
  removeEventListener(): void { /* Les tests pilotent le port numérique public. */ }

  remove(): void {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
    this.isConnected = false
  }
}

function findElement(root: TestElement, tagName: string): TestElement | undefined {
  if (root.tagName === tagName.toUpperCase()) return root
  return root.children.map((child) => findElement(child, tagName)).find(Boolean)
}

function createFixture() {
  const document = new TestDocument()
  const host = document.createElement('main')
  const background = document.createElement('button')
  host.append(background)
  background.focus()
  const feedback = vi.fn()
  const overlay = createGameTextEntryOverlay(host as unknown as HTMLElement, { onFeedback: feedback })
  return { document, host, background, feedback, overlay }
}

function createRequest(overrides: Partial<GameTextEntryRequest> = {}): GameTextEntryRequest & { state: { value: string } } {
  const state = { value: '' }
  return {
    mode: 'text',
    title: 'Saisie',
    read: () => state.value,
    write: (value) => { state.value = value },
    submit: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
    state,
  }
}

describe('game text entry value rules', () => {
  it('normalizes every mode without leaking line controls', () => {
    expect(normalizeGameTextEntryValue('name', 'Évo\nli !-12', { maxLength: 9 })).toBe('VOLI -12')
    expect(normalizeGameTextEntryValue('account', ' Red @ 42!? ')).toBe('Red@42')
    expect(normalizeGameTextEntryValue('password', 'clé secrète\n')).toBe('clé secrète')
    expect(normalizeGameTextEntryValue('number', '-1a2', { min: -20 })).toBe('-12')
    expect(normalizeGameTextEntryValue('number', '-1a2', { min: 0 })).toBe('12')
    expect(normalizeGameTextEntryValue('number', '-1,5.7', { min: -20 })).toBe('-1.57')
  })

  it('preserves only normalized line breaks in multiline reports and allows 2000 characters', () => {
    expect(normalizeGameTextEntryValue('multiline', 'un\r\ndeux\rtrois\u2028quatre\u2029cinq\t\0six')).toBe(
      'un\ndeux\ntrois\nquatre\ncinqsix',
    )
    expect(normalizeGameTextEntryValue('multiline', 'ab\ncd', { maxLength: 4 })).toBe('ab\nc')
    expect(normalizeGameTextEntryValue('multiline', 'x'.repeat(2100), { maxLength: 2500 })).toHaveLength(2000)
    expect(normalizeGameTextEntryValue('text', 'x'.repeat(1100), { maxLength: 2000 })).toHaveLength(1024)
  })

  it('clamps and snaps numbers only on submission', () => {
    expect(finalizeGameTextEntryValue('number', '9', { min: 0, max: 10, step: 2 })).toBe('10')
    expect(finalizeGameTextEntryValue('number', '-14', { min: -10, max: 10 })).toBe('-10')
    expect(finalizeGameTextEntryValue('number', '1.24', { min: 0, step: .5 })).toBe('1')
    expect(finalizeGameTextEntryValue('text', '  libre  ')).toBe('  libre  ')
  })
})

describe('game text entry virtual keyboard model', () => {
  it('builds mode-specific pages and controls', () => {
    const nameKeys = createGameTextEntryKeys('name')
    const passwordSymbols = createGameTextEntryKeys('password', 2)
    const positiveNumberKeys = createGameTextEntryKeys('number', 0, { min: 0 })

    expect(nameKeys.some(({ kind }) => kind === 'space')).toBe(true)
    expect(nameKeys.some(({ kind }) => kind === 'page')).toBe(false)
    expect(passwordSymbols.some(({ value }) => value === '@')).toBe(true)
    expect(passwordSymbols.find(({ kind }) => kind === 'page')?.label).toBe('abc')
    expect(positiveNumberKeys.some(({ value }) => value === '-')).toBe(false)
    expect(positiveNumberKeys.at(-1)?.kind).toBe('submit')

    const multilineKeys = createGameTextEntryKeys('multiline')
    expect(multilineKeys.find(({ kind }) => kind === 'line-break')).toMatchObject({
      value: '\n',
      ariaLabel: 'Nouvelle ligne',
    })
  })

  it('moves with wrapping and applies write, erase, page, and submit intents', () => {
    expect(moveGameTextEntryCursor(0, 'left', 30, 10)).toBe(29)
    expect(moveGameTextEntryCursor(0, 'up', 30, 10)).toBe(20)
    expect(moveGameTextEntryCursor(28, 'down', 30, 10)).toBe(8)

    const keys = createGameTextEntryKeys('name')
    const letter = keys.find(({ value }) => value === 'A')!
    const erase = keys.find(({ kind }) => kind === 'backspace')!
    const done = keys.find(({ kind }) => kind === 'submit')!
    expect(applyGameTextEntryKey('name', '', letter, { maxLength: 1 })).toEqual({ value: 'A', action: 'write' })
    expect(applyGameTextEntryKey('name', 'A', letter, { maxLength: 1 })).toEqual({ value: 'A', action: 'none' })
    expect(applyGameTextEntryKey('name', 'A', erase)).toEqual({ value: '', action: 'erase' })
    expect(applyGameTextEntryKey('name', 'A', done)).toEqual({ value: 'A', action: 'submit' })

    const lineBreak = createGameTextEntryKeys('multiline').find(({ kind }) => kind === 'line-break')!
    expect(applyGameTextEntryKey('multiline', 'ligne 1', lineBreak)).toEqual({
      value: 'ligne 1\n',
      action: 'write',
    })
  })
})

describe('central game text entry overlay', () => {
  it('owns one surface, ports digital writes, and restores focus before submit', () => {
    const { document, host, background, overlay } = createFixture()
    const next = createRequest({ title: 'Deuxième' })
    const request = createRequest({
      submit: vi.fn(() => {
        expect(background.inert).toBe(false)
        expect(document.activeElement).toBe(background)
        overlay.open(next)
      }),
    })

    overlay.open(request)
    expect(host.children).toHaveLength(2)
    expect(background.inert).toBe(true)
    expect(overlay.isOpen()).toBe(true)
    expect(overlay.handle({ action: 'confirm', pressed: true, source: 'pointer' })).toBe(true)
    expect(request.state.value).toBe('a')
    overlay.handle({ action: 'secondary', pressed: true, source: 'gamepad' })
    expect(request.state.value).toBe('')
    overlay.handle({ action: 'page-next', pressed: true, source: 'gamepad' })
    overlay.handle({ action: 'confirm', pressed: true, source: 'gamepad' })
    expect(request.state.value).toBe('A')
    overlay.handle({ action: 'cancel', pressed: true, source: 'keyboard', inputId: 'Backspace' })
    expect(request.state.value).toBe('')
    overlay.handle({ action: 'confirm', pressed: true, source: 'gamepad' })
    expect(request.state.value).toBe('A')
    overlay.handle({ action: 'confirm', pressed: true, source: 'keyboard', inputId: 'Enter' })

    expect(request.submit).toHaveBeenCalledWith('A')
    expect(overlay.isOpen()).toBe(true)
    overlay.close()
    expect(next.cancel).toHaveBeenCalledOnce()
    expect(host.children).toHaveLength(2)
  })

  it('keeps invalid values open, supports forced close, and clears secrets', () => {
    const { host, background, feedback, overlay } = createFixture()
    const request = createRequest({
      mode: 'password',
      cancellable: false,
      validate: (value) => value.length >= 2,
      invalidMessage: 'Deux caractères minimum.',
    })
    overlay.open(request)
    const input = findElement(host, 'input')
    expect(input).toBeDefined()

    overlay.handle({ action: 'confirm', pressed: true, source: 'gamepad' })
    overlay.handle({ action: 'confirm', pressed: true, source: 'keyboard', inputId: 'Enter' })
    expect(overlay.isOpen()).toBe(true)
    expect(request.submit).not.toHaveBeenCalled()
    expect(feedback).toHaveBeenCalledWith('invalid')
    overlay.handle({ action: 'cancel', pressed: true, source: 'gamepad' })
    expect(overlay.isOpen()).toBe(true)

    overlay.close()
    expect(request.cancel).toHaveBeenCalledOnce()
    expect(input?.value).toBe('')
    expect(background.inert).toBe(false)
  })

  it('submits the current normalized value through its programmatic port', () => {
    const { overlay } = createFixture()
    const request = createRequest({ mode: 'name' })
    request.state.value = 'silver!'
    overlay.open(request)

    expect(overlay.submitCurrent()).toBe(true)
    expect(request.submit).toHaveBeenCalledWith('SILVER')
    expect(overlay.isOpen()).toBe(false)
    expect(overlay.submitCurrent()).toBe(false)
  })

  it('normalizes external refreshes and refuses concurrent ownership', () => {
    const { host, overlay } = createFixture()
    const root = host.children.at(-1)!
    root.inert = true
    root.setAttribute('aria-hidden', 'true')
    const request = createRequest({ mode: 'name', maxLength: 4 })
    request.state.value = 'lu!na'
    overlay.open(request)
    expect(root.inert).toBe(false)
    expect(root.getAttribute('aria-hidden')).toBeNull()
    expect(request.state.value).toBe('LUNA')
    expect(() => overlay.open(createRequest())).toThrow(/déjà ouverte/)

    request.state.value = 'or\n'
    overlay.refresh()
    expect(request.state.value).toBe('OR')
    overlay.destroy()
    expect(root.inert).toBe(true)
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(overlay.isOpen()).toBe(false)
    expect(request.cancel).not.toHaveBeenCalled()
    expect(() => overlay.open(createRequest())).toThrow(/détruit/)
  })

  it('uses the one central textarea for multiline keyboard, gamepad, and routed pointer input', () => {
    const { host, overlay } = createFixture()
    const request = createRequest({ mode: 'multiline', maxLength: 2000 })
    request.state.value = 'Rapport'
    overlay.open(request)

    const input = findElement(host, 'input')
    const textarea = findElement(host, 'textarea')
    const label = findElement(host, 'label')
    const root = host.children.at(-1)!
    expect(input?.hidden).toBe(true)
    expect(textarea).toMatchObject({ hidden: false, maxLength: 2000, inputMode: 'none', enterKeyHint: 'enter' })
    expect(textarea?.getAttribute('aria-multiline')).toBe('true')
    expect(label?.htmlFor).toBe(textarea?.id)
    expect(root.getAttribute('role')).toBe('dialog')
    expect(root.getAttribute('aria-modal')).toBe('true')

    const nativeEnter = {
      key: 'Enter', target: textarea, ctrlKey: false, metaKey: false, altKey: false,
      repeat: false, preventDefault: vi.fn(),
    } as unknown as KeyboardEvent
    expect(overlay.handleKeyboard(nativeEnter, true)).toBe(false)
    expect(nativeEnter.preventDefault).not.toHaveBeenCalled()

    for (let index = 0; index < 4; index += 1) {
      overlay.handle({ action: 'left', pressed: true, source: 'gamepad' })
    }
    overlay.handle({ action: 'confirm', pressed: true, source: 'gamepad' })
    expect(request.state.value).toBe('Rapport\n')
    overlay.handle({ action: 'confirm', pressed: true, source: 'pointer' })
    expect(request.state.value).toBe('Rapport\n\n')

    const submitShortcut = {
      key: 'Enter', target: textarea, ctrlKey: true, metaKey: false, altKey: false,
      repeat: false, preventDefault: vi.fn(),
    } as unknown as KeyboardEvent
    expect(overlay.handleKeyboard(submitShortcut, true)).toBe(true)
    expect(submitShortcut.preventDefault).toHaveBeenCalledOnce()
    expect(request.submit).toHaveBeenCalledWith('Rapport\n\n')
  })
})

describe('game text entry multiline presentation', () => {
  it('owns its multiline layout and disables motion with the shared accessibility preference', () => {
    expect(gameTextEntryCss).toContain(".game-text-entry-overlay[data-mode='multiline']")
    expect(gameTextEntryCss).toContain('.game-text-entry-textarea')
    expect(gameTextEntryCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.game-text-entry-overlay/)
  })
})
