import { describe, expect, it, vi } from 'vitest'
import { runTitleCampaignResumeTransaction } from './titleCampaignResumeTransaction'

describe('transaction de reprise depuis le titre', () => {
  it('autorise la fermeture du menu seulement après la reprise complète', () => {
    const closeMenu = vi.fn()
    const result = runTitleCampaignResumeTransaction({ attempt: vi.fn(), rollback: vi.fn() })
    if (result.kind === 'completed') closeMenu()

    expect(result.kind).toBe('completed')
    expect(closeMenu).toHaveBeenCalledOnce()
  })

  it('restaure la campagne et laisse le menu ouvert si le chargement échoue', () => {
    const menu = { open: true }
    const campaign = { id: 'previous' }
    const closeMenu = vi.fn(() => { menu.open = false })
    const result = runTitleCampaignResumeTransaction({
      attempt: () => { campaign.id = 'partial'; throw new Error('loadMap failed') },
      rollback: () => { campaign.id = 'previous' },
    })
    if (result.kind === 'completed') closeMenu()

    expect(result).toMatchObject({ kind: 'failed', error: expect.objectContaining({ message: 'loadMap failed' }) })
    expect(campaign.id).toBe('previous')
    expect(menu.open).toBe(true)
    expect(closeMenu).not.toHaveBeenCalled()
  })
})
