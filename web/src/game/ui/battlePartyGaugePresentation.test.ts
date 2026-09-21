import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBattlePartyGauge } from './battlePartyGaugePresentation'

class TestElement {
  children: TestElement[] = []
  dataset: Record<string, string> = {}
  textContent = ''
  title = ''
  attributes = new Map<string, string>()
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  replaceChildren(...children: TestElement[]): void { this.children = children }
}

afterEach(() => vi.unstubAllGlobals())

describe('renderBattlePartyGauge', () => {
  it('projette les places actives, prêtes, K.O. et vides', () => {
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    const element = new TestElement()
    const members = [
      { speciesName: 'Germignon', currentHp: 12 },
      { speciesName: 'Héricendre', currentHp: 8 },
      { speciesName: 'Kaiminus', currentHp: 0 },
    ] as never
    renderBattlePartyGauge(element as never, members, new Set([1]))
    expect(element.children.slice(1).map(({ dataset }) => dataset.state)).toEqual([
      'ready', 'active', 'fainted', 'empty', 'empty', 'empty',
    ])
    expect(element.dataset.available).toBe('2')
  })
})
