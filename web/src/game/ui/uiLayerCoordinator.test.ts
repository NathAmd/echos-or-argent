import { describe, expect, it, vi } from 'vitest'
import { createUiLayerCoordinator, type UiLayerDefinition } from './uiLayerCoordinator'

class TestStyle {
  private readonly values = new Map<string, { value: string; priority: string }>()

  getPropertyValue(name: string): string {
    return this.values.get(name)?.value ?? ''
  }

  getPropertyPriority(name: string): string {
    return this.values.get(name)?.priority ?? ''
  }

  setProperty(name: string, value: string, priority = ''): void {
    this.values.set(name, { value, priority })
  }

  removeProperty(name: string): string {
    const value = this.getPropertyValue(name)
    this.values.delete(name)
    return value
  }
}

class TestDocument {
  activeElement: TestElement | null = null
}

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly ownerDocument: TestDocument
  readonly style = new TestStyle()
  parentElement: TestElement | null = null
  hidden = false
  inert = false
  disabled = false
  tabIndex = -1
  id = ''
  className = ''
  tagName = 'div'

  constructor(ownerDocument: TestDocument, options: { id?: string; tagName?: string } = {}) {
    this.ownerDocument = ownerDocument
    this.id = options.id ?? ''
    this.tagName = options.tagName ?? 'div'
    if (this.tagName === 'button' || this.tagName === 'input' || this.tagName === 'textarea' || this.tagName === 'select') this.tabIndex = 0
  }

  append(...elements: TestElement[]): void {
    elements.forEach((element) => {
      element.parentElement = this
      this.children.push(element)
    })
  }

  querySelector<T = TestElement>(selector: string): T | null {
    const queue = [...this.children]
    while (queue.length > 0) {
      const element = queue.shift()!
      if (element.matches(selector)) return element as T
      queue.push(...element.children)
    }
    return null
  }

  contains(candidate: unknown): boolean {
    for (let current = candidate as TestElement | null; current; current = current.parentElement) {
      if (current === this) return true
    }
    return false
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
    if (name === 'tabindex') this.tabIndex = Number.parseInt(value, 10)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  focus(): void {
    this.ownerDocument.activeElement = this
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1)
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1))
    if (this.disabled) return false
    if (selector.includes(':not([tabindex="-1"])') && this.tabIndex < 0) return false
    if (selector.startsWith('button') && this.tagName !== 'button') return false
    if (selector.startsWith('input') && this.tagName !== 'input') return false
    if (selector.startsWith('textarea') && this.tagName !== 'textarea') return false
    if (selector.startsWith('select') && this.tagName !== 'select') return false
    if (selector.includes('[aria-current="true"]')) return this.getAttribute('aria-current') === 'true'
    if (selector.includes('[aria-selected="true"]')) return this.getAttribute('aria-selected') === 'true'
    return selector.startsWith('button') || selector.startsWith('input') || selector.startsWith('textarea')
      || selector.startsWith('select') || (selector.startsWith('[tabindex]') && this.attributes.has('tabindex') && this.tabIndex >= 0)
  }
}

const definitions: readonly UiLayerDefinition[] = [
  { id: 'chrome', priority: -10, selectors: ['#menu-trigger', '#fullscreen'], blocksBackground: false },
  { id: 'hud', priority: 0, selectors: ['#hud'], blocksBackground: false },
  { id: 'dialogue', priority: 10, selectors: ['#dialogue', '#choice'] },
  { id: 'menu', priority: 20, selectors: ['#menu'] },
  { id: 'battle', priority: 30, selectors: ['#battle'] },
  { id: 'modal', priority: 40, selectors: ['#modal'] },
]

