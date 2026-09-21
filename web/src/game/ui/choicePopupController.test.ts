import { describe, expect, it, vi } from 'vitest'
import { createChoicePopupController } from './choicePopupController'

class TestNode {
  readonly ownerDocument: TestDocument
  parentElement: TestElement | null = null
  isConnected = true

  constructor(ownerDocument: TestDocument) {
    this.ownerDocument = ownerDocument
  }
}

class TestText extends TestNode {
  value: string

  constructor(ownerDocument: TestDocument, value: string) {
    super(ownerDocument)
    this.value = value
  }
}

class TestDocument {
  activeElement: TestElement | null = null

  createElement(tagName: string): TestElement {
    return new TestElement(this, tagName)
  }

  createTextNode(value: string): TestText {
    return new TestText(this, value)
  }
}

class TestElement extends TestNode {
  readonly attributes = new Map<string, string>()
  readonly dataset: Record<string, string> = {}
  readonly tagName: string
  childNodes: TestNode[] = []
  hidden = false
  inert = false
  tabIndex = 0
  type = ''

  constructor(ownerDocument: TestDocument, tagName: string) {
    super(ownerDocument)
    this.tagName = tagName.toLowerCase()
  }

  get children(): TestElement[] {
    return this.childNodes.filter((node): node is TestElement => node instanceof TestElement)
  }

  get textContent(): string {
    return this.childNodes.map((node) => node instanceof TestText ? node.value : (node as TestElement).textContent).join('')
  }

  set textContent(value: string) {
    this.replaceChildren(...(value === '' ? [] : [this.ownerDocument.createTextNode(value)]))
  }

  append(...nodes: TestNode[]): void {
    this.replaceChildren(...this.childNodes, ...nodes)
  }

  replaceChildren(...nodes: TestNode[]): void {
    this.childNodes.forEach((node) => { node.parentElement = null })
    this.childNodes = nodes
    nodes.forEach((node) => { node.parentElement = this })
  }

  querySelector<T = TestElement>(selector: string): T | null {
    return (this.querySelectorAll(selector)[0] ?? null) as T | null
  }

  querySelectorAll<T = TestElement>(selector: string): T[] {
    const matches: TestElement[] = []
    const visit = (element: TestElement): void => {
      element.children.forEach((child) => {
        if (child.matches(selector)) matches.push(child)
        visit(child)
      })
    }
    visit(this)
    return matches as unknown as T[]
  }

  contains(node: TestNode): boolean {
    for (let current: TestNode | null = node; current; current = current.parentElement) {
      if (current === this) return true
    }
    return false
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

  addEventListener(): void {}

  private matches(selector: string): boolean {
    if (selector === this.tagName) return true
    if (selector === 'button[data-choice-popup-index]') return this.tagName === 'button' && this.dataset.choicePopupIndex !== undefined
    return false
  }
}

function createPopupFixture() {
  const document = new TestDocument()
  const stage = document.createElement('main')
  const trigger = document.createElement('button')
  const alreadyInert = document.createElement('aside')
  const root = document.createElement('section')
  const title = document.createElement('h2')
  const message = document.createElement('p')
  const nav = document.createElement('nav')
  const no = document.createElement('button')
  const yes = document.createElement('button')
  no.dataset.confirmValue = 'false'
  no.textContent = 'NON'
  yes.dataset.confirmValue = 'true'
  yes.textContent = 'OUI'
  title.textContent = 'TITRE ROM'
  message.textContent = 'MESSAGE ROM'
  nav.append(no, yes)
  root.append(title, message, nav)
  root.hidden = true
  alreadyInert.inert = true
  stage.append(trigger, alreadyInert, root)
  document.activeElement = trigger
  return { document, trigger, alreadyInert, root, title, message, nav, no, yes }
}

describe('global choice popup DOM contract', () => {
  it('restores the current ROM nodes, sibling inert states, and trigger focus after selection', () => {
    const fixture = createPopupFixture()
    const selected = vi.fn()
    const popup = createChoicePopupController(fixture.root as unknown as HTMLElement)

    popup.open({
      title: 'CHOIX ROM',
      message: 'QUESTION ROM',
      options: [{ value: 'first', label: 'PREMIER' }, { value: 'second', label: 'SECOND' }],
      initialIndex: 1,
      cancelIndex: 0,
      onSelect: selected,
    })

    const choices = fixture.nav.querySelectorAll<TestElement>('button[data-choice-popup-index]')
    expect(fixture.root.hidden).toBe(false)
    expect(fixture.trigger.inert).toBe(true)
    expect(fixture.alreadyInert.inert).toBe(true)
    expect(choices.map((button) => button.tabIndex)).toEqual([-1, 0])
    expect(fixture.document.activeElement).toBe(choices[1])

    expect(popup.handle('cancel')).toBe(true)
    expect(selected).toHaveBeenCalledWith('first')
    expect(fixture.root.hidden).toBe(true)
    expect(fixture.title.textContent).toBe('TITRE ROM')
    expect(fixture.message.textContent).toBe('MESSAGE ROM')
    expect(fixture.nav.children).toEqual([fixture.no, fixture.yes])
    expect(fixture.trigger.inert).toBe(false)
    expect(fixture.alreadyInert.inert).toBe(true)
    expect(fixture.document.activeElement).toBe(fixture.trigger)
  })

  it('captures a fresh base presentation on every opening instead of restoring bootstrap labels', () => {
    const fixture = createPopupFixture()
    const popup = createChoicePopupController(fixture.root as unknown as HTMLElement)

    popup.open({ title: 'CHOIX ROM', message: '', options: [{ value: true, label: 'OUI' }], onSelect: () => undefined })
    popup.close()
    fixture.title.textContent = 'TITRE ROM ACTUEL'
    fixture.message.textContent = 'MESSAGE ROM ACTUEL'
    fixture.no.textContent = 'NON ROM ACTUEL'

    popup.open({ title: 'AUTRE CHOIX ROM', message: '', options: [{ value: true, label: 'VALIDER' }], onSelect: () => undefined })
    popup.close()

    expect(fixture.title.textContent).toBe('TITRE ROM ACTUEL')
    expect(fixture.message.textContent).toBe('MESSAGE ROM ACTUEL')
    expect(fixture.no.textContent).toBe('NON ROM ACTUEL')
    expect(fixture.nav.children[0]).toBe(fixture.no)
  })

  it('does not alter a confirmation view when this controller does not own it', () => {
    const fixture = createPopupFixture()
    fixture.root.hidden = false
    const popup = createChoicePopupController(fixture.root as unknown as HTMLElement)

    popup.close()

    expect(fixture.root.hidden).toBe(false)
    expect(fixture.nav.children).toEqual([fixture.no, fixture.yes])
  })
})
