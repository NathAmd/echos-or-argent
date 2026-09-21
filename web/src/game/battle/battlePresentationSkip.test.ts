import { describe, expect, it, vi } from 'vitest'
import { createBattlePresentationLease, createBattlePresentationSkipRegistry } from './battlePresentationSkip'

describe('accélération partagée des présentations de combat', () => {
  it('accélère toutes les présentations actives avec un seul appui', () => {
    const registry = createBattlePresentationSkipRegistry()
    const first = vi.fn()
    const second = vi.fn()
    registry.register(first)
    registry.register(second)

    expect(registry.request()).toBe(true)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('résout l’attente courante et rend les suivantes instantanées', async () => {
    vi.useFakeTimers()
    const registry = createBattlePresentationSkipRegistry()
    const lease = createBattlePresentationLease(registry)
    let complete = false
    const playback = lease.waitFrames(120).then(() => { complete = true })

    registry.request()
    await playback
    expect(complete).toBe(true)
    await expect(lease.waitFrames(120)).resolves.toBeUndefined()
    lease.close()
    vi.useRealTimers()
  })

  it('retire un lecteur terminé du prochain appui', () => {
    const registry = createBattlePresentationSkipRegistry()
    const lease = createBattlePresentationLease(registry)
    lease.close()
    expect(registry.request()).toBe(false)
  })

  it('propage l’accélération aux sous-phases puis la réinitialise au message suivant', () => {
    const registry = createBattlePresentationSkipRegistry()
    registry.request()
    const inherited = createBattlePresentationLease(registry)
    expect(inherited.signal.aborted).toBe(true)
    inherited.close()
    registry.reset()
    const nextMessage = createBattlePresentationLease(registry)
    expect(nextMessage.signal.aborted).toBe(false)
    nextMessage.close()
  })

  it('annule tous les lecteurs avant de réutiliser la scène', () => {
    const registry = createBattlePresentationSkipRegistry()
    const first = createBattlePresentationLease(registry)
    const second = createBattlePresentationLease(registry)

    registry.clear()

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(registry.request()).toBe(false)
  })
})
