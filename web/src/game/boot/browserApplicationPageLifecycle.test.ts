import { describe, expect, it, vi } from 'vitest'
import { cleanupBrowserApplication, installTerminalPageCleanup } from './browserApplicationPageLifecycle'

class FakeWindow {
  private readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === 'function') this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string, persisted = false): void {
    const event = { persisted } as PageTransitionEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('cycle de vie terminal de l’application navigateur', () => {
  it('nettoie exactement une fois au seul pagehide terminal', () => {
    const window = new FakeWindow()
    const cleanup = vi.fn()
    installTerminalPageCleanup(window as unknown as Window, cleanup)

    window.dispatch('beforeunload')
    window.dispatch('pagehide', true)
    window.dispatch('pageshow', true)
    expect(cleanup).not.toHaveBeenCalled()

    window.dispatch('pagehide', false)
    window.dispatch('pagehide', false)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('peut détacher la frontière sans détruire les runtimes', () => {
    const window = new FakeWindow()
    const cleanup = vi.fn()
    const lifecycle = installTerminalPageCleanup(window as unknown as Window, cleanup)

    lifecycle.destroy()
    window.dispatch('pagehide', false)

    expect(cleanup).not.toHaveBeenCalled()
  })

  it('draine le réseau puis libère tous les propriétaires malgré une erreur', async () => {
    const order: string[] = []

    await cleanupBrowserApplication({
      destroyNetwork: async () => { order.push('network') },
      dispose: [
        () => { order.push('first'); throw new Error('dispose') },
        () => { order.push('second') },
      ],
    })

    expect(order).toEqual(['network', 'first', 'second'])
  })
})