function createFixture() {
  const document = new TestDocument()
  const host = new TestElement(document)
  const surface = new TestElement(document, { id: 'surface', tagName: 'canvas' })
  const decoration = new TestElement(document, { id: 'decoration' })
  const menuTrigger = new TestElement(document, { id: 'menu-trigger', tagName: 'button' })
  const fullscreen = new TestElement(document, { id: 'fullscreen', tagName: 'button' })
  const hud = new TestElement(document, { id: 'hud' })
  const dialogue = new TestElement(document, { id: 'dialogue' })
  const choice = new TestElement(document, { id: 'choice' })
  const choiceButton = new TestElement(document, { tagName: 'button' })
  const menu = new TestElement(document, { id: 'menu' })
  const menuButton = new TestElement(document, { tagName: 'button' })
  const battle = new TestElement(document, { id: 'battle' })
  const battleHud = new TestElement(document, { id: 'battle-hud' })
  const battleMessage = new TestElement(document, { id: 'battle-message' })
  const battleEvolution = new TestElement(document, { id: 'battle-evolution' })
  const modal = new TestElement(document, { id: 'modal' })
  const modalButton = new TestElement(document, { tagName: 'button' })
  choiceButton.setAttribute('aria-current', 'true')
  menuButton.setAttribute('aria-current', 'true')
  modalButton.setAttribute('aria-current', 'true')
  choice.append(choiceButton)
  menu.append(menuButton)
  battle.append(battleHud, battleMessage, battleEvolution)
  modal.append(modalButton)
  decoration.inert = true
  decoration.setAttribute('aria-hidden', 'true')
  surface.setAttribute('aria-hidden', 'false')
  menu.style.setProperty('visibility', 'visible')
  dialogue.hidden = true
  choice.hidden = true
  menu.hidden = true
  battle.hidden = true
  modal.hidden = true
  host.append(surface, decoration, menuTrigger, fullscreen, hud, dialogue, choice, menu, battle, modal)
  let notify = (): void => undefined
  const disconnect = vi.fn()
  const observe = vi.fn()
  const coordinator = createUiLayerCoordinator(host as unknown as HTMLElement, {
    definitions,
    createObserver: (onChange) => {
      notify = onChange
      return { observe, disconnect }
    },
  })
  return {
    document, host, surface, decoration, menuTrigger, fullscreen, hud, dialogue, choice, choiceButton, menu, menuButton,
    battle, battleHud, battleMessage, battleEvolution, modal, modalButton,
    coordinator, notify, observe, disconnect,
  }
}

