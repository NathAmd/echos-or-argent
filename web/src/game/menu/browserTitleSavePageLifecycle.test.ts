import { describe, expect, it, vi } from 'vitest'
import { installBrowserTitleSavePageLifecycle } from './browserTitleSavePageLifecycle'
import { installTerminalPageCleanup } from '../boot/browserApplicationPageLifecycle'
import { createBrowserSessionPageCheckpoint } from '../save/browserSessionPageCheckpoint'

class FakeWindow {
  private readonly listeners = new Map<string, Set<EventListener>>()
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return
    const bucket = this.listeners.get(type) ?? new Set<EventListener>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === 'function') this.listeners.get(type)?.delete(listener)
  }
  dispatch(type: string, persisted: boolean): void {
    const event = { persisted } as PageTransitionEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  beforeUnload(): { prevented: boolean, returnValue: string } {
    const event = {
      prevented: false,
      returnValue: 'unset',
      preventDefault() { event.prevented = true },
    }
    for (const listener of this.listeners.get('beforeunload') ?? []) {
      listener(event as unknown as BeforeUnloadEvent)
    }
    return event
  }
}

describe('cycle de page des sauvegardes titre', () => {
  it('libère avant bfcache puis force un retour au titre à la restauration', () => {
    const window = new FakeWindow()
    const releaseAuthorization = vi.fn()
    const restoreTitle = vi.fn()
    const lifecycle = installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      releaseAuthorization,
      restoreTitle,
    })

    window.dispatch('pagehide', true)
    window.dispatch('pageshow', true)

    expect(releaseAuthorization).toHaveBeenCalledOnce()
    expect(restoreTitle).toHaveBeenCalledOnce()
    lifecycle.destroy()
    window.dispatch('pagehide', true)
    expect(releaseAuthorization).toHaveBeenCalledOnce()
  })

  it('persiste la campagne avant de rendre le bail', () => {
    const window = new FakeWindow()
    const order: string[] = []
    installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      beforeRelease: () => { order.push('persist') },
      releaseAuthorization: () => { order.push('release') },
      restoreTitle: vi.fn(),
    })

    window.dispatch('pagehide', true)

    expect(order).toEqual(['persist', 'release'])
  })

  it('attend l’acquittement cloud avant de libérer une page bfcache restaurée', async () => {
    const window = new FakeWindow()
    const order: string[] = []
    let resolveCheckpoint: (() => void) | undefined
    const checkpoint = new Promise<void>((resolve) => { resolveCheckpoint = resolve })
    installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      beforeRelease: () => {
        order.push('checkpoint')
        return checkpoint
      },
      releaseAuthorization: () => { order.push('release') },
      restoreTitle: () => { order.push('restore') },
    })

    window.dispatch('pagehide', true)
    window.dispatch('pageshow', true)
    expect(order).toEqual(['checkpoint'])

    resolveCheckpoint?.()
    await vi.waitFor(() => expect(order).toEqual(['checkpoint', 'release', 'restore']))
  })

  it('rend le bail même si la persistance de page échoue', () => {
    const window = new FakeWindow()
    const releaseAuthorization = vi.fn()
    installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      beforeRelease: () => { throw new Error('stockage indisponible') },
      releaseAuthorization,
      restoreTitle: vi.fn(),
    })

    expect(() => { window.dispatch('pagehide', true) }).toThrow('stockage indisponible')
    expect(releaseAuthorization).toHaveBeenCalledOnce()
  })

  it('checkpoint sans annuler le transport cloud pendant une navigation terminale', () => {
    const window = new FakeWindow()
    const beforeRelease = vi.fn()
    const releaseAuthorization = vi.fn()
    const restoreTitle = vi.fn()
    installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      beforeRelease,
      releaseAuthorization,
      restoreTitle,
    })
    window.dispatch('pagehide', false)
    window.dispatch('pageshow', false)
    expect(beforeRelease).toHaveBeenCalledOnce()
    expect(releaseAuthorization).not.toHaveBeenCalled()
    expect(restoreTitle).not.toHaveBeenCalled()
  })

  it('chaîne tout le cleanup terminal après les drains séquentiels campagne et hôte', async () => {
    const window = new FakeWindow()
    const order: string[] = []
    let resolveMovement = (): void => undefined
    const movement = new Promise<void>((resolve) => { resolveMovement = resolve })
    let resolveHost = (): void => undefined
    const host = new Promise<void>((resolve) => { resolveHost = resolve })
    const checkpoint = createBrowserSessionPageCheckpoint({
      cancelAutosave: () => { order.push('cancel') },
      prepareForRelease: [async () => {
        order.push('movement:start')
        await movement
        order.push('movement:applied')
        order.push('host:start')
        await host
        order.push('host:detached')
      }],
      activatePresentedMap: () => { order.push('activate') },
      persistSession: () => { order.push('persist'); return true },
      flushCloud: async () => { order.push('flush') },
      reportError: vi.fn(),
    })
    installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      beforeRelease: checkpoint.release,
      releaseAuthorization: vi.fn(),
      restoreTitle: vi.fn(),
    })
    const destroyNetwork = vi.fn(async () => { order.push('destroy-network') })
    const disposeRuntime = vi.fn(() => { order.push('dispose-runtime') })
    installTerminalPageCleanup(window as unknown as Window, () => {
      order.push('terminal-cleanup')
      void checkpoint.release().finally(async () => {
        await destroyNetwork()
        disposeRuntime()
      })
    })

    window.dispatch('pagehide', false)

    expect(order).toEqual(['cancel', 'persist', 'movement:start', 'terminal-cleanup'])
    expect(destroyNetwork).not.toHaveBeenCalled()
    expect(disposeRuntime).not.toHaveBeenCalled()

    resolveMovement()
    await vi.waitFor(() => expect(order).toContain('host:start'))
    expect(destroyNetwork).not.toHaveBeenCalled()
    expect(disposeRuntime).not.toHaveBeenCalled()

    resolveHost()
    await vi.waitFor(() => expect(destroyNetwork).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(disposeRuntime).toHaveBeenCalledOnce())

    expect(order).toEqual([
      'cancel',
      'persist',
      'movement:start',
      'terminal-cleanup',
      'movement:applied',
      'host:start',
      'host:detached',
      'activate',
      'persist',
      'flush',
      'destroy-network',
      'dispose-runtime',
    ])
  })

  it('avertit seulement pendant un upload cloud et le relance au retour réseau', async () => {
    const window = new FakeWindow()
    let pending = false
    const retryPendingCloud = vi.fn(async () => { pending = false })
    const lifecycle = installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      releaseAuthorization: vi.fn(),
      restoreTitle: vi.fn(),
      hasPendingCloud: () => pending,
      retryPendingCloud,
    })

    expect(window.beforeUnload().prevented).toBe(false)
    pending = true
    const warning = window.beforeUnload()
    expect(warning.prevented).toBe(true)
    expect(warning.returnValue).toBe('')

    window.dispatch('online', false)
    await vi.waitFor(() => expect(retryPendingCloud).toHaveBeenCalledOnce())
    expect(pending).toBe(false)
    lifecycle.destroy()
    pending = true
    window.dispatch('online', false)
    expect(retryPendingCloud).toHaveBeenCalledOnce()
  })
})
