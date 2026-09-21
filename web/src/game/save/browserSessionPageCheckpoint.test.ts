import { describe, expect, it, vi } from 'vitest'
import { createBrowserSessionPageCheckpoint } from './browserSessionPageCheckpoint'

function deferred(): Readonly<{ promise: Promise<void>, resolve: () => void }> {
  let resolve = (): void => undefined
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

function harness(prepareForRelease: () => Promise<void> = vi.fn(async () => undefined)) {
  const order: string[] = []
  const options = {
    cancelAutosave: vi.fn(() => { order.push('cancel') }),
    prepareForRelease: [prepareForRelease],
    activatePresentedMap: vi.fn(() => { order.push('activate') }),
    persistSession: vi.fn(() => { order.push('persist'); return true }),
    flushCloud: vi.fn(async () => { order.push('flush') }),
    reportError: vi.fn(),
  }
  return { checkpoint: createBrowserSessionPageCheckpoint(options), options, order }
}

describe('checkpoint navigateur de campagne', () => {
  it('sauvegarde un onglet masqué sans fermer sa campagne Coop', async () => {
    const view = harness()

    await view.checkpoint.checkpointVisibility()

    expect(view.order).toEqual(['persist', 'flush'])
    expect(view.options.prepareForRelease[0]).not.toHaveBeenCalled()
    expect(view.options.cancelAutosave).not.toHaveBeenCalled()
    expect(view.checkpoint.isReleasing()).toBe(false)
  })

  it('coalesce une sortie et persiste seulement après le drain partagé', async () => {
    const gate = deferred()
    const view = harness(vi.fn(() => gate.promise))

    const first = view.checkpoint.release()
    const second = view.checkpoint.release()
    expect(second).toBe(first)
    expect(view.checkpoint.isReleasing()).toBe(true)
    expect(view.order).toEqual(['cancel', 'persist'])

    gate.resolve()
    await first

    expect(view.order).toEqual(['cancel', 'persist', 'activate', 'persist', 'flush'])
    view.checkpoint.reset()
    expect(view.checkpoint.isReleasing()).toBe(false)
  })

  it('signale un échec sans laisser une promesse de cycle non gérée', async () => {
    const error = new Error('cloud indisponible')
    const view = harness()
    view.options.flushCloud.mockRejectedValueOnce(error)

    await expect(view.checkpoint.checkpointVisibility()).resolves.toBeUndefined()
    expect(view.options.reportError).toHaveBeenCalledWith(error)
  })

  it('ne présente jamais un checkpoint local refusé comme acquitté', async () => {
    const view = harness()
    view.options.persistSession.mockReturnValue(false)

    await view.checkpoint.checkpointVisibility()

    expect(view.options.flushCloud).toHaveBeenCalledOnce()
    expect(view.options.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Checkpoint local en attente.' }),
    )
  })

  it('termine chaque barrière et le checkpoint final si une préparation échoue', async () => {
    const order: string[] = []
    const error = new Error('drain campagne interrompu')
    const reportError = vi.fn()
    const checkpoint = createBrowserSessionPageCheckpoint({
      cancelAutosave: () => { order.push('cancel') },
      prepareForRelease: [
        async () => { order.push('campaign'); throw error },
        async () => { order.push('network') },
      ],
      activatePresentedMap: () => { order.push('activate') },
      persistSession: () => { order.push('persist'); return true },
      flushCloud: async () => { order.push('flush') },
      reportError,
    })

    await checkpoint.release()

    expect(order).toEqual(['cancel', 'persist', 'campaign', 'network', 'activate', 'persist', 'flush'])
    expect(reportError).toHaveBeenCalledWith(error)
  })
})
