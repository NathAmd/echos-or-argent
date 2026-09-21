import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameDigitalAction, GameDigitalEvent } from '../../gameInput'
import {
  createFieldChoiceHost,
  type FieldChoiceRunnerPort,
  type FieldChoiceStep,
  type FieldShopChoiceStep,
} from './fieldChoiceHost'

type TestListener = EventListenerOrEventListenerObject

class TestClassList {
  readonly values = new Set<string>()

  add(...tokens: string[]): void { tokens.forEach((token) => this.values.add(token)) }
  remove(...tokens: string[]): void { tokens.forEach((token) => this.values.delete(token)) }
  contains(token: string): boolean { return this.values.has(token) }
  toggle(token: string, force?: boolean): boolean {
    const active = force ?? !this.values.has(token)
    if (active) this.values.add(token)
    else this.values.delete(token)
    return active
  }
}

class TestElement {
  readonly tagName: string
  hidden = false
  textContent = ''
  tabIndex = 0
  type = ''
  scrollTop = 0
  focusCount = 0
  scrollIntoViewCount = 0
  readonly dataset: Record<string, string | undefined> = {}
  readonly classList = new TestClassList()
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  parent: TestElement | undefined
  private readonly listeners = new Map<string, Set<TestListener>>()

  constructor(tagName = 'div') { this.tagName = tagName }

  get className(): string { return [...this.classList.values].join(' ') }
  set className(value: string) {
    this.classList.values.clear()
    value.split(/\s+/).filter(Boolean).forEach((token) => this.classList.add(token))
  }

