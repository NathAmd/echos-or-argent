import { describe, expect, it, vi } from 'vitest'
import type { BrowserTitleSaveCampaignInvalidationEvent } from './browserTitleSaveAccess'
import { createBrowserAccountCampaignInvalidation } from './browserAccountCampaignInvalidation'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function event(checkpointSaved: boolean): BrowserTitleSaveCampaignInvalidationEvent {
  return Object.freeze({ reason: 'session-ended', checkpointSaved })
}

describe('browser account campaign invalidation', () => {
  it('checkpoint et bloque synchroniquement avant le sas, puis coalesce le teardown réseau', async () => {
    const trace: string[] = []
    const notices: string[] = []
    const teardownPending = deferred()
    let campaignAdmitted = true
    let campaignStorageOpen = true
    const teardownNetwork = vi.fn(() => {
      trace.push('network')
      return teardownPending.promise
    })
    const invalidation = createBrowserAccountCampaignInvalidation({
      checkpointCampaign: () => {
        expect(campaignStorageOpen).toBe(true)
        trace.push('checkpoint')
        return true
      },
      blockCampaign: () => {
        campaignAdmitted = false
        trace.push('block')
      },
      returnToAccountGate: (notice) => {
        expect(campaignStorageOpen).toBe(false)
        expect(campaignAdmitted).toBe(false)
        notices.push(notice)
        trace.push('gate')
      },
      teardownNetwork,
    })

    expect(invalidation.prepareCampaignInvalidation()).toBe(true)
    expect(campaignAdmitted).toBe(false)
    expect(trace).toEqual(['checkpoint', 'block'])

    campaignStorageOpen = false
    invalidation.onCampaignInvalidated(event(true))
    invalidation.onCampaignInvalidated(event(true))

    expect(trace).toEqual(['checkpoint', 'block', 'gate', 'gate'])
    expect(notices).toEqual([
      'Session interrompue · progression sauvegardée.',
      'Session interrompue · progression sauvegardée.',
    ])
    expect(teardownNetwork).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(teardownNetwork).toHaveBeenCalledOnce()

    teardownPending.resolve()
    await teardownPending.promise
    expect(campaignAdmitted).toBe(false)
  })

  it('bloque malgré un checkpoint fautif et rapporte le teardown sans reprendre la partie', async () => {
    const reportError = vi.fn()
    const returnToAccountGate = vi.fn()
    let campaignAdmitted = true
    const invalidation = createBrowserAccountCampaignInvalidation({
      checkpointCampaign: () => { throw new Error('secret-checkpoint') },
      blockCampaign: () => { campaignAdmitted = false },
      returnToAccountGate,
      teardownNetwork: () => Promise.reject(new Error('secret-network')),
      reportError,
    })

    expect(invalidation.prepareCampaignInvalidation()).toBe(false)
    expect(campaignAdmitted).toBe(false)

    invalidation.onCampaignInvalidated(event(false))
    expect(returnToAccountGate).toHaveBeenCalledWith(
      'Session interrompue · sauvegarde non confirmée.',
    )
    await vi.waitFor(() => {
      expect(reportError).toHaveBeenCalledWith('La fermeture réseau de la campagne a échoué.')
    })

    expect(campaignAdmitted).toBe(false)
    expect(reportError).toHaveBeenCalledWith('Le checkpoint de campagne n’a pas pu être enregistré.')
    expect(reportError.mock.calls.flat().join(' ')).not.toMatch(/secret/i)
  })
})
