import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssSharedCampaignProgressionSeed } from '../multiplayer/hgssSharedCampaignProgression'
import {
  createHgssSharedCampaignSaveExtension,
  replaceHgssSharedCampaignSaveExtension,
} from '../save/hgssSharedCampaignSaveExtension'
import type { HgssDataOnlySaveDocument } from '../save/hgssDataOnlySaveDocument'
import type { HgssFullSaveCloudPresentSnapshot } from '../save/hgssFullSaveCloudVault'
import {
  guardTitleSaveCloudCampaignVersion,
  resolveTitleSaveCloudVersion,
} from './titleSaveCloudVersionPolicy'

const romIdentity = Object.freeze({ gameVersion: 7, language: 3 })
const branch = '0123456789abcdef0123456789abcdef'

function present(revision: number, savedAt: string, branchId = branch) {
  const state = createFieldScriptState('male', 'JO')
  if (revision > 0) state.flags.add(0x10)
  const progression = createHgssSharedCampaignProgressionSeed(state, branchId, revision)
  const campaign = createHgssSharedCampaignSaveExtension(progression, 'session:test', [], 'player:local')
  const document = {
    version: 1,
    romIdentity,
    extensions: replaceHgssSharedCampaignSaveExtension(undefined, campaign),
  } as unknown as HgssDataOnlySaveDocument
  return Object.freeze({
    kind: 'present' as const,
    slot: 1 as const,
    romIdentity,
    savedAt,
    saveKind: 'auto' as const,
    document,
  }) satisfies HgssFullSaveCloudPresentSnapshot
}

describe('garde cloud des branches de campagne partagée', () => {
  it('ne laisse pas une date plus récente faire régresser la progression', () => {
    const advanced = present(1, '2026-08-27T10:00:00.000Z')
    const staleButNewerDate = present(0, '2026-08-27T11:00:00.000Z')
    expect(resolveTitleSaveCloudVersion(staleButNewerDate, advanced)).toBe('current-newer')
    expect(resolveTitleSaveCloudVersion(advanced, staleButNewerDate)).toBe('candidate-newer')
  })

  it('refuse toute fusion automatique de branches différentes', () => {
    expect(resolveTitleSaveCloudVersion(
      present(1, '2026-08-27T11:00:00.000Z', 'f'.repeat(32)),
      present(1, '2026-08-27T10:00:00.000Z'),
    )).toBe('simultaneous-conflict')
  })

  it('préserve un vrai conflit causal malgré une révision de campagne supérieure', () => {
    expect(guardTitleSaveCloudCampaignVersion(
      present(1, '2026-08-27T11:00:00.000Z'),
      present(0, '2026-08-27T10:00:00.000Z'),
      'simultaneous-conflict',
      true,
    )).toBe('simultaneous-conflict')
  })

  it('autorise un attachement initial seulement lorsque la causalité le prouve', () => {
    const campaign = present(0, '2026-08-27T11:00:00.000Z')
    const legacy = Object.freeze({
      ...campaign,
      savedAt: '2026-08-27T10:00:00.000Z',
      document: { ...campaign.document, extensions: undefined } as unknown as HgssDataOnlySaveDocument,
    })
    expect(guardTitleSaveCloudCampaignVersion(campaign, legacy, 'candidate-newer'))
      .toBe('simultaneous-conflict')
    expect(guardTitleSaveCloudCampaignVersion(campaign, legacy, 'candidate-newer', true))
      .toBe('candidate-newer')
  })

  it('reconnaît une suppression attestée comme mutation causale de la campagne', () => {
    const campaign = present(1, '2026-08-27T10:00:00.000Z')
    const tombstone = Object.freeze({
      kind: 'deleted' as const,
      slot: 1 as const,
      romIdentity,
      changedAt: '2026-08-27T11:00:00.000Z',
    })

    expect(guardTitleSaveCloudCampaignVersion(
      tombstone, campaign, 'candidate-newer', true,
    )).toBe('candidate-newer')
    expect(guardTitleSaveCloudCampaignVersion(
      campaign, tombstone, 'current-newer', true,
    )).toBe('current-newer')
    expect(guardTitleSaveCloudCampaignVersion(
      tombstone, campaign, 'candidate-newer', false,
    )).toBe('simultaneous-conflict')
  })
})