  get childElementCount(): number { return this.children.length }

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: TestListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string, target: TestElement = this): void {
    const event = { target } as unknown as Event
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }

  click(): void { this.dispatch('click') }

  append(...nodes: Node[]): void {
    for (const node of nodes as unknown as TestElement[]) {
      node.parent = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: Node[]): void {
    this.children.splice(0)
    this.append(...nodes)
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }

  getAttribute(name: string): string | null {
    if (name === 'data-choice-index') return this.dataset.choiceIndex ?? null
    return this.attributes.get(name) ?? null
  }

  focus(): void { this.focusCount += 1 }
  scrollIntoView(): void { this.scrollIntoViewCount += 1 }

  scrollTo(options: ScrollToOptions): void {
    if (options.top !== undefined) this.scrollTop = options.top
  }

  contains(candidate: TestElement): boolean {
    for (let current: TestElement | undefined = candidate; current; current = current.parent) {
      if (current === this) return true
    }
    return false
  }

  closest<T extends Element>(selector: string): T | null {
    if (selector === 'button[data-choice-index]' && this.tagName === 'button' && this.dataset.choiceIndex !== undefined) {
      return this as unknown as T
    }
    return this.parent?.closest<T>(selector) ?? null
  }

  querySelectorAll<T extends Element>(selector: string): NodeListOf<T> {
    const matches: TestElement[] = []
    const visit = (element: TestElement): void => {
      for (const child of element.children) {
        if (selector === 'button' && child.tagName === 'button') matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches as unknown as NodeListOf<T>
  }

  querySelector<T extends Element>(selector: string): T | null {
    let match: TestElement | undefined
    const visit = (element: TestElement): void => {
      for (const child of element.children) {
        if (!match && selector === '.field-shop-list' && child.classList.contains('field-shop-list')) match = child
        visit(child)
      }
    }
    visit(this)
    return match as unknown as T | null
  }
}

function digital(action: GameDigitalAction, pressed = true): GameDigitalEvent {
  return { action, pressed, source: 'keyboard' }
}

function choice(values: readonly number[], cancellable = false): FieldChoiceStep {
  return { kind: 'choice', options: values.map((value) => ({ value, label: `CHOIX ${value}` })), cancellable }
}

function shop(values: readonly number[]): FieldShopChoiceStep {
  return {
    ...choice(values, true),
    presentation: 'shop',
    shop: { mode: 'buy', phase: 'browse', balance: 3_000 },
  }
}

function createFixture() {
  vi.stubGlobal('Element', TestElement)
  const root = new TestElement()
  root.hidden = true
  const order: string[] = []
  const previews: number[] = []
  const previewErrors: unknown[] = []
  let runnerAvailable = true
  let pointerInteractions = 0
  const runner: FieldChoiceRunnerPort = {
    choose: (value) => order.push(`choose:${value}:${String(root.hidden)}:${root.childElementCount}`),
    resume: () => order.push(`resume:${String(root.hidden)}:${root.childElementCount}`),
  }
  const createElement = (tag: 'span' | 'strong' | 'small' | 'button' | 'canvas' | 'div'): TestElement => new TestElement(tag)
  const host = createFieldChoiceHost(root as unknown as HTMLElement, {
    createButton: () => createElement('button') as unknown as HTMLButtonElement,
    createElement: (tag) => createElement(tag) as unknown as HTMLElement,
    createShopPresentation: (step) => {
      const list = createElement('div')
      list.classList.add('field-shop-list')
      for (const [index] of step.options.entries()) {
        const button = createElement('button')
        button.dataset.choiceIndex = String(index)
        list.append(button as unknown as Node)
      }
      return [list as unknown as HTMLElement]
    },
    createStarterMachine: () => createElement('canvas') as unknown as HTMLElement,
    createStarterIcon: () => createElement('canvas') as unknown as HTMLElement,
    createPartyChoice: (slot) => ({
      icon: createElement('canvas') as unknown as HTMLElement,
      name: `POKÉMON ${slot}`,
      details: `N. ${slot + 5}`,
      shiny: slot === 1,
    }),
    formatOptionLabel: (label) => `[${label}]`,
    previewStarter: async (value) => { previews.push(value) },
    resetStarterPreview: () => undefined,
    clearStarterIcons: () => undefined,
    reportStarterPreviewError: (error) => { previewErrors.push(error) },
    onPointerInteraction: () => { pointerInteractions += 1 },
    readRunner: () => runnerAvailable ? runner : undefined,
  })
  return {
    root,
    host,
    order,
    previews,
    previewErrors,
    getPointerInteractions: () => pointerInteractions,
    setRunnerAvailable: (available: boolean) => { runnerAvailable = available },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('host des choix terrain', () => {
  it('rend un choix générique et soumet après navigation numérique avant reset puis reprise', () => {
    const fixture = createFixture()
    fixture.host.open(choice([10, 20]))
    const buttons = [...fixture.root.querySelectorAll<HTMLButtonElement>('button')] as unknown as TestElement[]

    expect(fixture.root.hidden).toBe(false)
    expect(buttons.map(({ textContent }) => textContent)).toEqual(['[CHOIX 10]', '[CHOIX 20]'])
    expect(buttons.map(({ tabIndex }) => tabIndex)).toEqual([0, -1])
    expect(fixture.host.handleDigital(digital('down'))).toBe(true)
    expect(buttons.map(({ tabIndex }) => tabIndex)).toEqual([-1, 0])
    expect(buttons[1]?.focusCount).toBe(1)
    expect(fixture.host.handleDigital(digital('confirm'))).toBe(true)

    expect(fixture.order).toEqual(['choose:20:false:2', 'resume:true:0'])
    expect(fixture.host.isOpen()).toBe(false)
  })

  it('respecte cancellable et ne consomme pas l’entrée sans runner', () => {
    const fixture = createFixture()
    fixture.host.open(choice([1], false))
    expect(fixture.host.handleDigital(digital('cancel'))).toBe(true)
    expect(fixture.order).toEqual([])
    expect(fixture.host.isOpen()).toBe(true)

    fixture.host.open(choice([1], true))
    fixture.setRunnerAvailable(false)
    expect(fixture.host.handleDigital(digital('cancel'))).toBe(false)
    fixture.setRunnerAvailable(true)
    fixture.host.cancel()
    expect(fixture.order).toEqual(['choose:65534:false:1', 'resume:true:0'])
  })

  it('partage activation pointeur et aperçu starter sans double soumission', () => {
    const fixture = createFixture()
    fixture.host.open({ ...choice([152, 155]), presentation: 'starter' })
    const buttons = [...fixture.root.querySelectorAll<HTMLButtonElement>('button')] as unknown as TestElement[]
    const nestedLabel = buttons[1]?.children[1]
    expect(fixture.previews).toEqual([152])
    expect(fixture.root.children[0]?.classList.contains('starter-machine-model')).toBe(true)

    if (!nestedLabel) throw new Error('Le libellé starter de test est absent.')
    fixture.root.dispatch('pointerdown', nestedLabel)
    fixture.root.dispatch('click', nestedLabel)

    expect(fixture.getPointerInteractions()).toBe(1)
    expect(fixture.previews).toEqual([152, 155, 155])
    expect(fixture.order).toEqual(['choose:155:false:3', 'resume:true:0'])
  })

  it('compose une option équipe avec son identité et son état chromatique', () => {
    const fixture = createFixture()
    fixture.host.open({ ...choice([1, 0xfffe]), presentation: 'party' })
    const buttons = [...fixture.root.querySelectorAll<HTMLButtonElement>('button')] as unknown as TestElement[]
    const icon = buttons[0]?.children[0]
    const identity = buttons[0]?.children[1]

    expect(fixture.root.classList.contains('field-choice-party')).toBe(true)
    expect(icon?.classList.contains('field-party-choice-icon')).toBe(true)
    expect(icon?.dataset.shiny).toBe('true')
    expect(identity?.children.map(({ textContent }) => textContent)).toEqual(['POKÉMON 1', 'N. 6'])
    expect(buttons[1]?.textContent).toBe('[CHOIX 65534]')
  })

  it('restaure sélection et défilement boutique puis les efface au reset public', () => {
    const fixture = createFixture()
    fixture.host.open(shop([17, 42]))
    fixture.host.handleDigital(digital('down'))
    const firstList = fixture.root.querySelector<HTMLElement>('.field-shop-list') as unknown as TestElement | null
    if (!firstList) throw new Error('La liste boutique de test est absente.')
    firstList.scrollTop = 73
    fixture.host.select()

    fixture.host.open(shop([17, 42]))
    const restoredButtons = [...fixture.root.querySelectorAll<HTMLButtonElement>('button')] as unknown as TestElement[]
    expect(restoredButtons.map(({ tabIndex }) => tabIndex)).toEqual([-1, 0])
    expect((fixture.root.querySelector<HTMLElement>('.field-shop-list') as unknown as TestElement | null)?.scrollTop).toBe(73)

    fixture.host.reset()
    fixture.host.open(shop([17, 42]))
    const resetButtons = [...fixture.root.querySelectorAll<HTMLButtonElement>('button')] as unknown as TestElement[]
    expect(resetButtons.map(({ tabIndex }) => tabIndex)).toEqual([0, -1])
    expect((fixture.root.querySelector<HTMLElement>('.field-shop-list') as unknown as TestElement | null)?.scrollTop).toBe(0)
  })

  it('retire ses écouteurs globaux au destroy', () => {
    const fixture = createFixture()
    fixture.host.open(choice([1]))
    fixture.host.destroy()
    fixture.root.dispatch('pointerdown')
    fixture.root.dispatch('click')
    expect(fixture.getPointerInteractions()).toBe(0)
    expect(fixture.order).toEqual([])
  })
})
