import { describe, expect, it, vi } from 'vitest'
import { runSessionRestoreTransaction } from './sessionRestoreTransaction'

describe('transaction de reprise de session', () => {
  it('conserve le nouvel état uniquement après une tentative réussie', () => {
    const owner = { campaign: 'title', world: undefined as string | undefined }
    const restore = vi.fn((snapshot: typeof owner) => Object.assign(owner, snapshot))

    const result = runSessionRestoreTransaction({
      snapshot: () => ({ ...owner }),
      restore,
      attempt: () => { owner.campaign = 'save'; owner.world = 'map-61'; return 'loaded' },
    })

    expect(result).toBe('loaded')
    expect(owner).toEqual({ campaign: 'save', world: 'map-61' })
    expect(restore).not.toHaveBeenCalled()
  })

  it('restaure tous les propriétaires si le chargement de carte échoue', () => {
    const owner = { campaign: 'title', world: undefined as string | undefined, menuOpen: true }
    const before = { ...owner }

    expect(() => runSessionRestoreTransaction({
      snapshot: () => ({ ...owner }),
      restore: (snapshot) => { Object.assign(owner, snapshot) },
      attempt: () => {
        owner.campaign = 'partial-save'
        owner.world = 'partial-map'
        owner.menuOpen = false
        throw new Error('loadMap failed')
      },
    })).toThrow('loadMap failed')
    expect(owner).toEqual(before)
  })
})
