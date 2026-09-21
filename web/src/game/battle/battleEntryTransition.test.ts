import { describe, expect, it, vi } from 'vitest'
import {
  createBattleEntrySceneTransitionController,
  createBattleEntryTransitionController,
  resolveBattleEntryTerrain,
  resolveBattleEntryTransitionStyle,
} from './battleEntryTransition'

class FakeStyle {
  readonly values = new Map<string, string>()
  setProperty(name: string, value: string): void { this.values.set(name, value) }
  removeProperty(name: string): string { const value = this.values.get(name) ?? ''; this.values.delete(name); return value }
}

class FakeElement {
  className = ''
  hidden = false
  removed = false
  readonly dataset: Record<string, string> = {}
  readonly style = new FakeStyle()
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly animations: Array<{ cancel: ReturnType<typeof vi.fn>, finished: Promise<void> }> = []
  append(child: FakeElement): void { this.children.push(child) }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAnimations(): Animation[] { return this.animations as unknown as Animation[] }
  remove(): void { this.removed = true }
}

function createFixture(reducedMotion = false) {
  const host = new FakeElement()
  const overlay = new FakeElement()
  const callbacks = new Map<number, () => void>()
  let nextHandle = 1
  const clearSchedule = vi.fn((handle: number) => { callbacks.delete(handle) })
  const controller = createBattleEntryTransitionController({
    host: host as unknown as HTMLElement,
    createOverlay: () => overlay as unknown as HTMLElement,
    schedule: (callback) => { const handle = nextHandle++; callbacks.set(handle, callback); return handle },
    clearSchedule,
    reducedMotion: () => reducedMotion,
  })
  const runNext = (): void => {
    const next = callbacks.entries().next().value as [number, () => void] | undefined
    if (!next) throw new Error('Aucune phase planifiée.')
    callbacks.delete(next[0])
    next[1]()
  }
  return { controller, host, overlay, callbacks, clearSchedule, runNext }
}

