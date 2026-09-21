import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { BattleStatStages } from './hgssBattleRules'
import {
  applyBattleStagePresentation,
  setBattleExperienceGaugeElement,
  syncBattleConditionHud,
  syncBattleHudPrimaryStatus,
  syncBattleStageSummary,
} from './battleHudPresentation'

class TestElement {
  readonly children: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  className = ''
  hidden = false
  textContent = ''
  title = ''

  append(...children: TestElement[]): void {
    this.children.push(...children)
  }

  querySelector<T extends TestElement>(selector: string): T | null {
    const className = selector.startsWith('.') ? selector.slice(1) : selector
    return (this.children.find((child) => child.className === className) as T | undefined) ?? null
  }

  replaceChildren(...children: TestElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }
}

const stages = (overrides: Partial<BattleStatStages> = {}): BattleStatStages => ({
  attack: 0,
  defense: 0,
  speed: 0,
  specialAttack: 0,
  specialDefense: 0,
  accuracy: 0,
  evasion: 0,
  ...overrides,
})

function installTestDocument(): void {
  vi.stubGlobal('document', { createElement: () => new TestElement() })
}

afterEach(() => vi.unstubAllGlobals())

describe('battle HUD presentation', () => {
  it('synchronizes and clears the compact primary-status presentation', () => {
    const hud = new TestElement()
    const condition = new TestElement()
    condition.className = 'battle-condition'
    hud.append(condition)

    syncBattleHudPrimaryStatus(hud as unknown as HTMLElement, 'badPoison')

    expect(condition).toMatchObject({ textContent: 'TOX', hidden: false, title: 'Poison grave' })
    expect(condition.dataset.status).toBe('bad-poison')

    syncBattleHudPrimaryStatus(hud as unknown as HTMLElement, 0x10)
    expect(condition).toMatchObject({ textContent: 'BRÛ', hidden: false })

    syncBattleHudPrimaryStatus(hud as unknown as HTMLElement)

    expect(condition).toMatchObject({ textContent: '', hidden: true, title: '' })
    expect(condition.dataset.status).toBeUndefined()
  })

  it('creates a stage summary and retains every stage in the HUD dataset', () => {
    installTestDocument()
    const hud = new TestElement()

    syncBattleStageSummary(hud as unknown as HTMLElement, stages({ attack: 2, defense: -1 }))

    expect(hud.dataset).toMatchObject({ battleStageAttack: '2', battleStageDefense: '-1', battleStageEvasion: '0' })
    const summary = hud.querySelector<TestElement>('.battle-stage-summary')!
    expect(summary.hidden).toBe(false)
    expect(summary.children.map((badge) => [badge.textContent, badge.dataset.tone])).toEqual([
      ['ATQ+2', 'up'],
      ['DEF-1', 'down'],
    ])
  })

  it('applies incremental changes from the retained stages and clamps them to battle limits', () => {
    installTestDocument()
    const hud = new TestElement()
    syncBattleStageSummary(hud as unknown as HTMLElement, stages({ attack: 5, speed: -5 }))

    applyBattleStagePresentation(hud as unknown as HTMLElement, 'attack', 4)
    applyBattleStagePresentation(hud as unknown as HTMLElement, 'speed', -4)

    expect(hud.dataset.battleStageAttack).toBe('6')
    expect(hud.dataset.battleStageSpeed).toBe('-6')
    expect(hud.querySelector<TestElement>('.battle-stage-summary')!.children.map((badge) => badge.textContent)).toEqual([
      'ATQ+6',
      'VIT-6',
    ])
  })

  it('hides an existing stage summary when all stages return to neutral', () => {
    installTestDocument()
    const hud = new TestElement()
    syncBattleStageSummary(hud as unknown as HTMLElement, stages({ accuracy: 1 }))

    syncBattleStageSummary(hud as unknown as HTMLElement, stages())

    const summary = hud.querySelector<TestElement>('.battle-stage-summary')!
    expect(summary.hidden).toBe(true)
    expect(summary.children).toHaveLength(0)
  })

  it('synchronise statut, stages et volatilités vides depuis un même snapshot', () => {
    installTestDocument()
    const hud = new TestElement()
    const condition = new TestElement()
    condition.className = 'battle-condition'
    hud.append(condition)

    syncBattleConditionHud(
      hud as unknown as HTMLElement,
      { status: 0x40 } as CanonicalPokemon,
      stages({ speed: -2 }),
    )

    expect(condition).toMatchObject({ textContent: 'PAR', hidden: false })
    expect(hud.dataset.battleStageSpeed).toBe('-2')
    expect(hud.querySelector<TestElement>('.battle-volatile-summary')).toMatchObject({ hidden: true })
  })

  it('borne la jauge EXP et son libellé accessible', () => {
    const label = { dataset: {} as Record<string, string> }
    const setAttribute = vi.fn()
    const progress = { max: 0, value: 0, setAttribute, closest: () => label } as unknown as HTMLProgressElement
    setBattleExperienceGaugeElement(progress, 130, 100)
    expect(progress).toMatchObject({ max: 100, value: 100 })
    expect(setAttribute).toHaveBeenCalledWith('aria-valuetext', '100/100')
    expect(label.dataset.value).toBe('100/100')
  })
})
