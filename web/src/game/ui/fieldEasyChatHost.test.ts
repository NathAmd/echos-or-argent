import { describe, expect, it } from 'vitest'
import type { GameDigitalAction, GameDigitalEvent } from '../../gameInput'
import type { HgssEasyChatCatalog, HgssEasyChatWord } from '../../rom/easyChat/easyChatData'
import { createFieldEasyChatHost, type FieldEasyChatRunnerPort, type FieldEasyChatStep } from './fieldEasyChatHost'

type TestListener = EventListenerOrEventListenerObject

class TestButton {
  type = ''
  textContent = ''
  tabIndex = -1
  focusCount = 0
  scrollCount = 0
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Set<TestListener>>()

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: TestListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  focus(): void {
    this.focusCount += 1
  }

  scrollIntoView(): void {
    this.scrollCount += 1
  }

  click(): void {
    this.dispatch('click')
  }

  dispatch(type: string): void {
    const event = { target: this } as unknown as Event
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
}

class TestContainer {
  children: TestButton[] = []

  get childElementCount(): number {
    return this.children.length
  }

  replaceChildren(...children: Node[]): void {
    this.children = children as unknown as TestButton[]
  }

  querySelectorAll<T extends Element>(): NodeListOf<T> {
    return this.children as unknown as NodeListOf<T>
  }
}

class TestRoot {
  hidden = true
  readonly instruction = { textContent: '' }
  readonly cancel = new TestButton()

  querySelector<T extends Element>(selector: string): T | null {
    if (selector === 'header strong') return this.instruction as unknown as T
    if (selector === '[data-easy-chat-cancel]') return this.cancel as unknown as T
    return null
  }
}

function word(wordId: number, text: string): HgssEasyChatWord {
  return { wordId, messageId: wordId, text }
}

function createCatalog(): HgssEasyChatCatalog {
  const words = [word(0, 'BONJOUR'), word(1, 'SALUT'), word(2, ''), word(3, 'COMBAT')]
  return {
    words,
    categories: [
      { id: 0, name: 'SALUTATIONS', messageBankId: 1, firstWordId: 0, wordCount: 3, words: words.slice(0, 3) },
      { id: 1, name: 'COMBAT', messageBankId: 2, firstWordId: 3, wordCount: 1, words: words.slice(3) },
    ],
  }
}

function digital(action: GameDigitalAction, pressed = true): GameDigitalEvent {
  return { action, pressed, source: 'keyboard' }
}

function createFixture(wordCount = 1) {
  const root = new TestRoot()
  const categories = new TestContainer()
  const words = new TestContainer()
  const submissions: Array<number | readonly number[] | undefined> = []
  const order: string[] = []
  let pointerInput = true
  let runnerAvailable = true
  const runner: FieldEasyChatRunnerPort = {
    submit: (selection) => { submissions.push(selection); order.push('submit') },
    resume: () => { order.push(`resume:${String(root.hidden)}:${words.childElementCount}`) },
  }
  const host = createFieldEasyChatHost({
    root: root as unknown as HTMLElement,
    categories: categories as unknown as HTMLElement,
    words: words as unknown as HTMLElement,
  }, {
    createButton: () => new TestButton() as unknown as HTMLButtonElement,
    isPointerInput: () => pointerInput,
    readGridTemplateColumns: () => '1fr 1fr',
    readRunner: () => runnerAvailable ? runner : undefined,
  })
  const step: FieldEasyChatStep = { kind: 'easyChat', mode: 0, catalog: createCatalog(), wordCount }
  return {
    root, categories, words, host, step, submissions, order,
    setPointerInput: (value: boolean) => { pointerInput = value },
    setRunnerAvailable: (value: boolean) => { runnerAvailable = value },
  }
}

describe('host Easy Chat terrain', () => {
  it('rend les catégories ROM, filtre les mots vides et active un mot au pointeur une seule fois', () => {
    const fixture = createFixture()
    fixture.host.open(fixture.step)

    expect(fixture.root.hidden).toBe(false)
    expect(fixture.root.instruction.textContent).toBe('SALUTATIONS')
    expect(fixture.categories.children.map(({ textContent }) => textContent)).toEqual(['SALUTATIONS', 'COMBAT'])
    expect(fixture.words.children.map(({ textContent }) => textContent)).toEqual(['BONJOUR', 'SALUT'])
    expect(fixture.categories.children[0]?.attributes.get('aria-current')).toBe('true')
    expect(fixture.words.children[0]?.attributes.get('aria-selected')).toBe('true')

    fixture.words.children[1]?.dispatch('pointerenter')
    expect(fixture.words.children[1]?.attributes.get('aria-selected')).toBe('true')
    fixture.words.children[1]?.dispatch('pointerdown')
    expect(fixture.submissions).toEqual([])
    fixture.words.children[1]?.click()

    expect(fixture.submissions).toEqual([1])
    expect(fixture.order).toEqual(['submit', 'resume:true:0'])
    expect(fixture.host.isOpen()).toBe(false)
  })

  it('gère navigation et sélection multiple avec le même événement numérique clavier/manette', () => {
    const fixture = createFixture(2)
    fixture.host.open(fixture.step)

    expect(fixture.host.handleDigital(digital('confirm'))).toBe(true)
    expect(fixture.root.instruction.textContent).toBe('SALUTATIONS · 1/2')
    expect(fixture.submissions).toEqual([])
    expect(fixture.host.handleDigital(digital('right'))).toBe(true)
    expect(fixture.host.handleDigital(digital('confirm'))).toBe(true)

    expect(fixture.submissions).toEqual([[0, 1]])
    expect(fixture.order).toEqual(['submit', 'resume:true:0'])
    expect(fixture.host.handleDigital(digital('confirm', false))).toBe(false)
  })

  it('change de catégorie, annule via le contrôle DOM et conserve la vue sans runner actif', () => {
    const fixture = createFixture()
    fixture.host.open(fixture.step)
    fixture.host.handleDigital(digital('page-next'))
    expect(fixture.root.instruction.textContent).toBe('COMBAT')
    expect(fixture.words.children.map(({ textContent }) => textContent)).toEqual(['COMBAT'])

    fixture.setRunnerAvailable(false)
    fixture.root.cancel.click()
    expect(fixture.host.isOpen()).toBe(true)
    expect(fixture.words.childElementCount).toBe(1)
    expect(fixture.submissions).toEqual([])

    fixture.setRunnerAvailable(true)
    fixture.root.cancel.click()
    expect(fixture.submissions).toEqual([undefined])
    expect(fixture.host.isOpen()).toBe(false)
  })

  it('ignore le survol hors modalité pointeur et reset détruit toute la vue', () => {
    const fixture = createFixture()
    fixture.host.open(fixture.step)
    fixture.setPointerInput(false)
    fixture.words.children[1]?.dispatch('pointerenter')
    expect(fixture.words.children[0]?.attributes.get('aria-selected')).toBe('true')

    fixture.host.reset()
    expect(fixture.root.hidden).toBe(true)
    expect(fixture.categories.childElementCount).toBe(0)
    expect(fixture.words.childElementCount).toBe(0)
  })
})
