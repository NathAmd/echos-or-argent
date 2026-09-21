import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncTitleMenuPresentation, type TitleMenuPresentationModel } from './titleMenuPresentation'

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  className = ''
  dateTime = ''
  hidden = false
  parentElement: TestElement | undefined
  replacementCount = 0
  scrollCount = 0
  tabIndex = 0
  textContent: string | null = null
  title = ''
  type = ''

  append(...children: TestElement[]): void {
    children.forEach((child) => { child.parentElement = this; this.children.push(child) })
  }

  replaceChildren(...children: TestElement[]): void {
    this.replacementCount += 1
    this.children.splice(0)
    this.append(...children)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  focus(): void {
    testDocument.activeElement = this
  }

  scrollIntoView(): void {
    this.scrollCount += 1
  }
}

const testDocument = {
  activeElement: undefined as TestElement | undefined,
  createElement: () => new TestElement(),
}

function descendants(root: TestElement): TestElement[] {
  return [root, ...root.children.flatMap(descendants)]
}

function byClass(root: TestElement, className: string): TestElement[] {
  return descendants(root).filter((element) => element.className === className)
}

function createModel(cursor: number, createFirst: () => HTMLElement, createSecond: () => HTMLElement): TitleMenuPresentationModel {
  return {
    eyebrow: 'JOUEUR', heading: 'CONTINUER', cursor,
    items: [
      { id: 'slot-1', kind: 'save-slot', number: '01', occupied: true, name: 'OR', location: 'BOURG GEON', kicker: 'CONTINUER · 01', progress: 'BADGES 8', savedAt: { dateTime: '2026-08-21', label: 'DUREE DE JEU' }, partyLabel: 'EQUIPE', party: [{ key: '152:0', title: 'GERMIGNON', createIcon: createFirst }], stats: [{ label: 'Temps', value: '42:17' }], actions: [{ id: 'continue', label: 'Continuer', detail: 'Reprendre', tone: 'primary', slot: 1 }] },
      { id: 'slot-2', kind: 'save-slot', number: '02', occupied: true, name: 'ARGENT', location: 'DOUBLONVILLE', kicker: 'CONTINUER · 02', progress: 'BADGES 3', partyLabel: 'EQUIPE', party: [{ key: '155:0', title: 'HERICENDRE', createIcon: createSecond }], stats: [], actions: [{ id: 'delete', label: 'Supprimer', detail: 'Effacer', tone: 'danger', slot: 2 }] },
    ],
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('présentation incrémentale du menu titre', () => {
  it('conserve la structure, déplace le focus roving et réutilise les icônes déjà décodées', () => {
    vi.stubGlobal('document', testDocument)
    const root = new TestElement()
    const firstIcon = new TestElement()
    const secondIcon = new TestElement()
    const createFirst = vi.fn(() => firstIcon as unknown as HTMLElement)
    const createSecond = vi.fn(() => secondIcon as unknown as HTMLElement)

    syncTitleMenuPresentation(root as unknown as HTMLElement, createModel(0, createFirst, createSecond))
    const screen = root.children[0]
    const buttons = byClass(root, 'title-save-slot')
    expect(root.replacementCount).toBe(1)
    expect(buttons.map(({ tabIndex }) => tabIndex)).toEqual([0, -1])
    expect(testDocument.activeElement).toBe(buttons[0])
    expect(createFirst).toHaveBeenCalledOnce()

    syncTitleMenuPresentation(root as unknown as HTMLElement, createModel(1, createFirst, createSecond))
    expect(root.replacementCount).toBe(1)
    expect(root.children[0]).toBe(screen)
    expect(buttons.map(({ tabIndex }) => tabIndex)).toEqual([-1, 0])
    expect(testDocument.activeElement).toBe(buttons[1])
    expect(createSecond).toHaveBeenCalledOnce()

    syncTitleMenuPresentation(root as unknown as HTMLElement, createModel(0, createFirst, createSecond))
    expect(createFirst).toHaveBeenCalledOnce()
    expect(byClass(root, 'title-save-party')[0]?.children).toEqual([firstIcon])
    expect(byClass(root, 'title-save-stats')[0]?.children).toHaveLength(1)
    const actions = byClass(root, 'title-save-actions')[0]?.children ?? []
    expect(actions).toHaveLength(1)
    expect(actions[0]?.dataset).toMatchObject({ titleMenuAction: 'continue', titleMenuSlot: '1' })
    expect(buttons[0]?.dataset.digitalInputDelegate).toBe('true')
  })
})
