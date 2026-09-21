import { describe, expect, it, vi } from 'vitest'
import {
  clearBattleCssAnimation,
  clearBattleCssAnimations,
  restartBattleCssAnimation,
  type BattleCssAnimationResult,
} from './battleCssAnimation'

type AnimationControl = {
  animation: Animation
  cancel: () => void
  finish: () => void
}

function controlledAnimation(animationName: string): AnimationControl {
  let complete = false
  let resolveFinished!: (animation: Animation) => void
  let rejectFinished!: (error: unknown) => void
  const finished = new Promise<Animation>((resolve, reject) => {
    resolveFinished = resolve
    rejectFinished = reject
  })
  const value = { animationName, finished } as unknown as Animation
  const cancel = vi.fn(() => {
    if (complete) return
    complete = true
    rejectFinished(new DOMException('Animation annulée.', 'AbortError'))
  })
  Object.assign(value, { cancel })
  return {
    animation: value,
    cancel,
    finish: () => {
      if (complete) return
      complete = true
      resolveFinished(value)
    },
  }
}

class AnimationHost {
  readonly classes = new Set<string>()
  readonly listeners = new Map<string, Set<(event: Event) => void>>()
  readonly classList = {
    add: (...names: string[]) => {
      for (const name of names) {
        this.classes.add(name)
        if (name === this.animatedClass) this.activationCount += 1
      }
    },
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  }
  readonly offsetWidth = 256
  activationCount = 0
  readonly animatedClass: string
  existing: Animation[] = []
  generations: Animation[][] = []

  constructor(animatedClass = 'is-animated') {
    this.animatedClass = animatedClass
  }

  getAnimations = vi.fn((): Animation[] => {
    if (!this.classes.has(this.animatedClass)) return [...this.existing]
    return [...this.existing, ...(this.generations[this.activationCount - 1] ?? [])]
  })

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>()
    listeners.add(callback)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return
    this.listeners.get(type)?.delete(listener)
  }

  dispatchAnimationCancel(animationName: string): void {
    const event = { animationName, type: 'animationcancel' } as AnimationEvent
    for (const listener of this.listeners.get('animationcancel') ?? []) listener(event)
  }
}

const host = (value: AnimationHost): HTMLElement => value as unknown as HTMLElement

