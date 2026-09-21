import { describe, expect, it } from 'vitest'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import {
  createPokegearFlyTransitionController,
  pokegearFlyTransitionFrames,
  type PokegearFlyTransitionPhase,
} from './pokegearFlyTransition'

type RecordedAnimation = {
  element: FakeElement
  options: KeyframeAnimationOptions
  cancel: () => void
}

class FakeElement {
  hidden = false
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  children: FakeElement[] = []
  animationFactory: (element: FakeElement, options: KeyframeAnimationOptions) => Animation
    = () => ({ finished: Promise.resolve(), cancel: () => undefined }) as unknown as Animation

  replaceChildren(...children: FakeElement[]) { this.children = children }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  animate(_keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    return this.animationFactory(this, options)
  }
}

function createFixture(animationMode: 'immediate' | 'pending' | 'arrival-pending' | 'rejected' = 'immediate') {
  const root = new FakeElement()
  const scene = new FakeElement()
  const carrier = new FakeElement()
  const carrierAsset = new FakeElement()
  const veil = new FakeElement()
  const elements = { root, scene, carrier, carrierAsset, veil }
  const phases: PokegearFlyTransitionPhase[] = []
  const animations: RecordedAnimation[] = []

  for (const element of Object.values(elements)) {
    element.animationFactory = (animatedElement, options) => {
      let rejectFinished: (reason?: unknown) => void = () => undefined
      const remainsPending = animationMode === 'pending'
        || (animationMode === 'arrival-pending' && animations.length >= 3)
      const finished = animationMode === 'rejected'
        ? Promise.reject(new DOMException('layout cancelled', 'AbortError'))
        : remainsPending
          ? new Promise<void>((_resolve, reject) => { rejectFinished = reject })
          : Promise.resolve()
      const record: RecordedAnimation = {
        element: animatedElement,
        options,
        cancel: () => rejectFinished(new DOMException('cancelled', 'AbortError')),
      }
      animations.push(record)
      return { finished, cancel: record.cancel } as unknown as Animation
    }
  }
  const controller = createPokegearFlyTransitionController(
    elements as unknown as Parameters<typeof createPokegearFlyTransitionController>[0],
    { onPhaseChange: (phase) => phases.push(phase) },
  )
  return { controller, elements, phases, animations }
}

function assertClean(elements: ReturnType<typeof createFixture>['elements']) {
  expect(elements.root.hidden).toBe(true)
  expect(elements.root.attributes.get('aria-hidden')).toBe('true')
  expect(elements.root.dataset.phase).toBeUndefined()
  expect(elements.scene.children).toEqual([])
  expect(elements.carrierAsset.children).toEqual([])
}

describe('transition HGSS de Vol', () => {
  it('respecte l’ordre des phases et une cadence exprimée en VBlank', async () => {
    const { controller, phases, animations } = createFixture()
    const events: string[] = []
    let captureCount = 0
    const result = await controller.play({
      carrier: new FakeElement() as unknown as HTMLElement,
      onStart: () => { events.push('start') },
      captureScene: () => {
        events.push(captureCount++ === 0 ? 'capture-departure' : 'capture-arrival')
        return new FakeElement() as unknown as HTMLElement
      },
      teleport: () => { events.push('teleport') },
    })

    expect(result).toEqual({ status: 'completed', teleported: true })
    expect(events).toEqual(['start', 'capture-departure', 'teleport', 'capture-arrival'])
    expect(phases).toEqual(['starting', 'departure', 'conceal', 'teleport', 'arrival', 'cleanup', 'idle'])
    expect(animations.map(({ options }) => options.duration)).toEqual([
      hgssVBlanksToMilliseconds(pokegearFlyTransitionFrames.departure),
      hgssVBlanksToMilliseconds(pokegearFlyTransitionFrames.departure),
      hgssVBlanksToMilliseconds(pokegearFlyTransitionFrames.conceal),
      hgssVBlanksToMilliseconds(pokegearFlyTransitionFrames.arrival),
      hgssVBlanksToMilliseconds(pokegearFlyTransitionFrames.arrival),
      hgssVBlanksToMilliseconds(pokegearFlyTransitionFrames.arrival),
    ])
  })

  it('conserve le même ordre métier sans créer d’animations en reduced motion', async () => {
    const { controller, phases, animations, elements } = createFixture()
    let teleports = 0
    const result = await controller.play({
      reducedMotion: true,
      captureScene: () => new FakeElement() as unknown as HTMLElement,
      teleport: () => { teleports += 1 },
    })

    expect(result).toEqual({ status: 'completed', teleported: true })
    expect(teleports).toBe(1)
    expect(animations).toHaveLength(0)
    expect(phases).toEqual(['starting', 'departure', 'conceal', 'teleport', 'arrival', 'cleanup', 'idle'])
    assertClean(elements)
  })

  it('annule le départ sans téléporter ni conserver de présentation', async () => {
    const { controller, phases, elements } = createFixture('pending')
    let teleports = 0
    const completion = controller.play({
      carrier: new FakeElement() as unknown as HTMLElement,
      captureScene: () => new FakeElement() as unknown as HTMLElement,
      teleport: () => { teleports += 1 },
    })
    await Promise.resolve()
    expect(controller.getPhase()).toBe('departure')

    controller.cancel()
    expect(await completion).toEqual({ status: 'cancelled', teleported: false })
    expect(teleports).toBe(0)
    expect(phases).toEqual(['starting', 'departure', 'cleanup', 'idle'])
    expect(controller.isActive()).toBe(false)
    assertClean(elements)
  })

  it('nettoie une annulation pendant l’arrivée sans perdre le warp déjà réussi', async () => {
    const { controller, elements } = createFixture('arrival-pending')
    let teleports = 0
    const completion = controller.play({
      captureScene: () => new FakeElement() as unknown as HTMLElement,
      teleport: () => { teleports += 1 },
    })
    for (let index = 0; index < 8 && controller.getPhase() !== 'arrival'; index += 1) await Promise.resolve()
    expect(controller.getPhase()).toBe('arrival')

    controller.cancel()
    expect(await completion).toEqual({ status: 'cancelled', teleported: true })
    expect(teleports).toBe(1)
    assertClean(elements)
  })

  it('continue le cycle si le navigateur rejette seulement une animation Web', async () => {
    const { controller, elements } = createFixture('rejected')
    let teleports = 0
    const result = await controller.play({
      captureScene: () => new FakeElement() as unknown as HTMLElement,
      teleport: () => { teleports += 1 },
    })

    expect(result).toEqual({ status: 'completed', teleported: true })
    expect(teleports).toBe(1)
    assertClean(elements)
  })

  it('nettoie aussi complètement une erreur survenue pendant la téléportation', async () => {
    const { controller, elements } = createFixture()
    const error = new Error('destination absente')
    const result = await controller.play({
      captureScene: () => new FakeElement() as unknown as HTMLElement,
      teleport: () => { throw error },
    })

    expect(result).toEqual({ status: 'failed', teleported: false, error })
    expect(controller.getPhase()).toBe('idle')
    expect(controller.isActive()).toBe(false)
    assertClean(elements)

    elements.root.hidden = false
    elements.root.dataset.phase = 'residual'
    elements.scene.replaceChildren(new FakeElement())
    elements.carrierAsset.replaceChildren(new FakeElement())
    controller.dispose()
    assertClean(elements)
  })
})