describe('transition noire d’entrée en combat', () => {
  it('centralise le terrain visuel HGSS à partir du fond ROM', () => {
    expect(resolveBattleEntryTerrain(1)).toBe('water')
    expect([9, 10, 11].map(resolveBattleEntryTerrain)).toEqual(['cave', 'cave', 'cave'])
    expect(resolveBattleEntryTerrain(0)).toBe('field')
    expect(resolveBattleEntryTerrain(12)).toBe('field')
  })

  it('sélectionne plusieurs volets classiques selon la rencontre', () => {
    expect(resolveBattleEntryTransitionStyle({ kind: 'trainer', terrain: 'field' })).toBe('trainer-bars')
    expect(resolveBattleEntryTransitionStyle({ kind: 'double', terrain: 'water' })).toBe('double-shutter')
    expect(resolveBattleEntryTransitionStyle({ kind: 'wild', terrain: 'water' })).toBe('water-wave')
    expect(resolveBattleEntryTransitionStyle({ kind: 'wild', terrain: 'cave' })).toBe('cave-iris')
    expect(resolveBattleEntryTransitionStyle({ kind: 'wild', terrain: 'field', variantSeed: 2 })).toBe('wild-radial')
    expect(resolveBattleEntryTransitionStyle({ kind: 'wild', terrain: 'field', variantSeed: 3 })).toBe('wild-diagonal')
  })

  it('échange les scènes uniquement lorsque le volet est totalement fermé', () => {
    const { controller, overlay, runNext } = createFixture()
    const onCovered = vi.fn()
    const onComplete = vi.fn()
    controller.play({ kind: 'trainer', terrain: 'field' }, { onCovered, onComplete })

    expect(overlay.hidden).toBe(false)
    expect(overlay.dataset).toMatchObject({ transition: 'trainer-bars', phase: 'covering' })
    expect(onCovered).not.toHaveBeenCalled()
    runNext()
    expect(overlay.dataset.phase).toBe('revealing')
    expect(onCovered).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
    runNext()
    expect(overlay.hidden).toBe(true)
    expect(overlay.dataset).toEqual({})
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('annule sans rejouer les callbacks et détruit son overlay', () => {
    const { controller, overlay, callbacks, clearSchedule } = createFixture()
    const onCovered = vi.fn()
    controller.play({ kind: 'wild', terrain: 'field' }, { onCovered })
    controller.cancel()
    expect(clearSchedule).toHaveBeenCalledOnce()
    expect(callbacks.size).toBe(0)
    expect(overlay.hidden).toBe(true)
    expect(onCovered).not.toHaveBeenCalled()
    controller.dispose()
    expect(overlay.removed).toBe(true)
  })

  it('annule aussi les lecteurs CSS conservés par les pseudo-éléments du volet', () => {
    const { controller, overlay } = createFixture()
    controller.play({ kind: 'trainer', terrain: 'field' }, { onCovered: vi.fn() })
    const retained = { cancel: vi.fn(), finished: Promise.resolve() }
    overlay.animations.push(retained)

    controller.cancel()

    expect(retained.cancel).toHaveBeenCalledOnce()
    expect(overlay.dataset).toEqual({})
  })

  it('ne planifie pas la révélation si le basculement annule la scène', () => {
    const { controller, callbacks, runNext } = createFixture()
    controller.play({ kind: 'wild', terrain: 'cave' }, {
      onCovered: () => controller.cancel(),
    })

    runNext()
    expect(callbacks.size).toBe(0)
    expect(controller.isActive()).toBe(false)
  })

  it('referme proprement le contrôleur si le changement de scène échoue', () => {
    const { controller, overlay, runNext } = createFixture()
    controller.play({ kind: 'wild', terrain: 'field' }, {
      onCovered: () => { throw new Error('scene') },
    })

    expect(() => runNext()).toThrow('scene')
    expect(controller.isActive()).toBe(false)
    expect(overlay.dataset).toEqual({})
  })

  it('bascule immédiatement et sans état résiduel en mouvement réduit', () => {
    const { controller, overlay } = createFixture(true)
    const onCovered = vi.fn()
    const onComplete = vi.fn()
    controller.play({ kind: 'wild', terrain: 'water' }, { onCovered, onComplete })
    expect(onCovered).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledOnce()
    expect(controller.isActive()).toBe(false)
    expect(overlay.hidden).toBe(true)
  })

  it('possède aussi la visibilité et les datasets de la scène réutilisée', () => {
    const host = new FakeElement()
    const screen = new FakeElement()
    const overlay = new FakeElement()
    const callbacks: Array<() => void> = []
    const controller = createBattleEntrySceneTransitionController({
      host: host as unknown as HTMLElement,
      screen: screen as unknown as HTMLElement,
      createOverlay: () => overlay as unknown as HTMLElement,
      schedule: (callback) => { callbacks.push(callback); return callbacks.length },
      clearSchedule: () => undefined,
      reducedMotion: () => false,
    })

    screen.dataset.entryOverlay = 'stale'
    controller.play({ kind: 'wild', backgroundId: 1, variantSeed: 4 })
    expect(screen.hidden).toBe(true)
    expect(screen.dataset).toEqual({ terrain: 'water' })
    callbacks.shift()?.()
    expect(screen.hidden).toBe(false)
    expect(screen.dataset).toMatchObject({ terrain: 'water', presentation: 'entering', entryOverlay: 'active' })
    callbacks.shift()?.()
    expect(screen.dataset.entryOverlay).toBe('complete')

    controller.cancel()
    expect(screen.dataset.entryOverlay).toBeUndefined()

    controller.play({ kind: 'trainer', backgroundId: 0 })
    callbacks.shift()?.()
    screen.dataset.presentation = 'introduction'
    delete screen.dataset.entryOverlay
    callbacks.shift()?.()
    expect(screen.dataset.entryOverlay).toBeUndefined()
  })
})