describe('global UI layer coordinator', () => {
  it('keeps dialogue and its choices composited while suppressing every other interactive sibling', () => {
    const fixture = createFixture()
    expect(fixture.observe).toHaveBeenCalledWith(fixture.host, { childList: true })
    expect(fixture.observe).toHaveBeenCalledWith(fixture.dialogue, { attributes: true, attributeFilter: ['hidden'] })
    expect(fixture.coordinator.getActiveLayer()).toBe('hud')
    expect(fixture.surface.inert).toBe(false)

    fixture.dialogue.hidden = false
    fixture.choice.hidden = false
    fixture.notify()

    expect(fixture.coordinator.getActiveLayer()).toBe('dialogue')
    expect(fixture.dialogue.inert).toBe(false)
    expect(fixture.choice.inert).toBe(false)
    expect(fixture.dialogue.style.getPropertyValue('visibility')).toBe('')
    expect(fixture.choice.style.getPropertyValue('visibility')).toBe('')
    expect(fixture.hud.hidden).toBe(false)
    expect(fixture.hud.inert).toBe(true)
    expect(fixture.hud.style.getPropertyValue('visibility')).toBe('hidden')
    expect(fixture.menuTrigger.style.getPropertyValue('visibility')).toBe('hidden')
    expect(fixture.menuTrigger.inert).toBe(true)
    expect(fixture.menuTrigger.getAttribute('aria-hidden')).toBe('true')
    expect(fixture.fullscreen.style.getPropertyValue('visibility')).toBe('hidden')
    expect(fixture.surface.inert).toBe(true)
    expect(fixture.surface.getAttribute('aria-hidden')).toBe('true')
    expect(fixture.document.activeElement).toBe(fixture.choiceButton)

    fixture.dialogue.hidden = true
    fixture.choice.hidden = true
    fixture.notify()
    expect(fixture.coordinator.getActiveLayer()).toBe('hud')
    expect(fixture.surface.inert).toBe(false)
    expect(fixture.surface.getAttribute('aria-hidden')).toBe('false')
    expect(fixture.decoration.inert).toBe(true)
    expect(fixture.hud.style.getPropertyValue('visibility')).toBe('')
    expect(fixture.menuTrigger.style.getPropertyValue('visibility')).toBe('')
    expect(fixture.fullscreen.style.getPropertyValue('visibility')).toBe('')
  })

  it('does not close or rebuild an underlying menu when a modal temporarily dominates it', () => {
    const fixture = createFixture()
    fixture.menu.hidden = false
    fixture.notify()
    const originalMenuButton = fixture.menu.children[0]

    fixture.modal.hidden = false
    fixture.notify()
    expect(fixture.coordinator.getActiveLayer()).toBe('modal')
    expect(fixture.menu.hidden).toBe(false)
    expect(fixture.menu.inert).toBe(true)
    expect(fixture.menu.style.getPropertyValue('visibility')).toBe('hidden')
    expect(fixture.document.activeElement).toBe(fixture.modalButton)

    fixture.modal.hidden = true
    fixture.notify()
    expect(fixture.coordinator.getActiveLayer()).toBe('menu')
    expect(fixture.menu.hidden).toBe(false)
    expect(fixture.menu.children[0]).toBe(originalMenuButton)
    expect(fixture.menu.inert).toBe(false)
    expect(fixture.menu.style.getPropertyValue('visibility')).toBe('visible')
    expect(fixture.document.activeElement).toBe(fixture.menuButton)
  })

  it('focuses the selected control even when a generic button appears first in DOM order', () => {
    const fixture = createFixture()
    fixture.menuButton.removeAttribute('aria-current')
    const selected = new TestElement(fixture.document, { tagName: 'button' })
    selected.setAttribute('aria-selected', 'true')
    fixture.menu.append(selected)
    fixture.menu.hidden = false
    fixture.notify()

    expect(fixture.document.activeElement).toBe(selected)
  })

  it('prioritizes aria-current sequentially over aria-selected across the active roots', () => {
    const fixture = createFixture()
    fixture.menuButton.removeAttribute('aria-current')
    fixture.menuButton.setAttribute('aria-selected', 'true')
    const current = new TestElement(fixture.document, { tagName: 'button' })
    current.setAttribute('aria-current', 'true')
    fixture.menu.append(current)
    fixture.menu.hidden = false
    fixture.notify()

    expect(fixture.document.activeElement).toBe(current)
  })

  it('focuses an explicit composite widget before its generic close button', () => {
    const fixture = createFixture()
    fixture.menuButton.removeAttribute('aria-current')
    const board = new TestElement(fixture.document)
    board.setAttribute('tabindex', '0')
    fixture.menu.append(board)
    fixture.menu.hidden = false
    fixture.notify()

    expect(fixture.document.activeElement).toBe(board)
  })

  it('treats the battle scene as one layer and leaves its HUD, message, and evolution state untouched', () => {
    const fixture = createFixture()
    fixture.battle.hidden = false
    fixture.battleEvolution.hidden = false
    fixture.notify()

    expect(fixture.coordinator.getActiveLayer()).toBe('battle')
    expect(fixture.battle.inert).toBe(false)
    expect(fixture.battleHud.inert).toBe(false)
    expect(fixture.battleMessage.inert).toBe(false)
    expect(fixture.battleEvolution.hidden).toBe(false)

    fixture.coordinator.disconnect()
    expect(fixture.disconnect).toHaveBeenCalledOnce()
    expect(fixture.coordinator.getActiveLayer()).toBeUndefined()
    expect(fixture.surface.inert).toBe(false)
    expect(fixture.decoration.inert).toBe(true)
    expect(fixture.hud.style.getPropertyValue('visibility')).toBe('')
  })

  it('discovers a modal layer appended after startup and keeps it authoritative', () => {
    const fixture = createFixture()
    const textEntry = new TestElement(fixture.document)
    textEntry.className = 'game-text-entry-overlay'
    textEntry.inert = true
    textEntry.setAttribute('aria-hidden', 'true')
    const submit = new TestElement(fixture.document, { tagName: 'button' })
    submit.setAttribute('aria-current', 'true')
    textEntry.append(submit)
    fixture.host.append(textEntry)

    const dynamicDefinitions: readonly UiLayerDefinition[] = [
      ...definitions,
      { id: 'text-entry', priority: 100, selectors: ['.game-text-entry-overlay'] },
    ]
    fixture.coordinator.disconnect()
    const coordinator = createUiLayerCoordinator(fixture.host as unknown as HTMLElement, {
      definitions: dynamicDefinitions,
      createObserver: () => ({ observe: fixture.observe, disconnect: fixture.disconnect }),
    })

    expect(coordinator.getActiveLayer()).toBe('text-entry')
    expect(fixture.surface.inert).toBe(true)
    expect(textEntry.inert).toBe(false)
    expect(textEntry.getAttribute('aria-hidden')).toBeNull()
    expect(fixture.document.activeElement).toBe(submit)
    expect(fixture.observe).toHaveBeenCalledWith(textEntry, { attributes: true, attributeFilter: ['hidden'] })
  })
})
