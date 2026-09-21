import { afterEach, describe, expect, it, vi } from 'vitest'
import { createYesNoConfirmationController } from './yesNoConfirmationController'

type TestClickListener = (event: { target: TestElement }) => void

class TestElement {
  readonly dataset: Record<string, string | undefined> = {}
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly listeners: TestClickListener[] = []
  parentElement: TestElement | null = null
  hidden = false
  textContent = ''
  focused = false
  readonly tagName: string

  constructor(tagName = 'div') {
    this.tagName = tagName.toLowerCase()
  }

  append(...elements: TestElement[]): void {
    for (const element of elements) {
      const previousIndex = element.parentElement?.children.indexOf(element) ?? -1
      if (previousIndex >= 0) element.parentElement!.children.splice(previousIndex, 1)
      element.parentElement = this
      this.children.push(element)
    }
  }

  querySelectorAll<T extends Element>(selector: string): T[] {
    const matches: TestElement[] = []
    const visit = (element: TestElement): void => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches as unknown as T[]
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  focus(): void {
    this.root().walk((element) => { element.focused = false })
    this.focused = true
  }

  closest<T extends Element>(selector: string): T | null {
    if (this.matches(selector)) return this as unknown as T
    return this.parentElement?.closest<T>(selector) ?? null
  }

  contains(candidate: TestElement): boolean {
    for (let element: TestElement | null = candidate; element; element = element.parentElement) {
      if (element === this) return true
    }
    return false
  }

  addEventListener(type: string, listener: TestClickListener): void {
    if (type === 'click') this.listeners.push(listener)
  }

  dispatchClick(target: TestElement): void {
    this.listeners.forEach((listener) => { listener({ target }) })
  }

  private root(): TestElement {
    return this.parentElement?.root() ?? this
  }

  private walk(visit: (element: TestElement) => void): void {
    visit(this)
    this.children.forEach((child) => { child.walk(visit) })
  }

  private matches(selector: string): boolean {
    return selector === 'button[data-confirm-value]'
      && this.tagName === 'button'
      && this.dataset.confirmValue !== undefined
  }
}

function createFixture() {
  const root = new TestElement('section')
  const message = new TestElement('p')
  const navigation = new TestElement('nav')
  const no = new TestElement('button')
  const yes = new TestElement('button')
  no.dataset.confirmValue = 'false'
  yes.dataset.confirmValue = 'true'
  navigation.append(no, yes)
  root.append(message, navigation)
  root.hidden = true
  const controller = createYesNoConfirmationController({
    root: root as unknown as HTMLElement,
    message: message as unknown as HTMLElement,
  })
  return { root, message, navigation, no, yes, controller }
}

afterEach(() => vi.unstubAllGlobals())

describe('contrôleur de confirmation Oui/Non', () => {
  it('place le choix par défaut en premier, le sélectionne et résout au clavier', () => {
    const fixture = createFixture()
    const resolve = vi.fn()

    fixture.controller.request('Donner un surnom?', resolve, true)

    expect(fixture.root.hidden).toBe(false)
    expect(fixture.message.textContent).toBe('Donner un surnom?')
    expect(fixture.navigation.children).toEqual([fixture.yes, fixture.no])
    expect(fixture.yes.attributes.get('aria-current')).toBe('true')
    expect(fixture.yes.focused).toBe(true)
    expect(fixture.controller.isOpen()).toBe(true)

    expect(fixture.controller.handle('right')).toBe(true)
    expect(fixture.no.attributes.get('aria-current')).toBe('true')
    expect(fixture.controller.handle('confirm')).toBe(true)
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith(false)
    expect(fixture.root.hidden).toBe(true)
    expect(fixture.controller.isOpen()).toBe(false)
    expect(fixture.controller.handle('confirm')).toBe(false)
  })

  it('conserve Non par défaut et annule toujours avec B ou Menu', () => {
    const fixture = createFixture()
    const cancelResolve = vi.fn()
    fixture.controller.request('Continuer?', cancelResolve)

    expect(fixture.navigation.children).toEqual([fixture.no, fixture.yes])
    fixture.controller.handle('right')
    expect(fixture.yes.attributes.get('aria-current')).toBe('true')
    fixture.controller.handle('cancel')
    expect(cancelResolve).toHaveBeenCalledWith(false)

    const menuResolve = vi.fn()
    fixture.controller.request('Continuer?', menuResolve, true)
    fixture.controller.handle('menu')
    expect(menuResolve).toHaveBeenCalledWith(false)
  })

  it('résout le bouton ROM cliqué, y compris depuis un enfant du bouton', () => {
    vi.stubGlobal('Element', TestElement)
    const fixture = createFixture()
    const resolve = vi.fn()
    const label = new TestElement('span')
    fixture.yes.append(label)
    fixture.controller.request('Valider?', resolve)

    fixture.root.dispatchClick(label)

    expect(resolve).toHaveBeenCalledWith(true)
    expect(fixture.root.hidden).toBe(true)
  })

  it('ignore les boutons empruntés par une autre modale quand aucune confirmation n’attend', () => {
    vi.stubGlobal('Element', TestElement)
    const fixture = createFixture()
    fixture.root.hidden = false

    fixture.root.dispatchClick(fixture.yes)

    expect(fixture.root.hidden).toBe(false)
  })
})
