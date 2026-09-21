import { describe, expect, it } from 'vitest'
import { arbitrateHgssCampaignSnapshotRevision } from './hgssCampaignRevision'

describe('arbitre de révision de campagne HGSS', () => {
  it('accepte le premier snapshot comme point de départ', () => {
    expect(arbitrateHgssCampaignSnapshotRevision(undefined, 37)).toEqual({
      kind: 'apply',
      revision: 37,
      bootstrap: true,
    })
  })

  it('accepte uniquement la révision suivante après amorçage', () => {
    expect(arbitrateHgssCampaignSnapshotRevision(37, 38)).toEqual({
      kind: 'apply',
      revision: 38,
      bootstrap: false,
    })
  })

  it('ignore un duplicata et un snapshot plus ancien', () => {
    expect(arbitrateHgssCampaignSnapshotRevision(37, 37)).toEqual({
      kind: 'ignore',
      revision: 37,
      reason: 'duplicate',
    })
    expect(arbitrateHgssCampaignSnapshotRevision(37, 12)).toEqual({
      kind: 'ignore',
      revision: 12,
      reason: 'stale',
    })
  })

  it('détecte un trou sans avancer la projection locale', () => {
    expect(arbitrateHgssCampaignSnapshotRevision(37, 40)).toEqual({
      kind: 'gap',
      revision: 40,
      expectedRevision: 38,
    })
  })

  it('refuse des révisions qui ne sont pas des entiers JSON sûrs', () => {
    expect(() => arbitrateHgssCampaignSnapshotRevision(-1, 0)).toThrow(/courante/)
    expect(() => arbitrateHgssCampaignSnapshotRevision(0, Number.NaN)).toThrow(/reçue/)
    expect(() => arbitrateHgssCampaignSnapshotRevision(0, Number.MAX_SAFE_INTEGER + 1)).toThrow(/reçue/)
  })
})
