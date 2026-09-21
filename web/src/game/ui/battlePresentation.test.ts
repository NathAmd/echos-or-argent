import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBattleBagChoices, createBattleMoveChoices } from './battlePresentation'
import { syncBattleSubmenuPresentation } from './battleSubmenuPresentation'

class TestElement {
  readonly children: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly tagName: string
  className = ''
  disabled = false
  hidden = false
  textContent: string | null = null
  type = ''

  constructor(tagName: string) {
    this.tagName = tagName
  }

  append(...children: TestElement[]): void {
    this.children.push(...children)
  }

  addEventListener(): void {}

  getAttribute(): string | null {
    return null
  }
}

function findByClass(root: TestElement, className: string): TestElement | undefined {
  if (root.className === className) return root
  for (const child of root.children) {
    const match = findByClass(child, className)
    if (match) return match
  }
  return undefined
}

function installTestDocument(): void {
  vi.stubGlobal('document', {
    createElement: (tagName: string) => new TestElement(tagName),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('battle bag choice presentation', () => {
  it('partage le repli Lutte entre les combats simples et doubles', () => {
    installTestDocument()
    const [choice] = createBattleMoveChoices([], new Set(), {
      moveNames: [],
      typeNames: ['Normal'],
      struggleMove: { type: 0, power: 50, accuracy: 100, category: 0 } as never,
    })
    expect((choice as unknown as TestElement).dataset.battleMove).toBe('-1')
  })

  it('creates the complete item contract without merging ROM text fields', () => {
    installTestDocument()
    const icon = new TestElement('canvas')
    const [choice] = createBattleBagChoices(
      [{ item: { itemId: 7, name: 'ITEM NAME', description: 'ITEM DESCRIPTION' }, quantity: 12 }],
      () => icon as unknown as HTMLElement,
      () => false,
    )
    const button = choice as unknown as TestElement

    expect(button.dataset.battleItem).toBe('7')
    expect(button.children).toHaveLength(3)
    expect(icon.className).toBe('battle-menu-rom-asset')
    expect(findByClass(button, 'battle-item-name')?.textContent).toBe('ITEM NAME')
    expect(findByClass(button, 'battle-item-quantity')?.textContent).toBe('×12')
    expect(findByClass(button, 'battle-item-description')?.textContent).toBe('ITEM DESCRIPTION')
    expect(findByClass(button, 'battle-item-description-viewport')).toBeDefined()
    expect(findByClass(button, 'battle-item-description-track')).toBeDefined()
  })

  it('keeps the canonical title, quantity and description when the carousel prepares the item', () => {
    installTestDocument()
    const [choice] = createBattleBagChoices(
      [{ item: { itemId: 9, name: 'ROM TITLE', description: 'ROM DESCRIPTION' }, quantity: 4 }],
      () => new TestElement('canvas') as unknown as HTMLElement,
      () => false,
    )
    const button = choice as unknown as TestElement
    const originalChildren = [...button.children]
    const battleScreen = { dataset: { uiMode: 'bag' } }
    const container = {
      dataset: {} as Record<string, string>,
      closest: (selector: string) => selector === '.battle-screen' ? battleScreen : null,
      querySelectorAll: () => [choice],
    }

    syncBattleSubmenuPresentation(container as unknown as HTMLElement)

    expect(button.children).toEqual(originalChildren)
    expect(button.dataset.battleItemPrepared).toBe('true')
    expect(findByClass(button, 'battle-item-name')?.textContent).toBe('ROM TITLE')
    expect(findByClass(button, 'battle-item-quantity')?.textContent).toBe('×4')
    expect(findByClass(button, 'battle-item-description')?.textContent).toBe('ROM DESCRIPTION')
  })

})
