import { describe, expect, it, vi } from 'vitest'
import { installBrowserGameSessionPageLifecycle } from './browserGameSessionPageLifecycle'

class EventTargetFake {
  visibilityState: DocumentVisibilityState = 'visible'
  private readonly listeners = new Map<string, Set<EventListener>>()
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return
    const bucket = this.listeners.get(type) ?? new Set<EventListener>()
    bucket.add(listener); this.listeners.set(type, bucket)
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === 'function') this.listeners.get(type)?.delete(listener)
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type))
  }
}

describe('cycle de page de la session de jeu', () => {
  it('checkpoint sans quitter au masquage puis reprend horloge, cloud et focus', () => {
    const target = new EventTargetFake()
    const order: string[] = []
    const checkpoint = {
      isReleasing: vi.fn(() => false),
      checkpointVisibility: vi.fn(async () => { order.push('checkpoint') }),
      release: vi.fn(async () => undefined),
      reset: vi.fn(),
    }
    installBrowserGameSessionPageLifecycle({
      window: target as unknown as Window,
      document: target as unknown as Document,
      checkpoint,
      animations: {
        pause: () => { order.push('pause-animation') },
        resume: () => { order.push('resume-animation') },
      },
      clock: {
        pause: () => { order.push('pause-clock') },
        resume: () => { order.push('resume-clock') },
        resynchronize: () => { order.push('resync') },
      },
      resetInput: () => { order.push('reset-input') },
      isGameActive: () => true,
      focus: () => { order.push('focus') },
      releaseAuthorization: vi.fn(),
      restoreTitle: vi.fn(),
      hasPendingCloud: () => true,
      retryPendingCloud: async () => { order.push('retry-cloud') },
      now: () => 10,
    })

    target.visibilityState = 'hidden'; target.dispatch('visibilitychange')
    expect(order).toEqual(['pause-animation', 'pause-clock', 'reset-input', 'checkpoint'])
    order.length = 0
    target.visibilityState = 'visible'; target.dispatch('visibilitychange')
    expect(order).toEqual(['retry-cloud', 'resync', 'resume-animation', 'resume-clock', 'focus'])
  })
})