describe('battle CSS animation lifecycle', () => {
  it('attend toutes les nouvelles animations du sous-arbre sans attendre une boucle ambiante', async () => {
    const ambient = controlledAnimation('idle')
    const arrival = controlledAnimation('arrival')
    const shinyA = controlledAnimation('shiny-a')
    const shinyB = controlledAnimation('shiny-b')
    const element = new AnimationHost()
    element.existing = [ambient.animation]
    element.generations = [[arrival.animation, shinyA.animation, shinyB.animation]]
    const onFinish = vi.fn()

    const run = restartBattleCssAnimation(host(element), 'is-animated', { onFinish })
    arrival.finish()
    shinyA.finish()
    await Promise.resolve()
    expect(element.classes.has('is-animated')).toBe(true)
    expect(onFinish).not.toHaveBeenCalled()

    shinyB.finish()
    await expect(run.finished).resolves.toMatchObject({ reason: 'finished', animationCount: 3 })
    expect(element.classes.has('is-animated')).toBe(false)
    expect(ambient.cancel).not.toHaveBeenCalled()
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('parcourt les descendants quand Safari refuse l’option subtree', async () => {
    const arrival = controlledAnimation('arrival')
    const element = new AnimationHost()
    const child = {
      getAnimations: vi.fn(() => element.classes.has('is-animated') ? [arrival.animation] : []),
    }
    ;(element as unknown as { getAnimations: (options?: { subtree?: boolean }) => Animation[] }).getAnimations = vi.fn((options) => {
      if (options?.subtree) throw new TypeError('subtree non pris en charge')
      return []
    })
    ;(element as unknown as { querySelectorAll: () => typeof child[] }).querySelectorAll = () => [child]

    const run = restartBattleCssAnimation(host(element), 'is-animated')
    await Promise.resolve()
    expect(element.classes.has('is-animated')).toBe(true)

    arrival.finish()
    await expect(run.finished).resolves.toMatchObject({ reason: 'finished', animationCount: 1 })
    expect(child.getAnimations).toHaveBeenCalled()
  })

  it('rend obsolète la génération précédente sans retirer la classe de la suivante', async () => {
    const firstAnimation = controlledAnimation('arrival')
    const secondAnimation = controlledAnimation('arrival')
    const element = new AnimationHost()
    element.generations = [[firstAnimation.animation], [secondAnimation.animation]]
    const firstFinish = vi.fn()
    const secondFinish = vi.fn()

    const first = restartBattleCssAnimation(host(element), 'is-animated', { onFinish: firstFinish })
    const second = restartBattleCssAnimation(host(element), 'is-animated', { onFinish: secondFinish })

    await expect(first.finished).resolves.toMatchObject({ reason: 'superseded', generation: 1 })
    expect(firstAnimation.cancel).toHaveBeenCalledOnce()
    expect(element.classes.has('is-animated')).toBe(true)
    expect(firstFinish).not.toHaveBeenCalled()

    secondAnimation.finish()
    await expect(second.finished).resolves.toMatchObject({ reason: 'finished', generation: 2 })
    expect(element.classes.has('is-animated')).toBe(false)
    expect(secondFinish).toHaveBeenCalledOnce()
  })

  it('traite animationcancel comme une fin mais attend encore les autres lecteurs', async () => {
    const cancelled = controlledAnimation('camera')
    const remaining = controlledAnimation('shiny')
    const element = new AnimationHost()
    element.generations = [[cancelled.animation, remaining.animation]]
    const completions: BattleCssAnimationResult[] = []
    const run = restartBattleCssAnimation(host(element), 'is-animated', {
      onFinish: (result) => completions.push(result),
    })

    element.dispatchAnimationCancel('camera')
    cancelled.cancel()
    await Promise.resolve()
    expect(element.classes.has('is-animated')).toBe(true)
    expect(completions).toEqual([])

    remaining.finish()
    await expect(run.finished).resolves.toMatchObject({ reason: 'cancelled', animationCount: 2 })
    expect(element.classes.has('is-animated')).toBe(false)
    expect(completions).toHaveLength(1)
  })

  it('termine proprement sans lecteur et neutralise les lecteurs en mouvement réduit', async () => {
    const empty = new AnimationHost()
    empty.generations = [[]]
    await expect(restartBattleCssAnimation(host(empty), 'is-animated').finished)
      .resolves.toMatchObject({ reason: 'no-animation', animationCount: 0 })
    expect(empty.classes.has('is-animated')).toBe(false)

    const motion = controlledAnimation('arrival')
    const reduced = new AnimationHost()
    reduced.generations = [[motion.animation]]
    const onFinish = vi.fn()
    await expect(restartBattleCssAnimation(host(reduced), 'is-animated', { reducedMotion: true, onFinish }).finished)
      .resolves.toMatchObject({ reason: 'reduced-motion', animationCount: 1 })
    expect(motion.cancel).toHaveBeenCalledOnce()
    expect(reduced.classes.has('is-animated')).toBe(false)
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('interroge le média système avec le receveur global requis par WebKit', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
    const matchMedia = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return { matches: true }
    })
    Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: matchMedia })
    try {
      const element = new AnimationHost()
      element.generations = [[]]
      await expect(restartBattleCssAnimation(host(element), 'is-animated').finished)
        .resolves.toMatchObject({ reason: 'reduced-motion' })
      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    } finally {
      if (previous) Object.defineProperty(globalThis, 'matchMedia', previous)
      else Reflect.deleteProperty(globalThis, 'matchMedia')
    }
  })

  it('peut persister la classe puis la retirer explicitement sans rejouer onFinish', async () => {
    const animation = controlledAnimation('finished-state')
    const element = new AnimationHost()
    element.generations = [[animation.animation]]
    const onFinish = vi.fn()
    const run = restartBattleCssAnimation(host(element), 'is-animated', { persist: true, onFinish })

    animation.finish()
    await expect(run.finished).resolves.toMatchObject({ reason: 'finished' })
    expect(element.classes.has('is-animated')).toBe(true)
    expect(onFinish).toHaveBeenCalledOnce()

    clearBattleCssAnimation(host(element), 'is-animated')
    expect(element.classes.has('is-animated')).toBe(false)
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('permet au propriétaire d’annuler une génération et notifie sa fin une seule fois', async () => {
    const animation = controlledAnimation('arrival')
    const element = new AnimationHost()
    element.generations = [[animation.animation]]
    const onFinish = vi.fn()
    const run = restartBattleCssAnimation(host(element), 'is-animated', { onFinish })

    run.cancel()

    await expect(run.finished).resolves.toMatchObject({ reason: 'cancelled', animationCount: 1 })
    expect(animation.cancel).toHaveBeenCalledOnce()
    expect(element.classes.has('is-animated')).toBe(false)
    expect(onFinish).toHaveBeenCalledOnce()

    run.cancel()
    expect(animation.cancel).toHaveBeenCalledOnce()
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('clear annule les lecteurs suivis et ambiants sans déclencher les callbacks', async () => {
    const ambient = controlledAnimation('idle')
    const active = controlledAnimation('arrival')
    const element = new AnimationHost()
    element.existing = [ambient.animation]
    element.generations = [[active.animation]]
    const onFinish = vi.fn()
    const run = restartBattleCssAnimation(host(element), 'is-animated', { onFinish })

    clearBattleCssAnimations(host(element))

    await expect(run.finished).resolves.toMatchObject({ reason: 'cleared' })
    expect(active.cancel).toHaveBeenCalledOnce()
    expect(ambient.cancel).toHaveBeenCalledOnce()
    expect(element.classes.has('is-animated')).toBe(false)
    expect(onFinish).not.toHaveBeenCalled()
  })
})
